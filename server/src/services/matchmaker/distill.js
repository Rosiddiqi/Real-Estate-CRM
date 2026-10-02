// AI distillation of a client's texts / calls / notes into matchmaker inputs
// (port of RM grapevineDistiller, re-written for real estate, spec 06 §8.5):
//   { mustHaves: [{feature, importance, source}], signals: [{kind,label,text}],
//     wantExtras: {...}, sellSignals: [{signal, strength, quote, source}] }
//
// • Optional: only runs when ai.available(); the pool works without it.
// • Cached by content hash (6 h TTL) in memory + a tmp file, so re-runs are
//   free until the client's conversations actually change.
// • Fair Housing guardrail in the prompt — property attributes and explicitly
//   named places only.
// • "Whose home is it": wants of third parties, homes the client owns/sells/
//   manages, and investor remarks are excluded.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const { FAIR_HOUSING } = require('./vocab');

const PROMPT_VERSION = 'km-v1';
const TTL_MS = 6 * 3600 * 1000;
const FILE = path.join(os.tmpdir(), 'keymatch-matchmaker-distill.json');
const mem = new Map(); // `${workspaceId}:${clientId}` -> { hash, at, result }
let loaded = false;
let saveTimer = null;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) mem.set(k, v);
  } catch { /* first run */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = [...mem.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 800);
      fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* cache is best-effort */ }
  }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

function peek(workspaceId, clientId) {
  load();
  const v = mem.get(`${workspaceId}:${clientId}`);
  return v ? v.result : null;
}

const SYSTEM = `You read a luxury real-estate agent's history with ONE client (notes, texts, call summaries) and extract what that client personally wants in a home, for a matching engine.

Return JSON only, matching the schema.

RULES
- mustHaves: ONLY emphatic, non-negotiable requirements the client stated about a home THEY will live in or buy ("HAS to have a dock for a 70-ft boat", "single-story only", "no HOA", "must have a wine room"). Short canonical feature names ("dock for a 70-ft boat", "single story", "no HOA", "wine room"). importance 0..1.2 (1.2 = absolute deal-breaker if missing). source = text | call | note.
- signals: up to 4 short quotes or paraphrases in the client's own words that explain their taste or urgency (kind text|call|note, label like "Text · Sep 12", text ≤ 200 chars).
- wantExtras: only when explicitly stated: markets, neighborhoods, buildings (named places only), propertyTypes (single_family|condo|townhouse|estate|penthouse|villa|land|co_op), styles, waterfront (oceanfront|bayfront|intracoastal|canal|lake|any), views, bedsMin, bathsMin, sqftMin, priceMin, priceMax (whole dollars), timeline, financing (cash_pof|preapproved|prequalified|contingent).
- sellSignals: if the client hints they might SELL a home they own ("thinking of downsizing next year", "the Gables house is too big now"), record the plan with strength 0..1 and a short quote. Record the plan, never the family circumstance behind it.
- WHOSE HOME IS IT: ignore homes the client owns/sells/lists/manages for others, wants of third parties ("my brother is looking", "my buyer wants"), and investor remarks unless they buy for themselves.
- When unsure, leave it out. Never invent.
${FAIR_HOUSING}`;

const SCHEMA = {
  type: 'object',
  properties: {
    mustHaves: { type: 'array', items: { type: 'object', properties: { feature: { type: 'string' }, importance: { type: 'number' }, source: { type: 'string' } } } },
    signals: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' } } } },
    wantExtras: {
      type: 'object',
      properties: {
        markets: { type: 'array', items: { type: 'string' } },
        neighborhoods: { type: 'array', items: { type: 'string' } },
        buildings: { type: 'array', items: { type: 'string' } },
        propertyTypes: { type: 'array', items: { type: 'string' } },
        styles: { type: 'array', items: { type: 'string' } },
        waterfront: { type: 'array', items: { type: 'string' } },
        views: { type: 'array', items: { type: 'string' } },
        bedsMin: { type: ['number', 'null'] },
        bathsMin: { type: ['number', 'null'] },
        sqftMin: { type: ['number', 'null'] },
        priceMin: { type: ['number', 'null'] },
        priceMax: { type: ['number', 'null'] },
        timeline: { type: ['string', 'null'] },
        financing: { type: ['string', 'null'] },
      },
    },
    sellSignals: { type: 'array', items: { type: 'object', properties: { signal: { type: 'string' }, strength: { type: 'number' }, quote: { type: 'string' }, source: { type: 'string' } } } },
  },
};

const EMPTY = { mustHaves: [], signals: [], wantExtras: {}, sellSignals: [] };

async function gather(workspaceId, clientId) {
  const [client, notes, convs, calls] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { firstName: true, lastName: true, notes: true } }),
    prisma.note.findMany({ where: { workspaceId, clientId }, orderBy: { createdAt: 'desc' }, take: 20, select: { body: true, createdAt: true } }),
    prisma.conversation.findMany({ where: { workspaceId, clientId }, select: { id: true } }),
    prisma.phoneCall.findMany({ where: { workspaceId, clientId, OR: [{ summary: { not: null } }, { transcript: { not: null } }] }, orderBy: { startedAt: 'desc' }, take: 25, select: { summary: true, startedAt: true, transcript: true } }),
  ]);
  const msgs = convs.length ? await prisma.message.findMany({
    where: { workspaceId, conversationId: { in: convs.map((c) => c.id) }, body: { not: null } },
    orderBy: { sentAt: 'desc' }, take: 120, select: { body: true, isFromMe: true, sentAt: true },
  }) : [];
  return { client, notes, msgs, calls };
}

function contentHash(g) {
  const h = crypto.createHash('sha1');
  h.update(`pv:${PROMPT_VERSION}`);
  h.update(String(g.client && g.client.notes || ''));
  for (const n of g.notes) h.update(`n:${n.body}`);
  for (const m of g.msgs) h.update(`${m.isFromMe ? 'me' : 'them'}:${m.body}`);
  for (const c of g.calls) h.update(`c:${c.summary || ''}`);
  return h.digest('hex');
}

function fmtDay(d) {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function buildPrompt(g) {
  const lines = [];
  lines.push(`CLIENT: ${[g.client?.firstName, g.client?.lastName].filter(Boolean).join(' ')}`);
  const notes = [g.client?.notes, ...g.notes.map((n) => `(${fmtDay(n.createdAt)}) ${n.body}`)].filter(Boolean).slice(0, 20);
  if (notes.length) lines.push(`NOTES:\n${notes.map((n) => `- ${String(n).slice(0, 400)}`).join('\n')}`);
  if (g.msgs.length) lines.push(`TEXTS (most recent first):\n${g.msgs.map((m) => `- [${m.isFromMe ? 'me' : 'them'} · ${fmtDay(m.sentAt)}] ${String(m.body).slice(0, 300)}`).join('\n')}`);
  if (g.calls.length) {
    lines.push(`CALLS:\n${g.calls.map((c) => {
      const t = c.summary || (Array.isArray(c.transcript) ? c.transcript.map((x) => `${x.speaker}: ${x.text}`).join(' ') : '');
      return `- (${fmtDay(c.startedAt)}) ${String(t).slice(0, 600)}`;
    }).join('\n')}`);
  }
  return lines.join('\n\n');
}

function clean(out) {
  if (!out || typeof out !== 'object') return EMPTY;
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    mustHaves: arr(out.mustHaves).filter((m) => m && m.feature).slice(0, 8).map((m) => ({ feature: String(m.feature).slice(0, 60), importance: Math.max(0, Math.min(1.2, Number(m.importance) || 1)), source: m.source || 'text' })),
    signals: arr(out.signals).filter((s) => s && s.text).slice(0, 4).map((s) => ({ kind: ['text', 'call', 'note'].includes(s.kind) ? s.kind : 'note', label: String(s.label || 'Conversation').slice(0, 40), text: String(s.text).slice(0, 220) })),
    wantExtras: out.wantExtras && typeof out.wantExtras === 'object' ? out.wantExtras : {},
    sellSignals: arr(out.sellSignals).filter((s) => s && s.signal).slice(0, 4).map((s) => ({ signal: String(s.signal).slice(0, 120), strength: Math.max(0, Math.min(1, Number(s.strength) || 0)), quote: String(s.quote || '').slice(0, 200), source: s.source || 'text' })),
  };
}

// Distill one client (cached by content hash). Never throws.
async function distillClient(workspaceId, clientId, { force = false } = {}) {
  load();
  const key = `${workspaceId}:${clientId}`;
  try {
    const g = await gather(workspaceId, clientId);
    if (!g.client) return EMPTY;
    const h = contentHash(g);
    const prev = mem.get(key);
    if (!force && prev && prev.hash === h && Date.now() - prev.at < TTL_MS) return prev.result;
    if (!g.msgs.length && !g.notes.length && !g.calls.length && !g.client.notes) {
      mem.set(key, { hash: h, at: Date.now(), result: EMPTY });
      return EMPTY;
    }
    if (!ai.available()) return prev ? prev.result : EMPTY;
    const out = await ai.json({ system: SYSTEM, prompt: buildPrompt(g), schema: SCHEMA, effort: 'low', maxTokens: 4000, feature: 'matchmaker_distill', workspaceId });
    const result = clean(out);
    mem.set(key, { hash: h, at: Date.now(), result });
    save();
    return result;
  } catch (err) {
    if (err && err.code !== 'ai_unavailable') console.warn('[matchmaker] distill failed', clientId, err.message);
    const prev = mem.get(key);
    return prev ? prev.result : EMPTY;
  }
}

// Background pass: clients with live searches first, bounded per run.
async function distillWorkspace(workspaceId, { limit = 40 } = {}) {
  if (!ai.available()) return { ran: 0, skipped: 'ai_unavailable' };
  const searches = await prisma.buyerSearch.findMany({
    where: { workspaceId, status: { notIn: ['paused', 'found', 'archived'] }, client: { archivedAt: null } },
    select: { clientId: true }, distinct: ['clientId'], take: limit,
  });
  let ran = 0;
  for (const s of searches) {
    await distillClient(workspaceId, s.clientId);
    ran += 1;
  }
  return { ran };
}

module.exports = { peek, distillClient, distillWorkspace, EMPTY };

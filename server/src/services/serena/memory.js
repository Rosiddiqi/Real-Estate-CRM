// Serena's durable memory of the AGENT (preferences, goals, standing
// instructions, working style). Facts about clients belong on the client
// (notes, portfolio, searches) — never here. Extracted after each turn (AI when
// available; an explicit "remember…" pattern otherwise) and injected into the
// volatile context block.
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const { FAIR_HOUSING } = require('./prompt');

const MAX_MEMORIES = 60;
// Belt-and-braces filter: memory is about the agent, so anything that reads
// like protected-class information is dropped rather than stored.
const PROTECTED = /\b(race|racial|religio\w*|christian|jewish|muslim|hindu|catholic|ethnic\w*|national origin|immigrant|disab\w*|wheelchair|pregnan\w*|familial status|sexual orientation|gender identity|hispanic|latino|latina)\b/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function store(workspaceId, userId, facts, source) {
  if (!facts.length) return [];
  const existing = await prisma.serenaMemory.findMany({ where: { workspaceId, userId }, select: { id: true, text: true } });
  const seen = new Set(existing.map((e) => norm(e.text)));
  const created = [];
  for (const f of facts.slice(0, 3)) {
    const text = String(f.text || '').trim().slice(0, 300);
    if (text.length < 6 || seen.has(norm(text)) || PROTECTED.test(text)) continue;
    seen.add(norm(text));
    created.push(await prisma.serenaMemory.create({ data: { workspaceId, userId, kind: f.kind || 'preference', text, source } }));
  }
  const total = await prisma.serenaMemory.count({ where: { workspaceId, userId } });
  if (total > MAX_MEMORIES) {
    const old = await prisma.serenaMemory.findMany({ where: { workspaceId, userId }, orderBy: { updatedAt: 'asc' }, take: total - MAX_MEMORIES, select: { id: true } });
    await prisma.serenaMemory.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  return created;
}

// Deterministic capture: "remember that I never show before 10".
function explicitFacts(userText) {
  const m = /^\s*(?:please\s+)?(?:remember|note to self|keep in mind|fyi)[:,]?\s+(?:that\s+)?(.{6,280})$/i.exec(String(userText || ''));
  if (!m) return [];
  return [{ kind: /\b(goal|target|aim)\b/i.test(m[1]) ? 'goal' : 'preference', text: m[1].replace(/\s*[.!]+$/, '') }];
}

const EXTRACT_SYSTEM = `You maintain the long-term memory of an AI chief of staff for a luxury real-estate agent. From the latest exchange, extract ONLY durable facts about the AGENT themself that will matter in future conversations: working preferences ("never books showings before 10am", "prefers texts over calls with sellers"), goals ("wants 30 sides this year"), standing instructions, schedule habits, brokerage/business facts, communication style.

Do NOT extract: facts about clients or properties (those live in the CRM), one-off tasks or appointments, anything already obvious from the conversation history, or anything sensitive. ${FAIR_HOUSING}

Return at most 3 short facts, each a self-contained sentence in third person ("Prefers…", "Goal: …"). Return an empty list when there is nothing durable — that is the common case.`;

async function extractAfterTurn({ workspaceId, userId, userText, assistantText, existing = [] }) {
  try {
    const explicit = explicitFacts(userText);
    if (explicit.length) return await store(workspaceId, userId, explicit, 'explicit');
    if (!ai.available() || String(userText || '').length < 12) return [];
    const out = await ai.json({
      system: EXTRACT_SYSTEM,
      prompt: `Already remembered:\n${existing.map((e) => `- ${e}`).join('\n') || '(nothing yet)'}\n\nAgent said:\n${String(userText).slice(0, 2000)}\n\nAssistant replied:\n${String(assistantText || '').slice(0, 1500)}`,
      schema: { type: 'object', properties: { facts: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['fact', 'preference', 'goal', 'style'] }, text: { type: 'string' } } } } } },
      effort: 'low',
      maxTokens: 2000,
      feature: 'serena_memory',
      workspaceId,
    });
    return await store(workspaceId, userId, (out && out.facts) || [], 'extracted');
  } catch (err) {
    if (err && err.code !== 'ai_unavailable') console.warn('[serena] memory extraction failed:', err.message);
    return [];
  }
}

module.exports = { extractAfterTurn, explicitFacts, store };

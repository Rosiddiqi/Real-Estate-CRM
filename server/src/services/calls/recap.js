// Post-call recap: summary + bullets + one-card-at-a-time action suggestions
// (book the showing, the to-dos the agent promised, a follow-up text draft).
// Sources, in order: the simulated script's own recap (demo calls), Claude
// (when available), then a deterministic transcript parser. Suggestions are
// executed only when the agent taps Yes, through the same effects layer as
// Serena (with a 5-minute undo).
const crypto = require('node:crypto');
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const ai = require('../../ai/claude');
const U = require('../serena/util');
const T = require('../serena/time');
const fx = require('../serena/effects');
const { FAIR_HOUSING } = require('../serena/prompt');

const KINDS = ['appointment', 'task', 'text', 'note', 'search'];

function whenPreview(fields, tz) {
  if (!fields) return null;
  if (!fields.date && !fields.time) return null;
  if (fields.time) return U.fmtWhen(T.resolveWhen({ date: fields.date || 'today', time: fields.time }, tz), tz);
  const day = T.parseDay(fields.date, tz);
  return day ? U.fmtDayKey(day, tz) : null;
}

function materialize(list, tz) {
  return (list || []).filter((s) => KINDS.includes(s.kind)).slice(0, 5).map((s, i) => ({
    id: `sg_${s.kind}_${i}`,
    kind: s.kind,
    title: s.title,
    heard: s.heard || null,
    fields: s.fields || {},
    preview: { when: whenPreview(s.fields, tz) },
    status: 'pending',
  }));
}

// ── heuristic extraction (no AI, real transcript) ─────────────────────────
function heuristic(lines, client, tz) {
  const first = client ? U.firstOf(client) : 'them';
  const agentLines = lines.filter((l) => l.speaker === 'agent');
  const suggestions = [];
  const promises = agentLines.filter((l) => /\b(i'?ll|i will|let me|i'?m going to|i can get)\b/i.test(l.text)).slice(0, 3);
  for (const p of promises) {
    const what = p.text.replace(/^.*?\b(i'?ll|i will|let me|i'?m going to|i can get)\b\s*/i, '').replace(/[.!]+$/, '');
    if (what.length < 6) continue;
    suggestions.push({ kind: 'task', title: U.clip(what.charAt(0).toUpperCase() + what.slice(1), 70), heard: p.text, fields: { title: U.clip(what.charAt(0).toUpperCase() + what.slice(1), 120), date: T.parseDay(p.text, tz) ? p.text : 'tomorrow' } });
  }
  const agreed = [...lines].reverse().find((l) => T.parseTime(l.text) && T.parseDay(l.text, tz) && /\b(works|perfect|see you|let'?s|how about|set up|i'?ll call)\b/i.test(l.text));
  if (agreed) {
    const t = T.parseTime(agreed.text);
    const isCall = /\bcall\b/i.test(agreed.text);
    suggestions.unshift({ kind: 'appointment', title: isCall ? `Schedule the call with ${first}?` : `Book it with ${first}?`, heard: agreed.text, fields: { type: isCall ? 'call' : /listing|presentation/i.test(agreed.text) ? 'listing_presentation' : 'showing', date: agreed.text, time: `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` } });
  }
  if (client) suggestions.push({ kind: 'text', title: `Text ${first} a quick recap`, heard: '', fields: { body: `Hi ${first}, thanks for the time today. I'll follow up on everything we discussed shortly.` } });
  const { classify } = require('./cues');
  const raised = [...new Set(lines.filter((l) => l.speaker === 'client').map((l) => (classify(l).cue || {}).title).filter(Boolean))];
  const who = client ? first : 'The caller';
  const summary = lines.length < 3 ? null : [
    `${lines.length < 10 ? 'A short call' : 'A call'} with ${who}${agreed ? ' that ended with a next step agreed' : ''}.`,
    raised.length ? `They raised: ${raised.join(', ').toLowerCase().replace(/“|”/g, '')}.` : null,
    promises.length ? `You committed to ${promises.length} follow-up${promises.length === 1 ? '' : 's'}.` : 'No commitments were made yet.',
  ].filter(Boolean).join(' ');
  const bullets = [
    ...raised.slice(0, 1).map((r) => `Objection: ${r.replace(/“|”/g, '')}`),
    ...promises.slice(0, 2).map((p) => `You: ${U.clip(p.text, 100)}`),
    agreed ? `Agreed: ${U.clip(agreed.text, 100)}` : null,
  ].filter(Boolean).slice(0, 3);
  return { summary, bullets, sentiment: 'neutral', suggestions };
}

const RECAP_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['appointment', 'task', 'text', 'note'] },
          title: { type: 'string' },
          heard: { type: 'string' },
          type: { type: 'string', description: 'appointment type' },
          date: { type: 'string', description: 'today / tomorrow / weekday / YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM 24h or empty' },
          task_title: { type: 'string' },
          body: { type: 'string', description: 'text message draft or note body' },
        },
      },
    },
  },
};

async function aiRecap(call, lines, client, tz) {
  if (!ai.available() || lines.length < 4) return null;
  try {
    const transcript = lines.map((l) => `${l.speaker === 'agent' ? 'AGENT' : 'CLIENT'}: ${l.text}`).join('\n');
    const out = await ai.json({
      system: `You are the AI co-pilot to a luxury real-estate agent. A phone call just ended. Produce:
- summary: 2–3 neutral sentences leading with the outcome (what moved, what was agreed, objections raised).
- bullets: exactly 3 short bullets (≤ 110 chars) — outcome, commitment, objection.
- sentiment.
- suggestions (0–4): ONLY things the AGENT committed to or the two of them agreed on — an appointment they agreed on (kind appointment, with type showing|private_tour|listing_presentation|buyer_consult|call|meeting, date, time), to-dos the agent promised (kind task, task_title imperative, date), one follow-up text draft to the client (kind text, body: first name, brief, specific, no emoji, no em dashes), or a note worth saving (kind note). Never make a suggestion from something the CLIENT said they'd do. Quote the line you heard in "heard".
Never invent facts not in the transcript. ${FAIR_HOUSING}`,
      prompt: `Client: ${client ? U.nameOf(client) : 'unknown caller'}\nCall date: ${new Date(call.startedAt).toISOString().slice(0, 10)}\nDuration: ${call.durationSec}s\n\nTranscript:\n${transcript}`,
      schema: RECAP_SCHEMA,
      effort: 'low',
      maxTokens: 4000,
      feature: 'call_recap',
      workspaceId: call.workspaceId,
    });
    if (!out || !out.summary) return null;
    const suggestions = (out.suggestions || []).map((s) => ({
      kind: s.kind,
      title: s.title,
      heard: s.heard,
      fields: s.kind === 'appointment' ? { type: s.type || 'showing', date: s.date || 'tomorrow', time: s.time || '10:00' }
        : s.kind === 'task' ? { title: s.task_title || s.title, date: s.date || 'tomorrow', time: s.time || undefined }
          : { body: s.body || '' },
    }));
    return { summary: out.summary, bullets: (out.bullets || []).slice(0, 3), sentiment: out.sentiment || 'neutral', suggestions };
  } catch {
    return null;
  }
}

async function generate(callId) {
  const call = await prisma.phoneCall.findUnique({ where: { id: callId }, include: { client: { select: U.CLIENT_LITE } } });
  if (!call) return null;
  const tz = await U.tzFor(call.workspaceId, (call.meta && call.meta.userId) || null);
  const lines = Array.isArray(call.transcript) ? call.transcript.filter((l) => l.speaker !== 'note') : [];
  const meta = (call.meta && typeof call.meta === 'object') ? call.meta : {};
  if (meta.mode === 'device') return generateFromNotes(call, meta, tz);
  let r = null;
  let source = 'heuristic';
  const scripted = meta.script && meta.script.recap && meta.script.linesTotal;
  // A finished demo script carries its own (accurate) recap. A call cut short
  // must only reflect what was actually said.
  if (scripted && lines.length >= meta.script.linesTotal) { r = meta.script.recap; source = 'script'; }
  if (!r) { r = await aiRecap(call, lines, call.client, tz); if (r) source = 'ai'; }
  if (!r) {
    r = heuristic(lines, call.client, tz);
    if (scripted) {
      const spoken = new Set(lines.map((l) => U.norm(l.text)));
      const kept = (meta.script.recap.suggestions || []).filter((sg) => sg.heard && spoken.has(U.norm(sg.heard)));
      const textDraft = (meta.script.recap.suggestions || []).find((sg) => sg.kind === 'text');
      r.suggestions = [...kept, ...r.suggestions.filter((x) => x.kind !== 'task' && x.kind !== 'text'), ...(kept.some((k) => k.kind === 'text') || !call.client ? [] : [{ kind: 'text', title: `Text ${U.firstOf(call.client)} a quick follow-up`, heard: '', fields: { body: `Hi ${U.firstOf(call.client)}, sorry we got cut short. ${textDraft ? 'I’ll follow up with everything we discussed today.' : 'When’s a good time to pick it back up?'}` } }])];
      if (!kept.length && r.suggestions.length > 2) r.suggestions = r.suggestions.slice(0, 2);
    }
    source = 'heuristic';
  }
  const notes = Array.isArray(meta.notes) ? meta.notes.filter((n) => n.text) : [];
  const suggestions = materialize(r.suggestions, tz);
  if (notes.length && !suggestions.some((s) => s.kind === 'note')) {
    suggestions.push({ id: `sg_note_${suggestions.length}`, kind: 'note', title: 'Save your call notes to the file', heard: null, fields: { body: notes.map((n) => n.text).join('\n') }, preview: {}, status: 'pending' });
  }
  const updated = await prisma.phoneCall.update({
    where: { id: call.id },
    data: {
      summary: r.summary || null,
      summaryBullets: r.bullets || [],
      sentiment: r.sentiment || null,
      aiSuggestions: suggestions,
      meta: { ...meta, recapStatus: 'ready', recapSource: source },
    },
    include: { client: { select: U.CLIENT_LITE } },
  });
  // Put the summary on the call's timeline row.
  if (call.clientId && r.summary) {
    await prisma.activity.updateMany({ where: { workspaceId: call.workspaceId, clientId: call.clientId, meta: { path: ['callId'], equals: call.id } }, data: { body: r.summary } }).catch(() => {});
  }
  return updated;
}

// ── device calls: the agent's own notes are the only source ─────────────────
const MEET_RE = /\b(show(ing)?|tour|see (it|the|them|her|him)|walk-?through|meet(ing)?|consult(ation)?|presentation|open house|preview|visit|coffee|lunch|dinner|zoom|call (back|again|her|him|them)|talk again|works|perfect|set up|booked?|confirmed?)\b/i;
const PROMISE_RE = /^(?:i'?ll|i will|i need to|need to|i'?m going to|going to|i have to|have to|i owe (?:her|him|them)|must|to-?do:?|follow up|send|email|pull|get|call|text|book|schedule|draft|prepare|order|confirm|remind|check)\b/i;
const LEAD_RE = /^(?:i'?ll|i will|i need to|need to|i'?m going to|going to|i have to|have to|must|to-?do:?)\s+/i;

function sentencesOf(text) {
  return String(text || '').split(/\n+|(?<=[.!?])\s+/).map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter((x) => x.length > 2);
}
function hhmm(t) { return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`; }

function notesHeuristic(notes, client, tz, outcome, durationSec) {
  const first = client ? U.firstOf(client) : 'them';
  const sentences = sentencesOf(notes);
  const suggestions = [];
  const used = new Set();
  for (const sn of sentences) {
    const t = T.parseTime(sn);
    if (t && T.parseDay(sn, tz) && MEET_RE.test(sn)) {
      const isCall = /\b(call|zoom|talk)\b/i.test(sn) && !/\b(show|tour|see|walk|visit|meet)/i.test(sn);
      const type = isCall ? 'call' : /listing|presentation/i.test(sn) ? 'listing_presentation' : /consult/i.test(sn) ? 'buyer_consult' : /\b(meet|coffee|lunch|dinner)/i.test(sn) ? 'meeting' : /tour/i.test(sn) ? 'private_tour' : 'showing';
      suggestions.push({ kind: 'appointment', title: isCall ? `Schedule the call with ${first}?` : `Book it with ${first}?`, heard: sn, fields: { type, date: sn, time: hhmm(t) } });
      used.add(sn);
      break;
    }
  }
  for (const sn of sentences) {
    if (used.has(sn) || !PROMISE_RE.test(sn) || suggestions.filter((x) => x.kind === 'task').length >= 2) continue;
    const what = sn.replace(LEAD_RE, '').replace(/[.!]+$/, '')
      // "…the HOA docs tomorrow" → "…the HOA docs" (the due date carries the day)
      .replace(/\s+(?:by |on |this |next )?(?:today|tonight|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day|week|morning|afternoon|evening)(?:\s+(?:morning|afternoon|evening|night))?$/i, '')
      .trim();
    if (what.length < 5) continue;
    // "Send her the HOA docs" → "Send Olivia the HOA docs"
    const named = client ? what.replace(/^(\w+)\s+(her|him|them)\b/i, (m, verb) => `${verb} ${first}`) : what;
    const title = named.charAt(0).toUpperCase() + named.slice(1);
    suggestions.push({ kind: 'task', title: U.clip(title, 70), heard: sn, fields: { title: U.clip(title, 120), date: T.parseDay(sn, tz) ? sn : 'tomorrow' } });
    used.add(sn);
  }
  if (client) {
    suggestions.push({ kind: 'note', title: `Save your notes to ${first}’s file`, heard: null, fields: { body: String(notes).trim() } });
    const body = outcome === 'voicemail'
      ? `Hi ${first}, I just left you a voicemail. Give me a call back when you have a minute.`
      : outcome === 'no_answer'
        ? `Hi ${first}, I tried you just now. When’s a good time to talk?`
        : `Hi ${first}, great talking just now. I’ll follow up on everything we covered shortly.`;
    suggestions.push({ kind: 'text', title: outcome === 'talked' ? `Text ${first} a quick follow-up` : outcome === 'voicemail' ? `Text ${first} that you left a voicemail` : `Text ${first} instead?`, heard: '', fields: { body } });
  }
  const lead = outcome === 'talked'
    ? `Talked with ${client ? first : 'them'}${durationSec >= 60 ? ` for ${Math.round(durationSec / 60)} min` : ''}.`
    : outcome === 'voicemail' ? `Left ${client ? first : 'them'} a voicemail.` : `${client ? first : 'They'} didn’t pick up.`;
  const firstNote = sentences[0] ? ` ${U.clip(sentences.slice(0, 2).join(' '), 220)}` : '';
  return { summary: `${lead}${firstNote}`, bullets: [], sentiment: 'neutral', suggestions };
}

async function aiNotesRecap(call, notes, client, tz, outcome) {
  if (!ai.available() || String(notes).trim().length < 12) return null;
  try {
    const out = await ai.json({
      system: `You are the AI co-pilot to a luxury real-estate agent. The agent just made a call from their own phone (no recording) and typed notes. Using ONLY those notes, produce:
- summary: 1–2 neutral sentences leading with the outcome.
- bullets: up to 3 short bullets (≤ 110 chars) — outcome, commitment, objection — only if the notes support them.
- sentiment.
- suggestions (0–4): an appointment the notes say was agreed (kind appointment, with type showing|private_tour|listing_presentation|buyer_consult|call|meeting, date, time), to-dos the agent committed to (kind task, task_title imperative, date), one follow-up text to the client (kind text, body: first name, brief, specific, no emoji, no em dashes), or a note worth saving (kind note). Quote the note line in "heard".
Never invent anything that isn't in the notes. ${FAIR_HOUSING}`,
      prompt: `Client: ${client ? U.nameOf(client) : 'unknown number'}\nCall outcome: ${outcome === 'talked' ? 'they talked' : outcome === 'voicemail' ? 'agent left a voicemail' : 'no answer'}\nCall date: ${new Date(call.startedAt).toISOString().slice(0, 10)}\nDuration: ${call.durationSec}s\n\nAgent's notes:\n${notes}`,
      schema: RECAP_SCHEMA,
      effort: 'low',
      maxTokens: 3000,
      feature: 'call_recap',
      workspaceId: call.workspaceId,
    });
    if (!out || !out.summary) return null;
    const suggestions = (out.suggestions || []).map((x) => ({
      kind: x.kind,
      title: x.title,
      heard: x.heard,
      fields: x.kind === 'appointment' ? { type: x.type || 'showing', date: x.date || 'tomorrow', time: x.time || '10:00' }
        : x.kind === 'task' ? { title: x.task_title || x.title, date: x.date || 'tomorrow', time: x.time || undefined }
          : { body: x.body || '' },
    }));
    return { summary: out.summary, bullets: (out.bullets || []).slice(0, 3), sentiment: out.sentiment || 'neutral', suggestions };
  } catch {
    return null;
  }
}

async function generateFromNotes(call, meta, tz) {
  const notes = (Array.isArray(meta.notes) ? meta.notes : []).map((n) => n && n.text).filter(Boolean).join('\n').trim();
  const outcome = meta.outcome || 'talked';
  if (!notes) {
    return prisma.phoneCall.update({ where: { id: call.id }, data: { summary: null, summaryBullets: [], aiSuggestions: [], meta: { ...meta, recapStatus: 'none' } }, include: { client: { select: U.CLIENT_LITE } } });
  }
  let r = await aiNotesRecap(call, notes, call.client, tz, outcome);
  const source = r ? 'ai' : 'notes';
  if (!r) r = notesHeuristic(notes, call.client, tz, outcome, call.durationSec || 0);
  let suggestions = materialize(r.suggestions, tz);
  if (!call.clientId) suggestions = suggestions.filter((x) => x.kind === 'task');
  if (call.clientId && !suggestions.some((x) => x.kind === 'note')) {
    suggestions.push({ id: `sg_note_${suggestions.length}`, kind: 'note', title: 'Save your notes to the file', heard: null, fields: { body: notes }, preview: {}, status: 'pending' });
  }
  const updated = await prisma.phoneCall.update({
    where: { id: call.id },
    data: { summary: r.summary || null, summaryBullets: r.bullets || [], sentiment: r.sentiment || null, aiSuggestions: suggestions, meta: { ...meta, recapStatus: 'ready', recapSource: source } },
    include: { client: { select: U.CLIENT_LITE } },
  });
  return updated;
}

// ── decisions + undo ───────────────────────────────────────────────────────
const undoTokens = new Map(); // token → { undo, ctx, expiresAt }
setInterval(() => { const now = Date.now(); for (const [k, v] of undoTokens) if (v.expiresAt < now) undoTokens.delete(k); }, 60000).unref();

async function decide({ workspaceId, userId, callId, sid, status, fields }) {
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId }, include: { client: { select: U.CLIENT_LITE } } });
  if (!call) throw Object.assign(new Error('Call not found'), { status: 404 });
  const list = Array.isArray(call.aiSuggestions) ? call.aiSuggestions : [];
  const s = list.find((x) => x.id === sid);
  if (!s) throw Object.assign(new Error('Suggestion not found'), { status: 404 });
  if (s.status === 'yes' || s.status === 'edited') return { suggestion: s, undoToken: null, already: true };
  const tz = await U.tzFor(workspaceId, userId);
  const ctx = { workspaceId, userId, tz, actor: 'agent' };
  const f = { ...(s.fields || {}), ...(fields || {}) };
  let result = null;
  let undo = null;
  let draft = null;
  if (status === 'no') {
    s.status = 'no';
  } else {
    if (s.kind === 'appointment') {
      if (!call.clientId) throw Object.assign(new Error('Save this caller as a client first.'), { status: 400 });
      const startAt = T.resolveWhen({ date: f.date || 'tomorrow', time: f.time || '10:00' }, tz);
      const out = await fx.createAppointment(ctx, { clientId: call.clientId, listingId: f.listingId || null, type: f.type || 'showing', startAt, durationMin: f.durationMin || null, title: f.title || null, notes: `Booked from the call recap${s.heard ? ` — agreed: “${U.clip(s.heard, 140)}”` : ''}`, source: 'call' });
      result = { appointmentId: out.appointment.id, title: out.appointment.title, when: U.fmtWhen(out.appointment.startAt, tz) };
      undo = out.undo;
    } else if (s.kind === 'task') {
      const day = T.parseDay(f.date, tz);
      const t = f.time ? T.parseTime(f.time) : null;
      const dueAt = t && day ? T.resolveWhen({ date: day, time: `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` }, tz) : null;
      const out = await fx.createTask(ctx, { title: f.title || s.title, clientId: call.clientId || null, dueDate: day || null, dueAt, source: 'call', meta: { callId: call.id } });
      result = { taskId: out.task.id, title: out.task.title };
      undo = out.undo;
    } else if (s.kind === 'note') {
      if (!call.clientId) throw Object.assign(new Error('Save this caller as a client first.'), { status: 400 });
      const out = await fx.addNote({ ...ctx, actor: 'agent' }, { clientId: call.clientId, body: f.body || s.title, source: 'call' });
      result = { noteId: out.note.id };
      undo = out.undo;
    } else if (s.kind === 'text') {
      // Customer-facing: never sent from here — the client opens the thread with this draft.
      draft = { clientId: call.clientId, body: f.body || '' };
      result = { draft: true };
    } else if (s.kind === 'search') {
      const out = await fx.addBuyerSearch(ctx, call.clientId, { neighborhoods: f.neighborhoods, priceMax: f.priceMax, bedsMin: f.bedsMin, mustHaves: f.mustHaves, source: 'call' });
      result = { searchId: out.search.id };
      undo = out.undo;
    }
    s.status = status === 'edit' ? 'edited' : 'yes';
    s.fields = f;
    s.result = result;
  }
  s.decidedAt = new Date().toISOString();
  let undoToken = null;
  if (undo) {
    undoToken = `cu_${crypto.randomBytes(12).toString('base64url')}`;
    undoTokens.set(undoToken, { undo, ctx, callId: call.id, sid, expiresAt: Date.now() + 5 * 60e3 });
    s.undoToken = undoToken;
  }
  const suggestions = list.map((x) => (x.id === sid ? s : x));
  const updated = await prisma.phoneCall.update({ where: { id: call.id }, data: { aiSuggestions: suggestions }, include: { client: { select: U.CLIENT_LITE } } });
  try { hub.broadcast(workspaceId, 'call_updated', require('./serialize').serializeCall(updated)); } catch { /* ignore */ }
  return { suggestion: s, undoToken, draft };
}

async function undoDecision({ workspaceId, undoToken }) {
  const entry = undoTokens.get(undoToken);
  if (!entry || entry.ctx.workspaceId !== workspaceId || entry.expiresAt < Date.now()) throw Object.assign(new Error('Undo expired or already used'), { status: 400 });
  undoTokens.delete(undoToken);
  await fx.applyUndo(entry.ctx, entry.undo);
  const call = await prisma.phoneCall.findFirst({ where: { id: entry.callId, workspaceId } });
  if (call && Array.isArray(call.aiSuggestions)) {
    const suggestions = call.aiSuggestions.map((x) => (x.id === entry.sid ? { ...x, status: 'pending', undoToken: null, result: null, decidedAt: null } : x));
    await prisma.phoneCall.update({ where: { id: call.id }, data: { aiSuggestions: suggestions } });
    return { ok: true, sid: entry.sid };
  }
  return { ok: true, sid: entry.sid };
}

module.exports = { generate, decide, undoDecision, whenPreview };

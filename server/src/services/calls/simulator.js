// SimulatedCallDriver — demo-mode calling (no Twilio / speech-to-text).
// "Calls" a client: ringing → answered → streams a realistic scripted
// conversation over the workspace socket as `call_transcript` events (interim
// word-by-word updates, then the final line with its co-pilot signal / cue),
// persists the transcript on the PhoneCall row, honors hold, and on hang-up
// runs the identical post-call pipeline (timeline, recap, suggestions).
const crypto = require('node:crypto');
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { logActivity } = require('../../lib/activity');
const { normalizePhone } = require('../../lib/phone');
const U = require('../serena/util');
const { buildScript } = require('./scripts');
const { classify } = require('./cues');
const { serializeCall } = require('./serialize');
const recap = require('./recap');

const live = new Map(); // callId → state
const RING_MS = 2600;
const WORD_MS = 115;
const IDLE_HANGUP_MS = 25000;

const include = { client: { select: { ...U.CLIENT_LITE } } };

function broadcastCall(workspaceId, call) {
  try { hub.broadcast(workspaceId, 'call_updated', serializeCall(call)); } catch { /* ignore */ }
}

function later(st, fn, ms) {
  const t = setTimeout(() => { st.timers.delete(t); if (!st.ended) fn(); }, ms);
  st.timers.add(t);
  return t;
}
function clearTimers(st) { for (const t of st.timers) clearTimeout(t); st.timers.clear(); }

async function briefingFor(workspaceId, clientId) {
  if (!clientId) return null;
  try {
    const insights = U.optionalRequire('../clients/insights');
    if (!insights || typeof insights.getBriefing !== 'function') return null;
    const b = await Promise.race([insights.getBriefing({ workspaceId, clientId }), new Promise((r) => setTimeout(() => r(null), 2500))]);
    if (!b) return null;
    return {
      statusLine: b.statusLine || null,
      recommendedMove: b.recommendedMove || null,
      iceBreakers: (b.iceBreakers || []).slice(0, 2),
      touchPoints: (b.personalTouchPoints || []).slice(0, 4),
      portfolio: b.portfolioContext || null,
      deal: b.dealContext || null,
      lastContact: b.lastContactSummary || null,
    };
  } catch {
    return null;
  }
}

async function start({ workspaceId, userId, clientId = null, phone = null }) {
  let client = null;
  if (clientId) client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: U.CLIENT_LITE });
  const number = normalizePhone(phone || (client && client.phone) || '');
  if (!client && number) client = await prisma.client.findFirst({ where: { workspaceId, OR: [{ phone: number }, { phoneAlt: number }] }, select: U.CLIENT_LITE });
  if (!client && !number) throw Object.assign(new Error('Nothing to dial — no number on file.'), { status: 400 });

  const [script, briefing] = await Promise.all([
    buildScript({ workspaceId, clientId: client ? client.id : null, userId }),
    briefingFor(workspaceId, client ? client.id : null),
  ]);
  const call = await prisma.phoneCall.create({
    data: {
      workspaceId, clientId: client ? client.id : null, direction: 'outbound', status: 'ringing',
      toNumber: number || (client && client.phone) || null, startedAt: new Date(), externalId: `SIM-${crypto.randomUUID()}`,
      transcript: [],
      meta: { mode: 'simulated', userId, topic: script.topic, briefing, notes: [], script: { scenario: script.scenario, source: script.source, linesTotal: script.lines.length, recap: script.recap || null } },
    },
    include,
  });
  const st = { id: call.id, workspaceId, userId, client, script, idx: 0, lines: [], timers: new Set(), paused: false, ended: false, answeredAt: null };
  live.set(call.id, st);
  broadcastCall(workspaceId, call);
  later(st, () => answer(st), RING_MS);
  return call;
}

async function answer(st) {
  st.answeredAt = new Date();
  const call = await prisma.phoneCall.update({ where: { id: st.id }, data: { status: 'in_progress', answeredAt: st.answeredAt }, include });
  broadcastCall(st.workspaceId, call);
  later(st, () => streamLine(st), 900);
}

function emitLine(st, line, cue) {
  try { hub.broadcast(st.workspaceId, 'call_transcript', { callId: st.id, line, cue: cue || null }); } catch { /* ignore */ }
}

function streamLine(st) {
  if (st.paused || st.ended) return;
  const src = st.script.lines[st.idx];
  if (!src) {
    st.done = true;
    later(st, () => hangup(st.id, { by: 'client' }).catch(() => {}), IDLE_HANGUP_MS);
    return;
  }
  const speaker = src.s === 'agent' ? 'agent' : 'client';
  const words = String(src.text).split(/\s+/);
  const id = `ln_${st.idx}`;
  const t = Math.max(0, Math.round((Date.now() - st.answeredAt.getTime()) / 1000));
  let k = 0;
  const step = () => {
    if (st.paused || st.ended) return;
    k = Math.min(words.length, k + 2 + Math.floor(Math.random() * 2));
    if (k < words.length) {
      emitLine(st, { id, speaker, text: words.slice(0, k).join(' '), t, final: false });
      later(st, step, WORD_MS * 2.4);
      return;
    }
    const line = { id, speaker, text: src.text, t, final: true };
    const { signal, cue } = classify(line);
    if (signal) line.signal = signal;
    st.lines.push(line);
    st.idx += 1;
    emitLine(st, line, cue ? { ...cue, id: `cue_${st.idx}`, lineId: id } : null);
    prisma.phoneCall.update({ where: { id: st.id }, data: { transcript: st.lines } }).catch(() => {});
    const nextSpeaker = st.script.lines[st.idx] && st.script.lines[st.idx].s;
    const pause = nextSpeaker && nextSpeaker !== src.s ? 650 + Math.random() * 700 : 350 + Math.random() * 350;
    later(st, () => streamLine(st), pause + (cue ? 900 : 0));
  };
  later(st, step, 260);
}

async function setHold(callId, held) {
  const st = live.get(callId);
  const call = await prisma.phoneCall.findUnique({ where: { id: callId }, include });
  if (!call) return null;
  const meta = { ...(call.meta || {}), held: !!held };
  const updated = await prisma.phoneCall.update({ where: { id: callId }, data: { meta }, include });
  if (st) {
    if (held && !st.paused) { st.paused = true; clearTimers(st); }
    else if (!held && st.paused) { st.paused = false; if (st.done) later(st, () => hangup(st.id, { by: 'client' }).catch(() => {}), IDLE_HANGUP_MS); else later(st, () => streamLine(st), 700); }
  }
  broadcastCall(updated.workspaceId, updated);
  return updated;
}

async function addNote(callId, workspaceId, { t, text }) {
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId } });
  if (!call) return null;
  const meta = { ...(call.meta || {}) };
  const note = { t: Number(t) || 0, text: text ? String(text).slice(0, 1000) : null, at: new Date().toISOString() };
  meta.notes = [...(Array.isArray(meta.notes) ? meta.notes : []), note];
  await prisma.phoneCall.update({ where: { id: call.id }, data: { meta } });
  try { hub.broadcast(workspaceId, 'call_transcript', { callId, line: { id: `note_${meta.notes.length}`, speaker: 'note', text: note.text || 'Marked', t: note.t, final: true } }); } catch { /* ignore */ }
  return note;
}

// End a call (agent tapped End, or the client hung up). Works for simulated
// calls, Twilio calls (after the provider leg is ended) and stale rows.
async function hangup(callId, { by = 'agent', workspaceId = null } = {}) {
  const st = live.get(callId);
  if (st) { st.ended = true; clearTimers(st); live.delete(callId); }
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, ...(workspaceId ? { workspaceId } : {}) }, include });
  if (!call) return null;
  if (['completed', 'missed', 'no_answer', 'voicemail', 'cancelled', 'failed', 'busy'].includes(call.status) && call.endedAt) return call;
  const now = new Date();
  const answered = call.answeredAt || (st && st.answeredAt);
  const durationSec = answered ? Math.max(1, Math.round((now - new Date(answered)) / 1000)) : 0;
  const status = answered ? 'completed' : (call.direction === 'outbound' ? 'cancelled' : 'missed');
  const meta = { ...(call.meta || {}), endedBy: by, recapStatus: answered ? 'pending' : null, held: false };
  let updated = await prisma.phoneCall.update({ where: { id: call.id }, data: { status, endedAt: now, durationSec, meta, ...(st ? { transcript: st.lines } : {}) }, include });
  broadcastCall(updated.workspaceId, updated);

  if (updated.clientId && answered) {
    const mm = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`;
    await logActivity({
      workspaceId: updated.workspaceId, clientId: updated.clientId, type: updated.direction === 'inbound' ? 'call_in' : 'call_out',
      title: `${updated.direction === 'inbound' ? 'Call from' : 'Called'} ${U.firstOf(updated.client)} · ${mm}`, body: meta.topic || null,
      meta: { callId: updated.id, durationSec }, actor: 'agent',
    });
    await prisma.client.update({ where: { id: updated.clientId }, data: { lastContactedAt: now, ...(updated.direction === 'outbound' ? { lastOutboundAt: now } : { lastInboundAt: now }) } }).catch(() => {});
    try { hub.broadcast(updated.workspaceId, 'client_updated', { id: updated.clientId, reason: 'call' }); } catch { /* ignore */ }
  }
  if (answered) {
    // Recap runs after the hang-up returns (never blocks the UI).
    setTimeout(async () => {
      try {
        updated = await recap.generate(updated.id);
        if (updated) broadcastCall(updated.workspaceId, updated);
      } catch (err) {
        console.error('[calls] recap failed', err.message);
        await prisma.phoneCall.update({ where: { id: callId }, data: { meta: { ...meta, recapStatus: 'failed' } } }).catch(() => {});
      }
    }, 600);
  }
  return updated;
}

function isLive(callId) { return live.has(callId); }

module.exports = { start, hangup, setHold, addNote, isLive, live };

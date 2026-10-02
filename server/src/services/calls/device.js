// Device mode — the agent's own phone places the call (no Twilio, not the demo
// line). Dial creates the outbound PhoneCall as 'dialed' and returns the E.164
// number for the system dialer (tel:). When the agent comes back they log it:
//   talked    → status 'completed' (answered, duration = what they confirm)
//   voicemail → status 'no_answer' + outcome 'voicemail' (they left a message)
//   no_answer → status 'no_answer' + outcome 'no_answer'
// Dismissing keeps it 'dialed' with no outcome. Notes feed the usual
// one-at-a-time recap cards (recap.generate reads meta.notes for device calls).
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const ai = require('../../ai/claude');
const { logActivity } = require('../../lib/activity');
const { normalizePhone, toE164 } = require('../../lib/phone');
const U = require('../serena/util');
const { serializeCall } = require('./serialize');

const include = { client: { select: U.CLIENT_LITE } };
const OUTCOMES = ['talked', 'voicemail', 'no_answer'];
const MAX_SEC = 6 * 3600;

function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function isDevice(call) { return !!(call && call.meta && call.meta.mode === 'device'); }
function mmss(sec) { const s = Math.max(0, Math.round(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

async function dial({ workspaceId, userId, clientId = null, phone = null }) {
  let client = null;
  if (clientId) {
    client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: U.CLIENT_LITE });
    if (!client) throw httpError(404, 'Client not found');
  }
  const number = normalizePhone(phone || (client && client.phone) || '');
  if (!number || number.includes('@') || number.replace(/\D/g, '').length < 7) {
    throw httpError(400, `No phone number for ${client ? U.nameOf(client) : 'that contact'}`);
  }
  if (!client) client = await prisma.client.findFirst({ where: { workspaceId, archivedAt: null, OR: [{ phone: number }, { phoneAlt: number }] }, select: U.CLIENT_LITE });
  const call = await prisma.phoneCall.create({
    data: {
      workspaceId, clientId: client ? client.id : null, direction: 'outbound', status: 'dialed',
      toNumber: number, startedAt: new Date(), transcript: [],
      meta: { mode: 'device', userId, notes: [], recapStatus: 'none' },
    },
    include,
  });
  try { hub.broadcast(workspaceId, 'call_updated', serializeCall(call)); } catch { /* ignore */ }
  return { call, tel: toE164(number) };
}

function clampSec(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_SEC, Math.round(n)));
}

// The agent came back without logging anything: it stays 'dialed', just closed out.
async function closeWithoutOutcome({ workspaceId, callId, durationSec }) {
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId }, include });
  if (!call) throw httpError(404, 'Call not found');
  if (!isDevice(call)) throw httpError(400, 'That call wasn’t placed from your phone.');
  if (call.meta && call.meta.outcome) return call;
  const now = new Date();
  const away = Math.round((now - new Date(call.startedAt)) / 1000);
  const updated = await prisma.phoneCall.update({
    where: { id: call.id },
    data: { endedAt: call.endedAt || now, durationSec: clampSec(durationSec, Math.min(away, MAX_SEC)), meta: { ...(call.meta || {}), dismissed: true } },
    include,
  });
  try { hub.broadcast(workspaceId, 'call_updated', serializeCall(updated)); } catch { /* ignore */ }
  return updated;
}

// Log what happened on a call placed from the agent's phone (re-logging edits it).
async function logOutcome({ workspaceId, userId, callId, outcome, durationSec, notes }) {
  if (!OUTCOMES.includes(outcome)) throw httpError(400, 'Pick how the call went: talked, voicemail or no answer.');
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId }, include });
  if (!call) throw httpError(404, 'Call not found');
  if (!isDevice(call)) throw httpError(400, 'That call wasn’t placed from your phone.');
  const now = new Date();
  const meta = { ...(call.meta || {}) };
  const relog = !!meta.outcome;
  const away = Math.round((now - new Date(call.startedAt)) / 1000);
  const dur = outcome === 'no_answer' ? 0 : clampSec(durationSec, Math.min(away, MAX_SEC));
  const text = String(notes || '').trim().slice(0, 4000);
  const endedAt = relog && call.endedAt ? new Date(call.endedAt) : now;
  meta.outcome = outcome;
  meta.loggedAt = now.toISOString();
  meta.dismissed = false;
  meta.notes = text ? [{ t: 0, text, at: now.toISOString() }] : [];
  meta.recapStatus = text ? 'pending' : 'none';
  meta.finalizedAt = meta.finalizedAt || now.toISOString();
  let updated = await prisma.phoneCall.update({
    where: { id: call.id },
    data: {
      status: outcome === 'talked' ? 'completed' : 'no_answer',
      endedAt,
      answeredAt: outcome === 'talked' ? new Date(endedAt.getTime() - dur * 1000) : null,
      durationSec: dur,
      meta,
      ...(text ? {} : { summary: null, summaryBullets: [], aiSuggestions: [] }),
    },
    include,
  });

  // Timeline + contact clock.
  if (updated.clientId) {
    const first = U.firstOf(updated.client);
    const title = outcome === 'talked' ? `Called ${first} · ${mmss(dur)}` : outcome === 'voicemail' ? `Left ${first} a voicemail` : `Called ${first} · no answer`;
    const body = text ? U.clip(text, 280) : null;
    const existing = relog ? await prisma.activity.findFirst({ where: { workspaceId, clientId: updated.clientId, meta: { path: ['callId'], equals: updated.id } }, select: { id: true } }).catch(() => null) : null;
    if (existing) {
      await prisma.activity.update({ where: { id: existing.id }, data: { title, body, meta: { callId: updated.id, durationSec: dur, outcome } } }).catch(() => {});
    } else {
      await logActivity({ workspaceId, clientId: updated.clientId, type: 'call_out', title, body, meta: { callId: updated.id, durationSec: dur, outcome }, actor: 'agent', occurredAt: new Date(call.startedAt) });
    }
    const touch = outcome === 'no_answer' ? { lastOutboundAt: now } : { lastOutboundAt: now, lastContactedAt: now };
    await prisma.client.update({ where: { id: updated.clientId }, data: touch }).catch(() => {});
    try { hub.broadcast(workspaceId, 'client_updated', { id: updated.clientId, reason: 'call' }); } catch { /* ignore */ }
  }
  try { hub.broadcast(workspaceId, 'call_updated', serializeCall(updated)); } catch { /* ignore */ }

  // Notes → summary + the usual one-at-a-time follow-ups.
  if (text) {
    const recap = require('./recap');
    if (ai.available()) {
      setTimeout(async () => {
        try {
          const done = await recap.generate(updated.id);
          if (done) hub.broadcast(workspaceId, 'call_updated', serializeCall(done));
        } catch (err) {
          console.error('[calls] device recap failed', err.message);
          await prisma.phoneCall.update({ where: { id: updated.id }, data: { meta: { ...meta, recapStatus: 'failed' } } }).catch(() => {});
        }
      }, 50);
    } else {
      updated = (await recap.generate(updated.id)) || updated;
      try { hub.broadcast(workspaceId, 'call_updated', serializeCall(updated)); } catch { /* ignore */ }
    }
  }
  return updated;
}

module.exports = { dial, logOutcome, closeWithoutOutcome, isDevice, OUTCOMES };

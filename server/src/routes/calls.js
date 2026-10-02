// Phone + calls.
//   GET  /api/calls?filter=all|missed|voicemail|outgoing&clientId=&q=&limit=&before=  → { calls, total, counts }
//   GET  /api/calls/suggestions        → { source, suggestions }   ("Call now" hero)
//   GET  /api/calls/active             → { call | null }            (restore the call pill)
//   GET  /api/calls/mode               → { mode: 'twilio' | 'simulated' | 'device' }  (per workspace — services/calls/mode.js)
//   POST /api/calls                    → log a call manually        { clientId, direction, status, durationSec, summary, outcome }
//   POST /api/calls/dial               → { clientId?, phone? } → { call, mode } (+ tel: E.164 in 'device' mode)
//   GET  /api/calls/:id                → { call } (with transcript)
//   POST /api/calls/:id/log            → device calls: { outcome: talked|voicemail|no_answer, durationSec?, notes? } → { call }
//   POST /api/calls/:id/hangup         → ends a live call; device calls: same body as /log (no outcome = stays 'dialed')
//   POST /api/calls/:id/hold {held} | /notes {t,text} | /heard | /recap
//   POST /api/calls/:id/suggestions/:sid  { status: yes|no|edit, fields? } → { suggestion, undoToken, draft }
//   POST /api/calls/undo               → { undoToken } (5-minute window)
// Twilio voice callbacks live in the PUBLIC router routes/callWebhooks.js.
// Realtime: call_updated (serialized call), call_transcript ({ callId, line, cue }).
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { notify } = require('../lib/notify');
const { normalizePhone } = require('../lib/phone');
const { ah, parse, HttpError } = require('../lib/http');
const U = require('../services/serena/util');
const fx = require('../services/serena/effects');
const { serializeCall, MISSED } = require('../services/calls/serialize');
const sim = require('../services/calls/simulator');
const twilio = require('../services/calls/twilio');
const device = require('../services/calls/device');
const recap = require('../services/calls/recap');
const { callModeFor } = require('../services/calls/mode');
const { callSuggestions } = require('../services/calls/callNow');

const router = express.Router();
const include = { client: { select: U.CLIENT_LITE } };

function listWhere(req) {
  const wid = req.workspaceId;
  const where = { workspaceId: wid };
  const f = String(req.query.filter || 'all');
  if (f === 'missed') { where.direction = 'inbound'; where.status = { in: MISSED }; }
  if (f === 'voicemail') where.status = 'voicemail';
  if (f === 'outgoing') where.direction = 'outbound';
  if (req.query.clientId) where.clientId = String(req.query.clientId);
  if (req.query.before) where.startedAt = { lt: new Date(String(req.query.before)) };
  const q = String(req.query.q || '').trim();
  if (q) {
    const digits = normalizePhone(q);
    const or = [{ client: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } }];
    if (digits.length >= 3) or.push({ fromNumber: { contains: digits } }, { toNumber: { contains: digits } });
    where.OR = or;
  }
  return where;
}

router.get('/', ah(async (req, res) => {
  const take = Math.min(300, parseInt(req.query.limit, 10) || 120);
  const where = listWhere(req);
  const base = { workspaceId: req.workspaceId, ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}) };
  const [rows, total, all, missed, voicemail, unheard] = await Promise.all([
    prisma.phoneCall.findMany({ where, include, orderBy: { startedAt: 'desc' }, take }),
    prisma.phoneCall.count({ where }),
    prisma.phoneCall.count({ where: base }),
    prisma.phoneCall.count({ where: { ...base, direction: 'inbound', status: { in: MISSED } } }),
    prisma.phoneCall.count({ where: { ...base, status: 'voicemail' } }),
    prisma.phoneCall.count({ where: { ...base, status: 'voicemail', voicemailHeard: false } }),
  ]);
  res.json({ calls: rows.map((c) => serializeCall(c)), total, counts: { all, missed, voicemail, unheard } });
}));

router.get('/suggestions', ah(async (req, res) => {
  const out = await callSuggestions({ workspaceId: req.workspaceId, userId: req.userId, limit: Math.min(8, parseInt(req.query.limit, 10) || 4) });
  res.json({
    source: out.source,
    suggestions: out.suggestions.map((s) => ({
      clientId: s.clientId, name: s.name, firstName: s.firstName, phone: s.phone, avatarUrl: s.avatarUrl, whale: s.whale, rating: s.rating,
      reason: s.reason, why: s.why, score: s.score, kind: s.kind, dealId: s.dealId || null, callId: s.callId || null,
    })),
  });
}));

router.get('/active', ah(async (req, res) => {
  const since = new Date(Date.now() - 2 * 3600e3);
  const call = await prisma.phoneCall.findFirst({ where: { workspaceId: req.workspaceId, status: { in: ['ringing', 'in_progress'] }, startedAt: { gte: since } }, include, orderBy: { startedAt: 'desc' } });
  if (call && call.meta && call.meta.mode === 'simulated' && sim.isOrphan(call)) {
    // The driver died with a restart — close it out quietly.
    await sim.hangup(call.id, { by: 'system', workspaceId: req.workspaceId }).catch(() => {});
    return res.json({ call: null });
  }
  res.json({ call: call ? serializeCall(call, { transcript: true }) : null });
}));

router.get('/mode', ah(async (req, res) => {
  res.json({ mode: await callModeFor(req.workspaceId) });
}));

const LogBody = z.object({
  clientId: z.string(),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  status: z.enum(['completed', 'missed', 'no_answer', 'voicemail', 'busy', 'failed']).default('completed'),
  durationSec: z.number().int().min(0).max(36000).default(0),
  summary: z.string().max(4000).optional().nullable(),
  outcome: z.string().max(80).optional().nullable(),
  startedAt: z.string().optional().nullable(),
});

router.post('/', ah(async (req, res) => {
  const body = parse(LogBody, req.body || {});
  const tz = await U.tzFor(req.workspaceId, req.userId);
  const { call } = await fx.logCall({ workspaceId: req.workspaceId, userId: req.userId, tz, actor: 'agent' }, { ...body, startedAt: body.startedAt || null });
  if (body.direction === 'inbound' && ['missed', 'voicemail', 'no_answer'].includes(body.status)) {
    const c = await U.getClientLite(req.workspaceId, body.clientId);
    await notify({ workspaceId: req.workspaceId, type: body.status === 'voicemail' ? 'voicemail' : 'call_missed', title: `${body.status === 'voicemail' ? 'Voicemail' : 'Missed call'} from ${U.nameOf(c)}`, body: body.summary || null, data: { callId: call.id, clientId: body.clientId } });
  }
  const full = await prisma.phoneCall.findUnique({ where: { id: call.id }, include });
  res.status(201).json({ call: serializeCall(full) });
}));

const DialBody = z.object({ clientId: z.string().optional().nullable(), phone: z.string().optional().nullable() });

router.post('/dial', ah(async (req, res) => {
  const { clientId, phone } = parse(DialBody, req.body || {});
  if (!clientId && !phone) throw new HttpError(400, 'Who should I call?');
  // One live call at a time.
  const live = await prisma.phoneCall.findFirst({ where: { workspaceId: req.workspaceId, status: { in: ['ringing', 'in_progress'] }, startedAt: { gte: new Date(Date.now() - 2 * 3600e3) } }, include });
  if (live && (live.meta?.mode !== 'simulated' || !sim.isOrphan(live))) return res.json({ call: serializeCall(live, { transcript: true }), mode: live.meta?.mode || 'phone', existing: true });
  if (live) await sim.hangup(live.id, { by: 'system' }).catch(() => {});
  const mode = await callModeFor(req.workspaceId);
  if (mode === 'twilio') {
    const call = await twilio.dial({ workspaceId: req.workspaceId, userId: req.userId, clientId, phone });
    return res.json({ call: serializeCall(call, { transcript: true }), mode: 'twilio' });
  }
  if (mode === 'device') {
    // The agent's own phone places it: the app hands `tel` to the system dialer.
    try {
      const { call, tel } = await device.dial({ workspaceId: req.workspaceId, userId: req.userId, clientId, phone });
      return res.json({ call: serializeCall(call, { transcript: true }), mode: 'device', tel });
    } catch (err) {
      throw new HttpError(err.status || 400, err.message);
    }
  }
  const call = await sim.start({ workspaceId: req.workspaceId, userId: req.userId, clientId, phone });
  res.json({ call: serializeCall(call, { transcript: true }), mode: 'simulated' });
}));

// Save an unknown caller as a client; links every earlier call from the number.
const SaveBody = z.object({ phone: z.string().min(7), firstName: z.string().min(1).max(80), lastName: z.string().max(80).optional().default(''), type: z.string().max(30).optional().default('buyer') });
router.post('/save-contact', ah(async (req, res) => {
  const body = parse(SaveBody, req.body || {});
  const tz = await U.tzFor(req.workspaceId, req.userId);
  const { client, existing } = await fx.createClient({ workspaceId: req.workspaceId, userId: req.userId, tz, actor: 'agent' }, { firstName: body.firstName, lastName: body.lastName, phone: body.phone, type: body.type, leadSource: 'Phone call' });
  if (existing) {
    const ph = normalizePhone(body.phone);
    await prisma.phoneCall.updateMany({ where: { workspaceId: req.workspaceId, clientId: null, OR: [{ fromNumber: ph }, { toNumber: ph }] }, data: { clientId: client.id } });
  }
  hub.broadcast(req.workspaceId, 'call_updated', { refresh: true });
  res.json({ client: { id: client.id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, name: U.nameOf(client) }, existing: !!existing });
}));

router.post('/undo', ah(async (req, res) => {
  const token = String((req.body && req.body.undoToken) || '');
  if (!token) throw new HttpError(400, 'undoToken required');
  try {
    res.json(await recap.undoDecision({ workspaceId: req.workspaceId, undoToken: token }));
  } catch (err) {
    throw new HttpError(err.status || 400, err.message);
  }
}));

// ── single call ──────────────────────────────────────────────────────────
async function own(req) {
  const call = await prisma.phoneCall.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId }, include });
  if (!call) throw new HttpError(404, 'Call not found');
  return call;
}

router.get('/:id', ah(async (req, res) => {
  const call = await own(req);
  res.json({ call: serializeCall(call, { transcript: true }) });
}));

// Calls placed from the agent's own phone: log the outcome (or just close it out).
const DeviceLogBody = z.object({
  outcome: z.enum(device.OUTCOMES).optional().nullable(),
  durationSec: z.number().min(0).max(6 * 3600).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

async function deviceLog(req, call, { requireOutcome }) {
  const body = parse(DeviceLogBody, req.body || {});
  try {
    if (!body.outcome) {
      if (requireOutcome) throw new HttpError(400, 'Pick how the call went: talked, voicemail or no answer.');
      return await device.closeWithoutOutcome({ workspaceId: req.workspaceId, callId: call.id, durationSec: body.durationSec });
    }
    return await device.logOutcome({ workspaceId: req.workspaceId, userId: req.userId, callId: call.id, outcome: body.outcome, durationSec: body.durationSec, notes: body.notes });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(err.status || 400, err.message);
  }
}

router.post('/:id/log', ah(async (req, res) => {
  const call = await own(req);
  if (!device.isDevice(call)) throw new HttpError(400, 'Only calls placed from your phone are logged this way.');
  const updated = await deviceLog(req, call, { requireOutcome: true });
  res.json({ call: serializeCall(updated, { transcript: true }) });
}));

router.post('/:id/hangup', ah(async (req, res) => {
  const call = await own(req);
  if (device.isDevice(call)) {
    const updated = await deviceLog(req, call, { requireOutcome: false });
    return res.json({ call: serializeCall(updated, { transcript: true }) });
  }
  await twilio.hangupLeg(call);
  const ended = await sim.hangup(call.id, { by: 'agent', workspaceId: req.workspaceId });
  res.json({ call: serializeCall(ended, { transcript: true }) });
}));

router.post('/:id/hold', ah(async (req, res) => {
  await own(req);
  const updated = await sim.setHold(req.params.id, !!(req.body && req.body.held));
  res.json({ call: serializeCall(updated) });
}));

router.post('/:id/notes', ah(async (req, res) => {
  await own(req);
  const note = await sim.addNote(req.params.id, req.workspaceId, { t: req.body && req.body.t, text: req.body && req.body.text });
  res.json({ ok: true, note });
}));

router.post('/:id/heard', ah(async (req, res) => {
  const call = await own(req);
  if (!call.voicemailHeard) {
    const updated = await prisma.phoneCall.update({ where: { id: call.id }, data: { voicemailHeard: true }, include });
    hub.broadcast(req.workspaceId, 'call_updated', serializeCall(updated));
  }
  res.json({ ok: true });
}));

router.post('/:id/recap', ah(async (req, res) => {
  const call = await own(req);
  if (device.isDevice(call)) {
    // Device calls recap from the agent's notes; optional { notes } replaces them first.
    if (!call.meta || !call.meta.outcome) throw new HttpError(400, 'Log how the call went first.');
    if (req.body && typeof req.body.notes === 'string') {
      const text = req.body.notes.trim().slice(0, 4000);
      await prisma.phoneCall.update({ where: { id: call.id }, data: { meta: { ...call.meta, notes: text ? [{ t: 0, text, at: new Date().toISOString() }] : [] } } });
    }
  } else if (!['completed'].includes(call.status)) throw new HttpError(400, 'The call hasn’t ended yet.');
  const updated = await recap.generate(call.id);
  hub.broadcast(req.workspaceId, 'call_updated', serializeCall(updated));
  res.json({ call: serializeCall(updated, { transcript: true }) });
}));

const DecideBody = z.object({ status: z.enum(['yes', 'no', 'edit']), fields: z.record(z.any()).optional() });

router.post('/:id/suggestions/:sid', ah(async (req, res) => {
  const { status, fields } = parse(DecideBody, req.body || {});
  try {
    const out = await recap.decide({ workspaceId: req.workspaceId, userId: req.userId, callId: req.params.id, sid: req.params.sid, status, fields });
    const { undoToken, ...s } = out.suggestion;
    res.json({ ok: true, suggestion: { ...s, undoable: !!undoToken }, undoToken: out.undoToken, draft: out.draft || null });
  } catch (err) {
    throw new HttpError(err.status || 400, err.message);
  }
}));

module.exports = router;

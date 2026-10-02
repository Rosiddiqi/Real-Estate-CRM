// Real calling via Twilio click-to-call — DORMANT unless TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and AGENT_CELL_NUMBER are all set.
// Flow: Twilio rings the agent's cell → when answered, our TwiML bridges the
// leg to the client (recorded, caller ID = the workspace number). Status
// callbacks keep the PhoneCall row (and the call screen) in sync. Callbacks hit
// the PUBLIC router routes/callWebhooks.js (/api/webhooks/twilio/voice/*): each
// is X-Twilio-Signature-verified and carries a short-lived per-call token that
// names the workspace.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { toE164, normalizePhone } = require('../../lib/phone');
const U = require('../serena/util');
const { serializeCall } = require('./serialize');

function enabled() {
  const t = config.twilio;
  return !!(t.accountSid && t.authToken && t.phoneNumber && t.agentCell);
}

let client = null;
function twilioClient() {
  if (!client) client = require('twilio')(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

// Per-call callback token. Signed with a DERIVED secret so it can never pass the
// API's session check (requireAuth also reads ?token=) — it only names the workspace.
const hookSecret = () => crypto.createHmac('sha256', String(config.auth.jwtSecret || '')).update('twilio-voice-hooks').digest('hex');
function hookToken({ userId, workspaceId }) {
  return jwt.sign({ sub: userId, wid: workspaceId, hook: 'twilio' }, hookSecret(), { expiresIn: '4h' });
}
// Same public origin rule as routes/webhooks.js (Twilio signs the exact URL it calls).
function base() { return String(process.env.PUBLIC_URL || config.appUrl || '').replace(/\/$/, ''); }
const HOOKS = '/api/webhooks/twilio/voice';

function verifyHookToken(token) {
  try {
    const p = jwt.verify(String(token || ''), hookSecret());
    return p && p.hook === 'twilio' && p.wid ? { workspaceId: p.wid, userId: p.sub } : null;
  } catch {
    return null;
  }
}

async function dial({ workspaceId, userId, clientId, phone }) {
  let c = null;
  if (clientId) c = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: U.CLIENT_LITE });
  const to = normalizePhone(phone || (c && c.phone) || '');
  if (!to) throw Object.assign(new Error('No number to dial.'), { status: 400 });
  const call = await prisma.phoneCall.create({
    data: { workspaceId, clientId: c ? c.id : null, direction: 'outbound', status: 'ringing', toNumber: to, fromNumber: normalizePhone(config.twilio.phoneNumber), startedAt: new Date(), transcript: [], meta: { mode: 'twilio', userId, notes: [] } },
    include: { client: { select: U.CLIENT_LITE } },
  });
  const tok = hookToken({ userId, workspaceId });
  const q = `callId=${encodeURIComponent(call.id)}&token=${encodeURIComponent(tok)}`;
  try {
    const leg = await twilioClient().calls.create({
      to: toE164(config.twilio.agentCell),
      from: toE164(config.twilio.phoneNumber),
      url: `${base()}${HOOKS}/bridge?${q}`,
      statusCallback: `${base()}${HOOKS}/status?${q}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
    });
    const updated = await prisma.phoneCall.update({ where: { id: call.id }, data: { externalId: leg.sid }, include: { client: { select: U.CLIENT_LITE } } });
    hub.broadcast(workspaceId, 'call_updated', serializeCall(updated));
    return updated;
  } catch (err) {
    await prisma.phoneCall.update({ where: { id: call.id }, data: { status: 'failed', endedAt: new Date() } }).catch(() => {});
    throw Object.assign(new Error(`Twilio couldn’t place the call: ${err.message}`), { status: 502 });
  }
}

function escapeXml(s) { return String(s || '').replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch])); }

// TwiML returned when the agent picks up their cell: bridge to the client.
async function bridgeTwiml({ workspaceId, callId, token }) {
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId }, include: { client: { select: U.CLIENT_LITE } } });
  if (!call) return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, that call is no longer available.</Say><Hangup/></Response>';
  const who = call.client ? U.firstOf(call.client) : 'your client';
  const q = `callId=${encodeURIComponent(call.id)}&token=${encodeURIComponent(token)}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Connecting you to ${escapeXml(who)}.</Say><Dial callerId="${escapeXml(toE164(config.twilio.phoneNumber))}" record="record-from-answer-dual" action="${escapeXml(`${base()}${HOOKS}/dial-status?${q}`)}"><Number>${escapeXml(toE164(call.toNumber))}</Number></Dial></Response>`;
}

async function statusUpdate({ workspaceId, callId, body }) {
  const call = await prisma.phoneCall.findFirst({ where: { id: callId, workspaceId } });
  if (!call) return null;
  const s = String(body.CallStatus || body.DialCallStatus || '').toLowerCase();
  const data = {};
  if (s === 'in-progress' || s === 'answered') { data.status = 'in_progress'; if (!call.answeredAt) data.answeredAt = new Date(); }
  if (s === 'ringing') data.status = 'ringing';
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(s)) {
    const next = s === 'completed' ? 'completed' : s === 'no-answer' ? 'no_answer' : s === 'canceled' ? 'cancelled' : s;
    // The agent's own leg completing must not overwrite how the client leg ended (no answer, busy…).
    const agentLegDone = !body.DialCallStatus && next === 'completed' && ['no_answer', 'busy', 'failed', 'cancelled'].includes(call.status);
    if (!agentLegDone) data.status = next;
    if (!call.endedAt) data.endedAt = new Date();
    const dur = Number(body.DialCallDuration || body.CallDuration || 0);
    if (dur && (body.DialCallDuration || !call.durationSec)) data.durationSec = dur;
  }
  if (body.RecordingUrl) data.recordingUrl = `${body.RecordingUrl}.mp3`;
  if (!Object.keys(data).length) return call;
  const updated = await prisma.phoneCall.update({ where: { id: call.id }, data, include: { client: { select: U.CLIENT_LITE } } });
  hub.broadcast(workspaceId, 'call_updated', serializeCall(updated));
  return updated;
}

async function hangupLeg(call) {
  if (!enabled() || !call || !call.externalId || String(call.externalId).startsWith('SIM')) return false;
  try { await twilioClient().calls(call.externalId).update({ status: 'completed' }); return true; } catch { return false; }
}

module.exports = { enabled, dial, bridgeTwiml, statusUpdate, hangupLeg, verifyHookToken, HOOKS };

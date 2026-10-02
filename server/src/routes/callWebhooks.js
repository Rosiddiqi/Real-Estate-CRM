// Twilio VOICE callbacks for click-to-call — PUBLIC router (Twilio can't send a JWT).
// Mount (index.js ROUTES): ['/api/webhooks/twilio/voice', 'callWebhooks', { public: true }]
//   POST /api/webhooks/twilio/voice/bridge       TwiML when the agent answers their cell → <Dial> the client
//   POST /api/webhooks/twilio/voice/status       status callbacks for the agent's leg
//   POST /api/webhooks/twilio/voice/dial-status  <Dial action> callback for the client's leg
// Every request must carry a valid X-Twilio-Signature (TWILIO_AUTH_TOKEN; 403
// otherwise, including when Twilio isn't configured) plus the per-call token
// services/calls/twilio.dial() minted. The workspace comes from the PhoneCall
// row that token + callId resolve to — never from the request body.
const express = require('express');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ah } = require('../lib/http');
const twilio = require('../services/calls/twilio');
const sim = require('../services/calls/simulator');

const router = express.Router();
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Same rules as routes/webhooks.js: Twilio signs the exact public URL it called.
function publicUrl(req) {
  const base = String(process.env.PUBLIC_URL || config.appUrl || '').replace(/\/$/, '');
  return `${base || `${req.protocol}://${req.get('host')}`}${req.originalUrl}`;
}

function verifyTwilio(req) {
  if (!config.twilio.authToken) return false;
  try {
    const sdk = require('twilio');
    const sig = req.get('X-Twilio-Signature') || '';
    return sdk.validateRequest(config.twilio.authToken, sig, publicUrl(req), req.body || {});
  } catch {
    return false;
  }
}

async function resolveCall(req) {
  const callId = String(req.query.callId || '');
  const claims = twilio.verifyHookToken(req.query.token);
  if (!callId || !claims) return null;
  return prisma.phoneCall.findFirst({ where: { id: callId, workspaceId: claims.workspaceId }, select: { id: true, workspaceId: true } });
}

// Signature first, then the call; both failures are a flat 403.
function guarded(handler) {
  return ah(async (req, res) => {
    if (!verifyTwilio(req)) return res.status(403).type('text/xml').send(EMPTY_TWIML);
    const call = await resolveCall(req);
    if (!call) return res.status(403).type('text/xml').send(EMPTY_TWIML);
    return handler(req, res, call);
  });
}

router.post('/bridge', guarded(async (req, res, call) => {
  const xml = await twilio.bridgeTwiml({ workspaceId: call.workspaceId, callId: call.id, token: String(req.query.token || '') });
  res.type('text/xml').send(xml);
}));

router.post('/status', guarded(async (req, res, call) => {
  const updated = await twilio.statusUpdate({ workspaceId: call.workspaceId, callId: call.id, body: req.body || {} });
  // The call ended on the provider side: timeline + recap, once.
  if (updated && updated.status === 'completed' && updated.answeredAt) await sim.finalizeEnded(call.id, call.workspaceId).catch(() => {});
  res.type('text/xml').send(EMPTY_TWIML);
}));

router.post('/dial-status', guarded(async (req, res, call) => {
  await twilio.statusUpdate({ workspaceId: call.workspaceId, callId: call.id, body: req.body || {} });
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
}));

module.exports = router;

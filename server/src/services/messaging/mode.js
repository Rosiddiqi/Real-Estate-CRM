// Per-workspace messaging mode — how a text actually leaves KeyMatch.
//
//   'demo'   simulated delivery receipts + believable client replies (the demo
//            book, local dev, QA). Never touches a real phone number.
//   'twilio' real SMS through the business line (MESSAGING_PROVIDER=twilio and
//            TWILIO_* configured).
//   'device' hand-off to the agent's own phone: the send is recorded as sent
//            (meta.via 'device') and the API returns an `sms:` URL that opens
//            Messages with the text prefilled. No receipts, no replies, and no
//            unattended sends (campaigns / Send Later need a business line).
//
// SIMULATE_MESSAGING picks which workspaces are simulated:
//   all   every workspace (default when NODE_ENV !== 'production')
//   demo  only the shared demo workspace (DEMO_EMAIL's workspace; production default)
//   none  no workspace
// Simulation wins over Twilio for the workspaces it covers, so the demo book
// can never text a real number.
//
//   const { messagingModeFor, canAutoSend, assertCanAutoSend } = require('../services/messaging/mode');
const prisma = require('../../lib/prisma');
const { HttpError } = require('../../lib/http');
const config = require('../../config');
const twilio = require('./providers/twilio');

function simulateSetting() {
  const v = String(process.env.SIMULATE_MESSAGING || '').trim().toLowerCase();
  if (v === 'all' || v === 'demo') return v;
  if (v === 'none' || v === 'off' || v === '0' || v === 'false') return 'none';
  return process.env.NODE_ENV === 'production' ? 'demo' : 'all';
}

function twilioActive() {
  return String(config.messaging.provider || '').toLowerCase() === 'twilio' && twilio.configured();
}

// The demo workspace = the workspace of the DEMO_EMAIL user. Re-checked every
// minute (the nightly demo re-seed may recreate it).
let demoCache = { id: undefined, at: 0 };
async function demoWorkspaceId() {
  if (demoCache.id !== undefined && Date.now() - demoCache.at < 60_000) return demoCache.id;
  const email = String(process.env.DEMO_EMAIL || 'demo@keymatch.app').toLowerCase();
  let id = null;
  try {
    const u = await prisma.user.findUnique({ where: { email }, select: { workspaceId: true } });
    id = u ? u.workspaceId : null;
  } catch { id = null; }
  demoCache = { id, at: Date.now() };
  return id;
}

async function messagingModeFor(workspaceId) {
  const sim = simulateSetting();
  if (sim === 'all') return 'demo';
  if (sim === 'demo' && workspaceId && workspaceId === await demoWorkspaceId()) return 'demo';
  if (twilioActive()) return 'twilio';
  return 'device';
}

// Unattended sends (campaigns, automations, Send Later) need a line KeyMatch
// can send through on its own — demo or Twilio, never the agent's phone.
async function canAutoSend(workspaceId) {
  return (await messagingModeFor(workspaceId)) !== 'device';
}

const DEVICE_MODE_CODE = 'device_mode';
async function assertCanAutoSend(workspaceId, what = 'campaigns') {
  if (await canAutoSend(workspaceId)) return;
  const err = new HttpError(409, `Connect a business texting line (Twilio) to send ${what}`, { code: DEVICE_MODE_CODE });
  err.code = DEVICE_MODE_CODE;
  throw err;
}

const MODE_LABEL = {
  demo: 'Demo line · simulated delivery',
  twilio: 'Business texting line (Twilio)',
  device: 'Your phone’s Messages app',
};

async function messagingInfo(workspaceId) {
  const mode = await messagingModeFor(workspaceId);
  return { mode, provider: mode, label: MODE_LABEL[mode], canAutoSend: mode !== 'device', simulate: simulateSetting() };
}

module.exports = { messagingModeFor, canAutoSend, assertCanAutoSend, messagingInfo, simulateSetting, DEVICE_MODE_CODE, MODE_LABEL };

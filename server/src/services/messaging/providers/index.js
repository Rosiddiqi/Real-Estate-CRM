// Provider selection. MESSAGING_PROVIDER picks the transport:
//   demo   (default) — simulated delivery + believable client replies
//   twilio — real SMS/MMS when TWILIO_* is configured (falls back to demo
//            with a console warning when the credentials are missing)
// The iMessage bridge transport is out of scope for this build (owner
// decision); `bridge` is accepted as a value but routes to demo.
const config = require('../../../config');
const demo = require('./demo');
const twilio = require('./twilio');

let warned = false;

function selectProvider() {
  const pref = String(config.messaging.provider || 'demo').toLowerCase();
  if (pref === 'twilio') {
    if (twilio.configured()) return twilio;
    if (!warned) { warned = true; console.warn('[messaging] MESSAGING_PROVIDER=twilio but TWILIO_* is not set — using the demo provider'); }
  }
  return demo;
}

function providerInfo() {
  const p = selectProvider();
  return { id: p.id, label: p.label, capabilities: p.capabilities, twilio: twilio.configured() };
}

module.exports = { selectProvider, providerInfo, demo, twilio };

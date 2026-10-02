// Twilio SMS/MMS provider — MINIMAL. Active only when MESSAGING_PROVIDER=twilio
// and TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER are set.
//   send → POST Messages (StatusCallback when the app has a public https URL)
//   inbound → POST /api/webhooks/twilio/sms        (routes/webhooks.js)
//   status  → POST /api/webhooks/twilio/status     (routes/webhooks.js)
// Not covered yet: 10DLC registration, group MMS, media re-hosting via signed
// URLs (attachments must already be publicly reachable over https).
const config = require('../../../config');
const { toE164 } = require('../../../lib/phone');

let sdkClient = null;

function configured() {
  return !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber);
}

function sdk() {
  if (!sdkClient) {
    const twilio = require('twilio');
    sdkClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return sdkClient;
}

function publicBase() {
  return String(process.env.PUBLIC_URL || config.appUrl || '').replace(/\/$/, '');
}

function absolute(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${publicBase()}${url.startsWith('/') ? '' : '/'}${url}`;
}

const STATUS_MAP = {
  accepted: 'sending', queued: 'sending', scheduled: 'sending', sending: 'sending',
  sent: 'sent', delivered: 'delivered', read: 'read', undelivered: 'failed', failed: 'failed', canceled: 'failed',
};
const mapStatus = (s) => STATUS_MAP[String(s || '').toLowerCase()] || null;

async function send({ message, conversation }) {
  if (!configured()) return { accepted: false, error: 'Twilio is not configured', retryable: false };
  const to = toE164(conversation.handle);
  if (!to || to.includes('@')) return { accepted: false, error: 'SMS needs a phone number', retryable: false };
  const mediaUrl = (message.attachments || []).map((a) => absolute(a.url)).filter((u) => /^https:\/\//i.test(u || ''));
  const base = publicBase();
  try {
    const res = await sdk().messages.create({
      from: config.twilio.phoneNumber,
      to,
      body: message.body || '',
      ...(mediaUrl.length ? { mediaUrl } : {}),
      ...(base.startsWith('https://') ? { statusCallback: `${base}/api/webhooks/twilio/status` } : {}),
    });
    return { accepted: true, externalId: res.sid, status: mapStatus(res.status) || 'sending' };
  } catch (err) {
    return { accepted: false, error: err.message || 'Twilio send failed', retryable: false };
  }
}

module.exports = {
  id: 'twilio',
  label: 'Twilio SMS',
  capabilities: { channels: ['sms'], readReceipts: false, typing: false, reactions: 'text-fallback' },
  configured,
  send,
  mapStatus,
};

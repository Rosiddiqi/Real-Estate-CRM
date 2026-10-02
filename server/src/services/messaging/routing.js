// Device routing — decide iMessage (blue) vs SMS (green) per client from
// evidence, and resolve which service a send should use. Pure decision
// functions are exported for tests; `applyEvidence` persists them.
//
// Evidence ladder (ported from RevMatch services/deviceRouting):
//   iPhone proof  → inbound iMessage, or one of OUR iMessages delivered/read
//   Android proof → an iMessage the network rejected (code 22 / undeliverable),
//                   or inbound SMS from someone with no iPhone proof on file
// An explicit choice by the agent always wins until new evidence arrives.

const IPHONE_EVENTS = new Set(['inbound_imessage', 'imessage_delivered', 'imessage_read']);
const ANDROID_EVENTS = new Set(['imessage_failed', 'imessage_undeliverable', 'inbound_sms']);

const REASONS = {
  inbound_imessage: 'Received an iMessage from them',
  imessage_delivered: 'Our iMessage was delivered',
  imessage_read: 'They read our iMessage',
  imessage_failed: 'iMessage was rejected for this number',
  imessage_undeliverable: 'iMessage never delivered — fell back to text',
  inbound_sms: 'They text from a non-iPhone (SMS)',
  explicit_imessage: 'Set to iMessage by you',
  explicit_sms: 'Set to Text Message by you',
};

// current: { mode: 'imessage'|'sms'|null, reason?: string }
// returns { mode, reason } when the evidence changes the mode, else null.
function decideDeviceMode(current, event) {
  const mode = current && current.mode ? current.mode : null;
  const reason = (current && current.reason) || '';
  if (event === 'explicit_imessage') return mode === 'imessage' && reason === REASONS.explicit_imessage ? null : { mode: 'imessage', reason: REASONS.explicit_imessage };
  if (event === 'explicit_sms') return mode === 'sms' && reason === REASONS.explicit_sms ? null : { mode: 'sms', reason: REASONS.explicit_sms };
  if (IPHONE_EVENTS.has(event)) {
    if (mode === 'imessage') return null;
    return { mode: 'imessage', reason: REASONS[event] };
  }
  if (ANDROID_EVENTS.has(event)) {
    if (mode === 'sms') return null;
    // An inbound SMS from someone we have iPhone proof for is just iMessage
    // being off for a moment (no signal, Wi-Fi only) — keep them blue.
    if (event === 'inbound_sms' && mode === 'imessage' && reason !== REASONS.explicit_sms) return null;
    return { mode: 'sms', reason: REASONS[event] };
  }
  return null;
}

// Which service should this send go out on?
//   requested  — what the composer asked for ('imessage' | 'sms' | undefined)
//   explicit   — true when the agent deliberately flipped the channel toggle
//   deviceMode — the client's evidence-based mode
//   channel    — the conversation's current channel
//   capabilities — provider channels (e.g. Twilio = ['sms'])
function resolveSendService({ requested, explicit = false, deviceMode, channel, isGroup = false, capabilities = ['imessage', 'sms'] } = {}) {
  const can = (s) => capabilities.includes(s);
  let svc;
  if (isGroup) svc = requested || channel || 'imessage';
  else if (explicit && requested) svc = requested;
  else if (requested === 'sms') svc = 'sms';
  else if (deviceMode === 'sms') svc = 'sms';
  else svc = requested || deviceMode || channel || 'imessage';
  if (!can(svc)) svc = can('sms') ? 'sms' : capabilities[0];
  return svc;
}

// Persist evidence for a client/conversation and broadcast when it changes.
async function applyEvidence({ workspaceId, clientId, conversationId, event }) {
  const prisma = require('../../lib/prisma');
  const hub = require('../../realtime/hub');
  let changed = null;
  try {
    if (clientId) {
      const c = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, deviceMode: true, deviceModeReason: true } });
      if (c) {
        const next = decideDeviceMode({ mode: c.deviceMode, reason: c.deviceModeReason }, event);
        if (next) {
          await prisma.client.update({ where: { id: c.id }, data: { deviceMode: next.mode, deviceModeReason: next.reason } });
          changed = next;
        }
      }
    }
    if (conversationId) {
      const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true, deliveryMode: true, deliveryModeReason: true } });
      if (conv) {
        const next = changed || decideDeviceMode({ mode: conv.deliveryMode, reason: conv.deliveryModeReason }, event);
        if (next && (next.mode !== conv.deliveryMode || next.reason !== conv.deliveryModeReason)) {
          await prisma.conversation.update({ where: { id: conv.id }, data: { deliveryMode: next.mode, deliveryModeReason: next.reason } });
          changed = next;
          hub.broadcast(workspaceId, 'conversation_updated', { id: conv.id, deliveryMode: next.mode, deliveryModeReason: next.reason, partial: true });
        }
      }
    }
  } catch (err) {
    console.error('[messaging] routing evidence failed:', err.message);
  }
  return changed;
}

module.exports = { decideDeviceMode, resolveSendService, applyEvidence, REASONS };

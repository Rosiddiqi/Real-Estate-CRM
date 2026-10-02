// Messaging mode gate for everything automated. 'twilio' and 'demo' send;
// 'device' (a real account without a business line: each text hands off to
// the phone's Messages app, one at a time) cannot send anything in bulk, so
// campaigns pause with reason 'needs_texting_line' and automations hold their
// queue. Drafting, saving and reading replies all keep working.
//
// The mode comes from messagingModeFor(workspaceId) in services/messaging
// (the inbox builder's). Until that exists, every workspace reads as 'demo'.
const { HttpError } = require('../../lib/http');

const NEEDS_LINE = 'needs_texting_line';
const NEEDS_LINE_MESSAGE = 'Campaigns need a business texting line. Connect Twilio in Settings to send. You can still build and save drafts.';
const TTL_MS = 30000;
const cache = new Map();

async function messagingMode(workspaceId, { fresh = false } = {}) {
  const hit = cache.get(workspaceId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.mode;
  let mode = 'demo';
  try {
    const messaging = require('../messaging');
    if (messaging && typeof messaging.messagingModeFor === 'function') {
      mode = (await messaging.messagingModeFor(workspaceId)) || 'demo';
    }
  } catch (err) {
    console.error('[campaigns/mode] messagingModeFor failed, treating as demo:', err.message);
    mode = hit ? hit.mode : 'demo';
  }
  cache.set(workspaceId, { mode, at: Date.now() });
  return mode;
}

const isDeviceMode = async (workspaceId, opts) => (await messagingMode(workspaceId, opts)) === 'device';

// For request handlers that would start sending (launch, resume, approve).
async function assertCanSend(workspaceId) {
  if (await isDeviceMode(workspaceId, { fresh: true })) throw new HttpError(409, NEEDS_LINE_MESSAGE, { code: NEEDS_LINE });
}

// Workspaces currently known to be in device mode (from the cache only).
function cachedDeviceWorkspaces() {
  const now = Date.now();
  return [...cache.entries()].filter(([, v]) => v.mode === 'device' && now - v.at < TTL_MS).map(([k]) => k);
}

module.exports = { NEEDS_LINE, NEEDS_LINE_MESSAGE, messagingMode, isDeviceMode, assertCanSend, cachedDeviceWorkspaces };

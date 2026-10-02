// Demo provider — a simulated phone network so the demo book (and any
// workspace without a real provider) behaves like iMessage:
//   sending → sent (~0.5s) → delivered (~1s) → read (4–20s, iMessage only)
// …then, for a natural subset of texts, the client replies: a typing bubble
// first, then a believable reply in the client's voice (AI with the thread as
// context when available, otherwise context-aware canned replies).
//
// The timeline is a pure function (`planDelivery`) so the state machine is
// unit-tested; `send` just schedules it. Timers are unref'd and per-process.
const config = require('../../../config');

const REPLY_ODDS = { agent: 0.72, serena: 0.6, campaign: 0.45 };
const MAX_REPLIES_PER_WINDOW = 4;
const REPLY_WINDOW_MS = 15 * 60_000;

function rnd(rand, min, max) { return Math.round(min + rand() * (max - min)); }

// Pure: the status timeline (ms offsets from dispatch) for one outbound text.
//   → { steps: [{ status, at }], reply: { typingAt, at } | null }
function planDelivery({ service = 'imessage', source = 'agent', rand = Math.random, autoReplies = true, replyBudget = MAX_REPLIES_PER_WINDOW } = {}) {
  const steps = [];
  const sentAt = rnd(rand, 350, 700);
  steps.push({ status: 'sent', at: sentAt });
  const deliveredAt = sentAt + rnd(rand, 450, 900);
  steps.push({ status: 'delivered', at: deliveredAt });
  let seenAt = deliveredAt;
  // Read receipts exist on iMessage only — and not everyone shares them.
  if (service === 'imessage' && rand() < 0.78) {
    const readAt = Math.max(deliveredAt + 1500, rnd(rand, 4000, 20000));
    steps.push({ status: 'read', at: readAt });
    seenAt = readAt;
  }
  let reply = null;
  const odds = REPLY_ODDS[source] ?? 0.5;
  if (autoReplies && replyBudget > 0 && rand() < odds) {
    const at = seenAt + rnd(rand, 5000, 16000);
    const typingAt = Math.max(seenAt + 600, at - rnd(rand, 2200, 4200));
    reply = { typingAt, at };
  }
  return { steps, reply };
}

// ── per-process scheduling state ──────────────────────────────────────────
const replyLog = new Map();      // conversationId -> number[] timestamps of auto replies
const pendingReply = new Map();  // conversationId -> { timers: [] }

function budgetFor(conversationId, now = Date.now()) {
  const arr = (replyLog.get(conversationId) || []).filter((t) => now - t < REPLY_WINDOW_MS);
  replyLog.set(conversationId, arr);
  return MAX_REPLIES_PER_WINDOW - arr.length;
}

function later(ms, fn) {
  const t = setTimeout(() => { Promise.resolve().then(fn).catch((e) => console.error('[demo] step failed:', e.message)); }, ms);
  if (t.unref) t.unref();
  return t;
}

function cancelPendingReply(conversationId) {
  const p = pendingReply.get(conversationId);
  if (!p) return;
  for (const t of p.timers) clearTimeout(t);
  pendingReply.delete(conversationId);
  if (p.typing) {
    const hub = require('../../../realtime/hub');
    hub.broadcast(p.workspaceId, 'typing', { conversationId, isTyping: false, from: 'client' });
  }
}

async function send({ workspaceId, message, conversation, client, source = 'agent' }) {
  const { applyStatus } = require('../status');
  const hub = require('../../../realtime/hub');
  const service = message.service === 'sms' ? 'sms' : 'imessage';
  const canReply = config.messaging.demoAutoReplies && !conversation.isGroup && !conversation.blocked && message.kind !== 'system';
  const plan = planDelivery({ service, source, autoReplies: canReply, replyBudget: budgetFor(conversation.id) });

  for (const step of plan.steps) {
    later(step.at, () => applyStatus({ workspaceId, messageId: message.id, status: step.status }));
  }

  if (plan.reply) {
    // A newer text in the same thread supersedes a reply still being "typed".
    cancelPendingReply(conversation.id);
    const entry = { timers: [], workspaceId, typing: false };
    pendingReply.set(conversation.id, entry);
    entry.timers.push(later(plan.reply.typingAt, () => {
      entry.typing = true;
      hub.broadcast(workspaceId, 'typing', { conversationId: conversation.id, isTyping: true, from: 'client' });
    }));
    // Write the reply while they "type" so AI latency hides inside the bubble.
    const draft = draftReply({ workspaceId, conversation, client, message }).catch(() => null);
    entry.timers.push(later(plan.reply.at, async () => {
      const body = (await draft) || null;
      pendingReply.delete(conversation.id);
      if (!body) {
        hub.broadcast(workspaceId, 'typing', { conversationId: conversation.id, isTyping: false, from: 'client' });
        return;
      }
      const arr = replyLog.get(conversation.id) || [];
      arr.push(Date.now());
      replyLog.set(conversation.id, arr);
      const { ingestInbound } = require('../ingest');
      await ingestInbound({
        workspaceId,
        conversationId: conversation.id,
        handle: conversation.handle,
        body,
        service,
        provider: 'demo',
        sentAt: new Date(),
      });
      hub.broadcast(workspaceId, 'typing', { conversationId: conversation.id, isTyping: false, from: 'client' });
    }));
  }
  return { accepted: true, status: 'sending' };
}

async function draftReply({ workspaceId, conversation, client, message }) {
  const ai = require('../ai');
  return ai.demoClientReply({ workspaceId, conversationId: conversation.id, client, lastOutbound: message });
}

module.exports = {
  id: 'demo',
  label: 'Demo (simulated delivery)',
  capabilities: { channels: ['imessage', 'sms'], readReceipts: true, typing: true, reactions: 'native' },
  configured: () => true,
  send,
  planDelivery,
  cancelPendingReply,
  REPLY_ODDS,
};

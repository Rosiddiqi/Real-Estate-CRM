// Demo provider — a simulated phone network so the demo book (and any
// workspace without a real provider) behaves like iMessage:
//   sending → sent (~0.5s) → delivered (~1s) → read (4–20s, iMessage only)
// …then, for a natural subset of texts, the client replies: a typing bubble
// first, then a believable reply in the client's voice (AI with the thread as
// context when available, otherwise context-aware canned replies).
//
// The timeline is a pure, SEEDED function of the message id (`planDelivery`),
// so (a) the state machine is unit-tested and (b) a server restart can resume
// every in-flight message exactly where it was (`recover`). The auto-reply is
// claimed atomically on the queue row (attempts 1 → 2), so several API
// processes sharing the database never double-reply.
const config = require('../../../config');

const REPLY_ODDS = { agent: 0.72, serena: 0.6, campaign: 0.45 };
const MAX_REPLIES_PER_WINDOW = 4;
const REPLY_WINDOW_MS = 15 * 60_000;
const RECOVER_WINDOW_MS = 10 * 60_000;

// Deterministic PRNG (mulberry32) seeded from a string.
function seededRand(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const readRoll = rand();
  if (service === 'imessage' && readRoll < 0.78) {
    const readAt = Math.max(deliveredAt + 1500, rnd(rand, 4000, 20000));
    steps.push({ status: 'read', at: readAt });
    seenAt = readAt;
  }
  let reply = null;
  const odds = REPLY_ODDS[source] ?? 0.5;
  const replyRoll = rand();
  const replyDelay = rnd(rand, 5000, 16000);
  const typingLead = rnd(rand, 2200, 4200);
  if (autoReplies && replyBudget > 0 && replyRoll < odds) {
    const at = seenAt + replyDelay;
    const typingAt = Math.max(seenAt + 600, at - typingLead);
    reply = { typingAt, at };
  }
  return { steps, reply };
}

// ── per-process scheduling state ──────────────────────────────────────────
const replyLog = new Map();      // conversationId -> number[] timestamps of auto replies
const pendingReply = new Map();  // conversationId -> { timers, workspaceId, typing, messageId }

function budgetFor(conversationId, now = Date.now()) {
  const arr = (replyLog.get(conversationId) || []).filter((t) => now - t < REPLY_WINDOW_MS);
  replyLog.set(conversationId, arr);
  return MAX_REPLIES_PER_WINDOW - arr.length;
}

function later(ms, fn) {
  const t = setTimeout(() => { Promise.resolve().then(fn).catch((e) => console.error('[demo] step failed:', e.message)); }, Math.max(0, ms));
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

function sourceOf(message) {
  if (message.campaignId) return 'campaign';
  return (message.meta && message.meta.source) || 'agent';
}

// Claim the right to auto-reply to this queue row (exactly one process wins).
async function claimReply(queueId) {
  if (!queueId) return true;
  const prisma = require('../../../lib/prisma');
  const r = await prisma.outboundQueue.updateMany({ where: { id: queueId, attempts: 1 }, data: { attempts: 2 } });
  return r.count === 1;
}

// Schedule the remainder of a plan. `elapsed` = ms already passed since dispatch.
function schedule({ workspaceId, message, conversation, client, plan, elapsed = 0, queueId }) {
  const { applyStatus } = require('../status');
  const hub = require('../../../realtime/hub');
  for (const step of plan.steps) {
    later(step.at - elapsed, () => applyStatus({ workspaceId, messageId: message.id, status: step.status }));
  }
  if (!plan.reply) return;
  if (plan.reply.at - elapsed < -2 * 60_000) return; // stale — let it go
  // A newer text in the same thread supersedes a reply still being "typed".
  cancelPendingReply(conversation.id);
  const entry = { timers: [], workspaceId, typing: false, messageId: message.id };
  pendingReply.set(conversation.id, entry);
  if (plan.reply.typingAt - elapsed > 0) {
    entry.timers.push(later(plan.reply.typingAt - elapsed, () => {
      entry.typing = true;
      hub.broadcast(workspaceId, 'typing', { conversationId: conversation.id, isTyping: true, from: 'client' });
    }));
  }
  // Write the reply while they "type" so AI latency hides inside the bubble.
  let draft = null;
  const startDraft = () => { if (!draft) draft = draftReply({ workspaceId, conversation, client, message }).catch(() => null); return draft; };
  entry.timers.push(later(Math.max(0, plan.reply.typingAt - elapsed - 200), startDraft));
  entry.timers.push(later(plan.reply.at - elapsed, async () => {
    const body = await startDraft();
    if (pendingReply.get(conversation.id) === entry) pendingReply.delete(conversation.id);
    const stopTyping = () => hub.broadcast(workspaceId, 'typing', { conversationId: conversation.id, isTyping: false, from: 'client' });
    if (!body || !(await claimReply(queueId))) { stopTyping(); return; }
    const arr = replyLog.get(conversation.id) || [];
    arr.push(Date.now());
    replyLog.set(conversation.id, arr);
    const { ingestInbound } = require('../ingest');
    await ingestInbound({
      workspaceId,
      conversationId: conversation.id,
      handle: conversation.handle,
      body,
      service: message.service === 'sms' ? 'sms' : 'imessage',
      provider: 'demo',
      sentAt: new Date(),
    });
    stopTyping();
  }));
}

async function send({ workspaceId, queueId, message, conversation, client, source = 'agent' }) {
  const service = message.service === 'sms' ? 'sms' : 'imessage';
  const canReply = config.messaging.demoAutoReplies && !conversation.isGroup && !conversation.blocked && message.kind !== 'system';
  const plan = planDelivery({ service, source, rand: seededRand(message.id), autoReplies: canReply, replyBudget: budgetFor(conversation.id) });
  schedule({ workspaceId, message, conversation, client, plan, elapsed: 0, queueId });
  return { accepted: true, status: 'sending' };
}

async function draftReply({ workspaceId, conversation, client, message }) {
  const ai = require('../ai');
  return ai.demoClientReply({ workspaceId, conversationId: conversation.id, client, lastOutbound: message });
}

// Boot-time resume: a restart (deploy, `node --watch`) must not strand texts
// on "Sending…" or swallow a reply that was about to arrive.
async function recover() {
  const prisma = require('../../../lib/prisma');
  const since = new Date(Date.now() - RECOVER_WINDOW_MS);
  const queue = await prisma.outboundQueue.findMany({
    where: { provider: 'demo', createdAt: { gt: since }, messageId: { not: null }, status: { not: 'failed' } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  if (!queue.length) return 0;
  const msgs = await prisma.message.findMany({
    where: { id: { in: queue.map((q) => q.messageId) }, isFromMe: true, status: { in: ['sending', 'sent', 'delivered', 'read'] } },
    include: { attachments: true },
  });
  const byId = new Map(msgs.map((m) => [m.id, m]));
  let n = 0;
  for (const q of queue) {
    const m = byId.get(q.messageId);
    if (!m) continue;
    const conversation = await prisma.conversation.findFirst({ where: { id: m.conversationId, workspaceId: m.workspaceId } });
    if (!conversation) continue;
    // Only the latest outbound in a thread may still earn a reply, and only
    // if the client hasn't already answered.
    const newer = await prisma.message.findFirst({ where: { conversationId: m.conversationId, sentAt: { gt: m.sentAt } }, select: { id: true } });
    const client = conversation.clientId ? await prisma.client.findFirst({ where: { id: conversation.clientId } }) : null;
    const service = m.service === 'sms' ? 'sms' : 'imessage';
    const canReply = !newer && q.attempts <= 1 && config.messaging.demoAutoReplies && !conversation.isGroup && !conversation.blocked;
    const plan = planDelivery({ service, source: sourceOf(m), rand: seededRand(m.id), autoReplies: canReply });
    const elapsed = Date.now() - new Date(q.createdAt).getTime();
    schedule({ workspaceId: m.workspaceId, message: m, conversation, client, plan, elapsed, queueId: q.id });
    n += 1;
  }
  return n;
}

module.exports = {
  id: 'demo',
  label: 'Demo (simulated delivery)',
  capabilities: { channels: ['imessage', 'sms'], readReceipts: true, typing: true, reactions: 'native' },
  configured: () => true,
  send,
  recover,
  planDelivery,
  seededRand,
  cancelPendingReply,
  REPLY_ODDS,
};

// Delivery status machine. Outbound statuses only ever move forward:
//   queued → sending → sent → delivered → read
// `failed` can land from any pre-delivery state (a provider rejection), but a
// message the recipient already READ never turns red. Applying the same status
// twice is a no-op, so provider retries / duplicate callbacks are harmless.
const RANK = { scheduled: 0, queued: 1, sending: 2, sent: 3, delivered: 4, read: 5 };

function nextStatus(current, incoming) {
  if (!incoming || incoming === current) return null;
  if (incoming === 'failed') return current === 'read' ? null : 'failed';
  if (incoming === 'cancelled') return current === 'scheduled' ? 'cancelled' : null;
  if (current === 'failed') {
    // A late "sent/delivered" after a failure means it actually went through.
    return RANK[incoming] >= RANK.sent ? incoming : null;
  }
  const a = RANK[current] ?? -1;
  const b = RANK[incoming];
  if (b == null) return null;
  return b > a ? incoming : null;
}

// Apply a provider status update to a message (by id or externalId) and fan it
// out. Returns the updated serialized message or null when nothing changed.
async function applyStatus({ workspaceId, messageId, externalId, status, error, at = new Date() }) {
  const prisma = require('../../lib/prisma');
  const hub = require('../../realtime/hub');
  const { serializeMessage, MESSAGE_INCLUDE } = require('./serialize');
  const events = require('./events');

  const where = messageId ? { id: messageId, workspaceId } : { externalId, workspaceId };
  const msg = await prisma.message.findFirst({ where });
  if (!msg) return null;
  const next = nextStatus(msg.status, status);
  if (!next) return null;
  const data = { status: next };
  if (next === 'delivered' && !msg.deliveredAt) data.deliveredAt = at;
  if (next === 'read') { data.readAt = at; if (!msg.deliveredAt) data.deliveredAt = at; }
  if (next === 'failed') data.error = error || msg.error || 'Not delivered';
  if (next !== 'failed' && msg.error) data.error = null;
  const updated = await prisma.message.update({ where: { id: msg.id }, data, include: MESSAGE_INCLUDE });

  // Keep the queue row honest too.
  try {
    if (next === 'failed' || next === 'sent' || next === 'delivered' || next === 'read') {
      await prisma.outboundQueue.updateMany({
        where: { workspaceId, messageId: msg.id, status: { in: ['pending', 'sending', 'rate_deferred'] } },
        data: { status: next === 'failed' ? 'failed' : 'sent', error: next === 'failed' ? data.error : null, sentAt: next === 'failed' ? undefined : at },
      });
    }
  } catch (_) { /* queue bookkeeping must never block status */ }

  // The conversation row mirrors the status of its latest outbound message.
  try {
    const conv = await prisma.conversation.findFirst({ where: { id: msg.conversationId, workspaceId } });
    if (conv && conv.lastMessageFromMe && conv.lastMessageAt && Math.abs(new Date(conv.lastMessageAt) - new Date(msg.sentAt)) < 1500) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageStatus: next } });
      hub.broadcast(workspaceId, 'conversation_updated', { id: conv.id, lastMessageStatus: next, partial: true });
    }
  } catch (_) { /* best effort */ }

  const out = serializeMessage(updated);
  hub.broadcast(workspaceId, 'message_updated', { message: out, conversationId: msg.conversationId });
  events.emit('status', { workspaceId, message: out, status: next });
  return out;
}

module.exports = { RANK, nextStatus, applyStatus };

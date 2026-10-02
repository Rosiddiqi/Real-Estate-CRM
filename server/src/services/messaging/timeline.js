// Thread history = messages + (for client threads) phone calls as call bubbles
// + relationship activity pills ("Added to KeyMatch", deal stage changes,
// properties, showings, notes) merged by time — the RevMatch "everything in
// one thread" view. Paged newest-first by `before`, returned oldest-first.
const prisma = require('../../lib/prisma');
const config = require('../../config');
const { HttpError } = require('../../lib/http');
const { serializeMessage, MESSAGE_INCLUDE } = require('./serialize');

const ACTIVITY_TYPES = ['note', 'deal_created', 'deal_stage_change', 'deal_closed', 'property_added', 'search_updated', 'showing', 'appointment'];

function fmtDay(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function callItem(c, conversationId) {
  return {
    id: `call:${c.id}`,
    conversationId,
    isFromMe: c.direction === 'outbound',
    kind: 'call',
    body: null,
    service: 'call',
    status: c.status,
    sentAt: c.startedAt,
    attachments: [],
    reactions: [],
    synthetic: true,
    meta: {
      call: {
        id: c.id, direction: c.direction, status: c.status, durationSec: c.durationSec,
        summary: c.summary, bullets: Array.isArray(c.summaryBullets) ? c.summaryBullets.slice(0, 3) : null,
        hasRecording: !!c.recordingUrl,
        voicemail: !!c.voicemailUrl,
      },
    },
  };
}

function activityItem(a, conversationId) {
  return {
    id: `act:${a.id}`,
    conversationId,
    isFromMe: true,
    kind: 'activity',
    body: `${a.title} · ${fmtDay(a.occurredAt)}`,
    service: 'activity',
    status: 'sent',
    sentAt: a.occurredAt,
    attachments: [],
    reactions: [],
    synthetic: true,
    meta: { activity: { id: a.id, type: a.type, title: a.title, note: a.type === 'note' ? a.body : null } },
  };
}

async function listMessages({ workspaceId, conversationId, before, limit = 60, withTimeline = true }) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true, clientId: true, createdAt: true } });
  if (!conv) throw new HttpError(404, 'Conversation not found');
  const take = Math.min(150, Math.max(10, Number(limit) || 60));
  const beforeDate = before ? new Date(before) : null;
  const rows = await prisma.message.findMany({
    where: {
      workspaceId,
      conversationId,
      status: { notIn: ['scheduled', 'cancelled'] },
      ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { sentAt: { lt: beforeDate } } : {}),
    },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    take: take + 1,
    include: MESSAGE_INCLUDE,
  });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take).reverse();
  const items = page.map(serializeMessage);

  if (withTimeline && conv.clientId) {
    const from = hasMore && page.length ? page[0].sentAt : null;
    const to = beforeDate;
    const range = {};
    if (from) range.gte = from;
    if (to) range.lt = to;
    const [calls, acts, client] = await Promise.all([
      prisma.phoneCall.findMany({
        where: { workspaceId, OR: [{ conversationId }, { clientId: conv.clientId }], ...(Object.keys(range).length ? { startedAt: range } : {}) },
        orderBy: { startedAt: 'desc' },
        take: 40,
      }).catch(() => []),
      prisma.activity.findMany({
        where: { workspaceId, clientId: conv.clientId, type: { in: ACTIVITY_TYPES }, ...(Object.keys(range).length ? { occurredAt: range } : {}) },
        orderBy: { occurredAt: 'desc' },
        take: 40,
      }).catch(() => []),
      !hasMore ? prisma.client.findFirst({ where: { id: conv.clientId, workspaceId }, select: { id: true, createdAt: true } }) : null,
    ]);
    for (const c of calls) items.push(callItem(c, conversationId));
    for (const a of acts) items.push(activityItem(a, conversationId));
    items.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
    if (client) {
      const firstAt = items.length ? new Date(items[0].sentAt) : null;
      const addedAt = firstAt && firstAt < new Date(client.createdAt) ? firstAt : client.createdAt;
      items.unshift({
        id: `added:${client.id}`,
        conversationId,
        isFromMe: true,
        kind: 'activity',
        body: `Added to ${config.brand.name} · ${fmtDay(client.createdAt)}`,
        service: 'activity',
        status: 'sent',
        sentAt: addedAt,
        attachments: [],
        reactions: [],
        synthetic: true,
        meta: { activity: { type: 'added', pinnedFirst: true } },
      });
    }
  }
  return { messages: items, hasMore };
}

module.exports = { listMessages, ACTIVITY_TYPES };

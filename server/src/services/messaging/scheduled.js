// Scheduled ("Send Later") messages: Message rows with status 'scheduled' +
// scheduledFor. The scheduledSends job dispatches due rows every 30s; the
// claim in dispatchScheduled is atomic so two servers never double-send.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { serializeMessage, MESSAGE_INCLUDE } = require('./serialize');
const { dispatchScheduled } = require('./send');

async function listScheduled({ workspaceId, conversationId }) {
  const rows = await prisma.message.findMany({
    where: { workspaceId, status: 'scheduled', ...(conversationId ? { conversationId } : {}) },
    orderBy: { scheduledFor: 'asc' },
    include: MESSAGE_INCLUDE,
    take: 200,
  });
  return rows.map(serializeMessage);
}

async function loadScheduled(workspaceId, id) {
  const row = await prisma.message.findFirst({ where: { id, workspaceId }, include: MESSAGE_INCLUDE });
  if (!row) throw new HttpError(404, 'Scheduled message not found');
  if (row.status !== 'scheduled') throw new HttpError(409, 'That message already went out');
  return row;
}

async function updateScheduled({ workspaceId, id, body, scheduledFor }) {
  const row = await loadScheduled(workspaceId, id);
  const data = {};
  if (typeof body === 'string') {
    const b = body.trim();
    if (!b && !row.attachments.length) throw new HttpError(400, 'Message is empty');
    data.body = b || null;
  }
  if (scheduledFor) {
    const when = new Date(scheduledFor);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30_000) throw new HttpError(400, 'Pick a time at least a minute from now');
    data.scheduledFor = when;
    data.sentAt = when;
  }
  const up = await prisma.message.update({ where: { id: row.id }, data, include: MESSAGE_INCLUDE });
  const message = serializeMessage(up);
  hub.broadcast(workspaceId, 'message_updated', { message, conversationId: up.conversationId, scheduled: true });
  return message;
}

async function cancelScheduled({ workspaceId, id }) {
  const row = await loadScheduled(workspaceId, id);
  const up = await prisma.message.update({ where: { id: row.id }, data: { status: 'cancelled' }, include: MESSAGE_INCLUDE });
  const message = serializeMessage(up);
  hub.broadcast(workspaceId, 'message_updated', { message, conversationId: up.conversationId, scheduled: true });
  return message;
}

async function sendNow({ workspaceId, id }) {
  await loadScheduled(workspaceId, id);
  const message = await dispatchScheduled({ workspaceId, messageId: id });
  if (!message) throw new HttpError(409, 'That message already went out');
  return message;
}

// Job entry: every due scheduled message across workspaces (oldest first).
async function dispatchDue({ limit = 50 } = {}) {
  const due = await prisma.message.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
    select: { id: true, workspaceId: true },
  });
  let sent = 0;
  for (const m of due) {
    try {
      const out = await dispatchScheduled({ workspaceId: m.workspaceId, messageId: m.id });
      if (out) sent += 1;
    } catch (err) {
      console.error('[scheduled-sends] dispatch failed:', err.message);
    }
  }
  return { due: due.length, sent };
}

module.exports = { listScheduled, updateScheduled, cancelScheduled, sendNow, dispatchDue };

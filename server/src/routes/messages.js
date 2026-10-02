// /api/messages — thread history, send/retry/delete, tapbacks, Send Later,
// link previews and the thread AI helpers (reply chips, summary, drafts).
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse } = require('../lib/http');
const { sendMessage, retryMessage } = require('../services/messaging/send');
const { listMessages } = require('../services/messaging/timeline');
const { listScheduled, updateScheduled, cancelScheduled, sendNow } = require('../services/messaging/scheduled');
const { serializeMessage, serializeReaction, MESSAGE_INCLUDE } = require('../services/messaging/serialize');
const { previewFor } = require('../services/messaging/util');
const { getPreview } = require('../services/messaging/linkPreview');
const msgAi = require('../services/messaging/ai');

const router = express.Router();

// GET /api/messages?conversationId=&before=&limit=&timeline=0|1 → { messages (oldest→newest), hasMore }
router.get('/', ah(async (req, res) => {
  const conversationId = String(req.query.conversationId || '');
  if (!conversationId) throw new HttpError(400, 'conversationId is required');
  const out = await listMessages({
    workspaceId: req.workspaceId,
    conversationId,
    before: req.query.before || null,
    limit: req.query.limit,
    withTimeline: req.query.timeline !== '0' && req.query.timeline !== 'false',
  });
  res.set('Cache-Control', 'no-store');
  res.json(out);
}));

const attachmentSchema = z.object({
  url: z.string().min(1),
  mimeType: z.string().nullish(),
  mimetype: z.string().nullish(),
  fileName: z.string().nullish(),
  name: z.string().nullish(),
  size: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  durationMs: z.number().nullish(),
  kind: z.string().nullish(),
}).passthrough();

const sendSchema = z.object({
  conversationId: z.string().optional(),
  clientId: z.string().optional(),
  handle: z.string().optional(),
  body: z.string().max(4000).optional().default(''),
  attachments: z.array(attachmentSchema).max(20).optional(),
  service: z.enum(['imessage', 'sms', 'iMessage', 'SMS']).optional(),
  explicitService: z.boolean().optional(),
  clientTempId: z.string().max(80).optional(),
  scheduledFor: z.string().optional(),
  listingId: z.string().optional(),
  replyToId: z.string().optional(),
  aiGenerated: z.boolean().optional(),
  meta: z.record(z.any()).optional(),
});

// POST /api/messages/send → 201 { message, conversation }
router.post('/send', ah(async (req, res) => {
  const b = parse(sendSchema, req.body || {});
  if (!b.conversationId && !b.clientId && !b.handle) throw new HttpError(400, 'conversationId, clientId or handle is required');
  let meta = b.meta ? { ...b.meta } : null;
  if (b.replyToId) {
    const parent = await prisma.message.findFirst({ where: { id: b.replyToId, workspaceId: req.workspaceId }, select: { id: true, body: true, isFromMe: true } });
    if (parent) meta = { ...(meta || {}), replyTo: { id: parent.id, body: (parent.body || '').slice(0, 140), isFromMe: parent.isFromMe } };
  }
  const out = await sendMessage({
    workspaceId: req.workspaceId,
    userId: req.userId,
    conversationId: b.conversationId,
    clientId: b.clientId,
    handle: b.handle,
    body: b.body,
    attachments: b.attachments,
    service: b.service,
    explicitService: b.explicitService,
    clientTempId: b.clientTempId,
    scheduledFor: b.scheduledFor,
    listingId: b.listingId,
    replyToId: b.replyToId,
    aiGenerated: b.aiGenerated,
    meta,
    source: 'agent',
  });
  res.status(201).json(out);
}));

// ── Send Later ────────────────────────────────────────────────────────────
router.get('/scheduled', ah(async (req, res) => {
  const scheduled = await listScheduled({ workspaceId: req.workspaceId, conversationId: req.query.conversationId ? String(req.query.conversationId) : null });
  res.json({ scheduled, total: scheduled.length });
}));

router.patch('/scheduled/:id', ah(async (req, res) => {
  const b = parse(z.object({ body: z.string().max(4000).optional(), scheduledFor: z.string().optional() }), req.body || {});
  res.json({ message: await updateScheduled({ workspaceId: req.workspaceId, id: req.params.id, ...b }) });
}));

router.delete('/scheduled/:id', ah(async (req, res) => {
  res.json({ message: await cancelScheduled({ workspaceId: req.workspaceId, id: req.params.id }) });
}));

router.post('/scheduled/:id/send-now', ah(async (req, res) => {
  res.json({ message: await sendNow({ workspaceId: req.workspaceId, id: req.params.id }) });
}));

// ── Link previews (SSRF-guarded) ──────────────────────────────────────────
router.post('/link-preview', ah(async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) throw new HttpError(400, 'url is required');
  res.json(await getPreview(url));
}));

// ── AI helpers (deterministic fallbacks when AI is off) ───────────────────
router.post('/suggestions', ah(async (req, res) => {
  const b = parse(z.object({ conversationId: z.string(), refresh: z.boolean().optional() }), req.body || {});
  res.json(await msgAi.suggestReplies({ workspaceId: req.workspaceId, conversationId: b.conversationId, refresh: b.refresh }));
}));

// Also used by the inbox AI card ("Not right? Give feedback") with kind 'inbox_triage'.
router.post('/suggestions/feedback', ah(async (req, res) => {
  const b = parse(z.object({
    kind: z.enum(['reply_suggestion', 'inbox_triage', 'thread_summary', 'briefing']).optional(),
    conversationId: z.string(),
    text: z.string().max(1000),
    tone: z.string().max(40).optional(),
    isCorrect: z.boolean(),
    messageId: z.string().optional(),
    source: z.string().max(20).optional(),
  }), req.body || {});
  const row = await prisma.aiFeedback.create({
    data: {
      workspaceId: req.workspaceId,
      userId: req.userId,
      kind: b.kind || 'reply_suggestion',
      contextId: b.conversationId,
      isCorrect: b.isCorrect,
      feedback: b.text,
      meta: { tone: b.tone || null, messageId: b.messageId || null, source: b.source || null },
    },
  });
  res.json({ ok: true, id: row.id });
}));

router.post('/summary', ah(async (req, res) => {
  const b = parse(z.object({ conversationId: z.string(), refresh: z.boolean().optional() }), req.body || {});
  const out = await msgAi.summarizeThread({ workspaceId: req.workspaceId, conversationId: b.conversationId, refresh: b.refresh });
  if (!out) throw new HttpError(404, 'Conversation not found');
  res.json(out);
}));

router.post('/draft', ah(async (req, res) => {
  const b = parse(z.object({
    clientId: z.string().optional(),
    conversationId: z.string().optional(),
    context: z.string().max(1000).optional(),
    instruction: z.string().max(1000).optional(),
  }), req.body || {});
  res.json(await msgAi.draftText({ workspaceId: req.workspaceId, ...b }));
}));

// ── Per-message actions ───────────────────────────────────────────────────
async function loadMessage(req) {
  const m = await prisma.message.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId }, include: MESSAGE_INCLUDE });
  if (!m) throw new HttpError(404, 'Message not found');
  return m;
}

router.post('/:id/retry', ah(async (req, res) => {
  res.json(await retryMessage({ workspaceId: req.workspaceId, messageId: req.params.id }));
}));

const TAPBACK = { love: '❤️', like: '👍', dislike: '👎', laugh: '😂', emphasize: '‼️', question: '❓' };

// POST /api/messages/:id/reactions { type, emoji? } — one tapback per sender (iMessage semantics)
router.post('/:id/reactions', ah(async (req, res) => {
  const m = await loadMessage(req);
  const b = parse(z.object({ type: z.enum(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question', 'emoji']), emoji: z.string().max(16).optional() }), req.body || {});
  const mine = m.reactions.filter((r) => r.isFromMe);
  const same = mine.find((r) => r.type === b.type && (b.type !== 'emoji' || r.emoji === b.emoji));
  if (same) {
    // Tapping your current tapback again removes it (iMessage toggle).
    await prisma.reaction.delete({ where: { id: same.id } });
  } else {
    if (mine.length) await prisma.reaction.deleteMany({ where: { id: { in: mine.map((r) => r.id) } } });
    await prisma.reaction.create({
      data: { workspaceId: req.workspaceId, messageId: m.id, type: b.type, emoji: b.emoji || TAPBACK[b.type] || null, isFromMe: true },
    });
  }
  const reactions = await prisma.reaction.findMany({ where: { messageId: m.id }, orderBy: { createdAt: 'asc' } });
  const payload = { messageId: m.id, conversationId: m.conversationId, reactions: reactions.map(serializeReaction) };
  hub.broadcast(req.workspaceId, 'reaction', payload);
  res.json(payload);
}));

router.delete('/:id/reactions', ah(async (req, res) => {
  const m = await loadMessage(req);
  await prisma.reaction.deleteMany({ where: { messageId: m.id, isFromMe: true } });
  const reactions = await prisma.reaction.findMany({ where: { messageId: m.id }, orderBy: { createdAt: 'asc' } });
  const payload = { messageId: m.id, conversationId: m.conversationId, reactions: reactions.map(serializeReaction) };
  hub.broadcast(req.workspaceId, 'reaction', payload);
  res.json(payload);
}));

// DELETE /api/messages/:id — removes it from KeyMatch (a sent text can't be
// unsent from the recipient's phone). Scheduled messages are cancelled.
router.delete('/:id', ah(async (req, res) => {
  const m = await loadMessage(req);
  if (m.status === 'scheduled') {
    return res.json({ message: await cancelScheduled({ workspaceId: req.workspaceId, id: m.id }) });
  }
  await prisma.outboundQueue.deleteMany({ where: { workspaceId: req.workspaceId, messageId: m.id, status: { in: ['pending', 'rate_deferred'] } } });
  await prisma.message.delete({ where: { id: m.id } });
  // Keep the inbox row's preview truthful if we just removed the latest message.
  const conv = await prisma.conversation.findFirst({ where: { id: m.conversationId, workspaceId: req.workspaceId } });
  if (conv && conv.lastMessageAt && Math.abs(new Date(conv.lastMessageAt) - new Date(m.sentAt)) < 1500) {
    const latest = await prisma.message.findFirst({
      where: { conversationId: conv.id, status: { notIn: ['scheduled', 'cancelled'] } },
      orderBy: { sentAt: 'desc' },
      include: { attachments: true },
    });
    const data = latest
      ? { lastMessageAt: latest.sentAt, lastMessagePreview: previewFor(latest), lastMessageFromMe: latest.isFromMe, lastMessageStatus: latest.status }
      : { lastMessagePreview: null, lastMessageFromMe: null, lastMessageStatus: null };
    const up = await prisma.conversation.update({ where: { id: conv.id }, data, include: { client: true } });
    const { serializeConversation } = require('../services/messaging/serialize');
    hub.broadcast(req.workspaceId, 'conversation_updated', { conversation: serializeConversation(up) });
  }
  hub.broadcast(req.workspaceId, 'message_updated', { message: { ...serializeMessage(m), deleted: true }, conversationId: m.conversationId, deleted: true });
  res.json({ ok: true, id: m.id });
}));

module.exports = router;

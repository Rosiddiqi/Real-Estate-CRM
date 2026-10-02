// /api/conversations — inbox list, search, AI card, per-thread state.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { clientName } = require('../lib/clients');
const { serializeConversation, CLIENT_SUMMARY_SELECT } = require('../services/messaging/serialize');
const { resolveConversation, CONV_INCLUDE } = require('../services/messaging/conversations');
const { applyEvidence } = require('../services/messaging/routing');
const msgAi = require('../services/messaging/ai');

const router = express.Router();

const PARTNER_KINDS = ['partner', 'vendor'];

function tabWhere(tab) {
  if (tab === 'automations') return { lane: 'automations' };
  if (tab === 'partners') return { lane: 'active', client: { contactKind: { in: PARTNER_KINDS } } };
  if (tab === 'clients') return { lane: 'active', OR: [{ clientId: null }, { client: { contactKind: { notIn: PARTNER_KINDS } } }] };
  return {};
}

function filterWhere(filter) {
  switch (filter) {
    case 'unread': return { unreadCount: { gt: 0 } };
    case 'pinned': return { pinned: true };
    case 'imessage': return { OR: [{ deliveryMode: 'imessage' }, { deliveryMode: null, channel: 'imessage' }] };
    case 'sms': return { OR: [{ deliveryMode: 'sms' }, { deliveryMode: null, channel: 'sms' }] };
    case 'questions': return { lastMessageFromMe: false, lastMessagePreview: { contains: '?' } };
    case 'muted': return { muted: true };
    default: return {};
  }
}

function andWhere(...parts) {
  const list = parts.filter((p) => p && Object.keys(p).length);
  if (!list.length) return {};
  if (list.length === 1) return list[0];
  return { AND: list };
}

// GET /api/conversations?tab=clients|automations|partners&filter=unread|pinned|imessage|sms|questions&archived=1&blocked=1
router.get('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const tab = String(req.query.tab || 'all');
  const filter = String(req.query.filter || '');
  const archived = req.query.archived === '1' || req.query.archived === 'true';
  const blocked = req.query.blocked === '1' || req.query.blocked === 'true';
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 300));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const base = { workspaceId: wid, archived, blocked };
  const where = andWhere(base, tabWhere(tab), filterWhere(filter));

  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
      skip: (page - 1) * limit,
      include: CONV_INCLUDE,
    }),
    prisma.conversation.count({ where }),
  ]);

  let counts;
  let unread;
  if (!blocked && !archived) {
    const live = { workspaceId: wid, archived: false, blocked: false };
    const tabs = ['clients', 'automations', 'partners'];
    const [c1, c2, c3, u1, u2, u3] = await Promise.all([
      ...tabs.map((t) => prisma.conversation.count({ where: andWhere(live, tabWhere(t)) })),
      ...tabs.map((t) => prisma.conversation.count({ where: andWhere(live, tabWhere(t), { unreadCount: { gt: 0 } }) })),
    ]);
    counts = { clients: c1, automations: c2, partners: c3 };
    unread = { clients: u1, automations: u2, partners: u3 };
  }
  res.json({ conversations: rows.map((c) => serializeConversation(c)), total, counts, unread });
}));

// GET /api/conversations/search?q=
router.get('/search', ah(async (req, res) => {
  const wid = req.workspaceId;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ conversations: [], messages: [], contacts: [] });
  const ci = { contains: q, mode: 'insensitive' };
  const digits = normalizePhone(q).replace(/\D/g, '');
  const words = q.split(/\s+/).filter(Boolean);

  // Token-wise name matching: every typed word must prefix a name part.
  const nameWhere = {
    AND: words.map((w) => ({
      OR: [
        { firstName: { startsWith: w, mode: 'insensitive' } },
        { lastName: { startsWith: w, mode: 'insensitive' } },
        { displayName: { contains: w, mode: 'insensitive' } },
        { company: { startsWith: w, mode: 'insensitive' } },
      ],
    })),
  };
  const clientOr = [nameWhere, { email: ci }];
  if (digits.length >= 3) clientOr.push({ phone: { contains: digits } });

  const [clients, convByName, msgs] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId: wid, archivedAt: null, OR: clientOr },
      take: 12,
      orderBy: [{ isWhale: 'desc' }, { lastContactedAt: { sort: 'desc', nulls: 'last' } }],
      select: { ...CLIENT_SUMMARY_SELECT, conversations: { select: { id: true }, take: 1, orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } } } },
    }),
    prisma.conversation.findMany({
      where: {
        workspaceId: wid, blocked: false,
        OR: [{ displayName: ci }, ...(digits.length >= 3 ? [{ handle: { contains: digits } }] : []), { client: nameWhere }],
      },
      take: 12,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }],
      include: CONV_INCLUDE,
    }),
    q.length >= 2
      ? prisma.message.findMany({
        where: { workspaceId: wid, body: ci, status: { notIn: ['scheduled', 'cancelled'] }, conversation: { blocked: false } },
        take: 30,
        orderBy: { sentAt: 'desc' },
        select: { id: true, conversationId: true, body: true, sentAt: true, isFromMe: true, conversation: { include: CONV_INCLUDE } },
      })
      : [],
  ]);

  const seen = new Set(convByName.map((c) => c.id));
  const conversations = convByName.map((c) => ({ ...serializeConversation(c), matchType: 'name' }));
  const contacts = clients
    .filter((c) => !c.conversations.length || !seen.has(c.conversations[0].id))
    .map((c) => ({
      id: c.id, name: clientName(c), phone: c.phone, email: c.email, avatarUrl: c.avatarUrl, isWhale: !!c.isWhale,
      contactKind: c.contactKind, neighborhood: c.neighborhood, conversationId: c.conversations[0] ? c.conversations[0].id : null,
    }))
    .slice(0, 8);
  const messages = msgs.map((m) => {
    const body = m.body || '';
    const i = body.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, i - 36);
    const snippet = `${start > 0 ? '…' : ''}${body.slice(start, start + 120)}${start + 120 < body.length ? '…' : ''}`;
    return {
      id: m.id, conversationId: m.conversationId, body, snippet, sentAt: m.sentAt, isFromMe: m.isFromMe,
      conversation: serializeConversation(m.conversation),
    };
  });
  res.json({ conversations, messages, contacts });
}));

// GET /api/conversations/ai-card — "who needs a response first"
router.get('/ai-card', ah(async (req, res) => {
  res.json(await msgAi.inboxCard({ workspaceId: req.workspaceId }));
}));

// GET /api/conversations/by-client/:clientId[?create=1] → { conversation | null }
router.get('/by-client/:clientId', ah(async (req, res) => {
  const create = req.query.create === '1' || req.query.create === 'true';
  const { conversation, client } = await resolveConversation({ workspaceId: req.workspaceId, clientId: req.params.clientId, create });
  res.json({ conversation: conversation ? serializeConversation(conversation) : null, client: client ? { id: client.id, name: clientName(client), phone: client.phone, deviceMode: client.deviceMode } : null });
}));

// POST /api/conversations/resolve { conversationId? | clientId? | handle?, create? }
router.post('/resolve', ah(async (req, res) => {
  const body = parse(z.object({
    conversationId: z.string().optional(),
    clientId: z.string().optional(),
    handle: z.string().optional(),
    create: z.boolean().optional(),
  }), req.body || {});
  if (!body.conversationId && !body.clientId && !body.handle) throw new HttpError(400, 'conversationId, clientId or handle is required');
  const { conversation, client } = await resolveConversation({ workspaceId: req.workspaceId, ...body, create: !!body.create });
  res.json({ conversation: conversation ? serializeConversation(conversation) : null, client: client ? { id: client.id, name: clientName(client), phone: client.phone, email: client.email, deviceMode: client.deviceMode, avatarUrl: client.avatarUrl, isWhale: client.isWhale } : null });
}));

async function loadOr404(req) {
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId }, include: CONV_INCLUDE });
  if (!conv) throw new HttpError(404, 'Conversation not found');
  return conv;
}

router.get('/:id', ah(async (req, res) => {
  res.json({ conversation: serializeConversation(await loadOr404(req)) });
}));

// PATCH /api/conversations/:id { pinned, muted, archived, blocked, lane, unread, displayName, channel }
router.patch('/:id', ah(async (req, res) => {
  const conv = await loadOr404(req);
  const body = parse(z.object({
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    archived: z.boolean().optional(),
    blocked: z.boolean().optional(),
    lane: z.enum(['active', 'automations']).optional(),
    unread: z.boolean().optional(),
    displayName: z.string().max(120).optional(),
    channel: z.enum(['imessage', 'sms']).optional(),
  }), req.body || {});
  const data = {};
  for (const k of ['pinned', 'muted', 'archived', 'blocked', 'lane', 'displayName']) if (body[k] !== undefined) data[k] = body[k];
  if (body.unread === true) data.unreadCount = Math.max(1, conv.unreadCount || 0);
  if (body.unread === false || body.blocked === true || body.archived === true) data.unreadCount = 0;
  if (body.archived === true) data.pinned = false;
  const updated = Object.keys(data).length
    ? await prisma.conversation.update({ where: { id: conv.id }, data, include: CONV_INCLUDE })
    : conv;
  if (body.channel) {
    await applyEvidence({ workspaceId: req.workspaceId, clientId: conv.clientId, conversationId: conv.id, event: body.channel === 'sms' ? 'explicit_sms' : 'explicit_imessage' });
  }
  const fresh = body.channel ? await loadOr404(req) : updated;
  const out = serializeConversation(fresh);
  hub.broadcast(req.workspaceId, 'conversation_updated', { conversation: out });
  if ((conv.unreadCount || 0) > 0 && data.unreadCount === 0) hub.broadcast(req.workspaceId, 'conversation_read', { conversationId: conv.id });
  res.json({ conversation: out });
}));

// POST /api/conversations/:id/read
router.post('/:id/read', ah(async (req, res) => {
  const conv = await loadOr404(req);
  if ((conv.unreadCount || 0) > 0) {
    await prisma.conversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
    hub.broadcast(req.workspaceId, 'conversation_read', { conversationId: conv.id });
  }
  res.json({ ok: true, conversationId: conv.id, unreadCount: 0 });
}));

// POST /api/conversations/:id/typing { isTyping } — HTTP fallback for the WS relay
router.post('/:id/typing', ah(async (req, res) => {
  const conv = await loadOr404(req);
  hub.broadcast(req.workspaceId, 'typing', { conversationId: conv.id, isTyping: !!(req.body && req.body.isTyping), from: 'agent', userId: req.userId });
  res.json({ ok: true });
}));

// GET /api/conversations/:id/briefing — relationship card for the thread header
router.get('/:id/briefing', ah(async (req, res) => {
  const conv = await loadOr404(req);
  if (!conv.clientId) return res.json({ briefing: null });
  res.json(await msgAi.briefing({ workspaceId: req.workspaceId, clientId: conv.clientId }));
}));

// DELETE /api/conversations/:id — permanently removes the thread + messages.
// (The inbox swipe "Delete" archives instead; this is the hard delete.)
router.delete('/:id', ah(async (req, res) => {
  const conv = await loadOr404(req);
  await prisma.conversation.delete({ where: { id: conv.id } });
  hub.broadcast(req.workspaceId, 'conversation_updated', { id: conv.id, deleted: true });
  if ((conv.unreadCount || 0) > 0) hub.broadcast(req.workspaceId, 'conversation_read', { conversationId: conv.id });
  res.json({ ok: true, id: conv.id });
}));

module.exports = router;

// Conversation lookup/creation + the bookkeeping every inbound/outbound
// message triggers (conversation row, client touch fields, one Activity per
// client-day, unread counters, broadcasts).
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { formatPhone } = require('../../lib/phone');
const { clientName, findClientByHandle } = require('../../lib/clients');
const { dayKey, dayBounds } = require('../../lib/dates');
const { serializeConversation, CLIENT_SUMMARY_SELECT } = require('./serialize');
const { handleVariants, normalizeHandle, previewFor, firstNameOf } = require('./util');

const CONV_INCLUDE = { client: { select: CLIENT_SUMMARY_SELECT } };

// ── workspace timezone (cached) ───────────────────────────────────────────
const tzCache = new Map();
async function workspaceTz(workspaceId) {
  const hit = tzCache.get(workspaceId);
  if (hit && hit.at > Date.now() - 5 * 60_000) return hit.tz;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } }).catch(() => null);
  const tz = (ws && ws.timezone) || 'America/New_York';
  tzCache.set(workspaceId, { tz, at: Date.now() });
  return tz;
}

async function loadConversation(workspaceId, id) {
  if (!id) return null;
  return prisma.conversation.findFirst({ where: { id, workspaceId }, include: CONV_INCLUDE });
}

async function findConversationForClient(workspaceId, client) {
  const handle = client.phone || client.phoneAlt || client.email;
  const variants = [...new Set([...handleVariants(client.phone), ...handleVariants(client.phoneAlt), ...handleVariants(client.email)])];
  const or = [{ clientId: client.id }];
  if (variants.length) or.push({ handle: { in: variants } });
  const conv = await prisma.conversation.findFirst({
    where: { workspaceId, isGroup: false, OR: or },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: CONV_INCLUDE,
  });
  return { conv, handle };
}

// Find (and optionally create) the 1:1 conversation for a client / handle.
//   → { conversation, client, created }
async function resolveConversation({ workspaceId, conversationId, clientId, handle, service, create = true, lane, displayName }) {
  if (conversationId) {
    const conv = await loadConversation(workspaceId, conversationId);
    if (!conv) throw new HttpError(404, 'Conversation not found');
    let client = null;
    if (conv.clientId) client = await prisma.client.findFirst({ where: { id: conv.clientId, workspaceId } });
    return { conversation: conv, client, created: false };
  }

  let client = null;
  let conv = null;
  let h = handle ? normalizeHandle(handle) : '';

  if (clientId) {
    client = await prisma.client.findFirst({ where: { id: clientId, workspaceId } });
    if (!client) throw new HttpError(404, 'Client not found');
    const found = await findConversationForClient(workspaceId, client);
    conv = found.conv;
    if (!h) h = normalizeHandle(found.handle);
  } else if (h) {
    conv = await prisma.conversation.findFirst({
      where: { workspaceId, isGroup: false, handle: { in: handleVariants(h) } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: CONV_INCLUDE,
    });
    client = conv && conv.clientId
      ? await prisma.client.findFirst({ where: { id: conv.clientId, workspaceId } })
      : await findClientByHandle(workspaceId, h);
  }

  if (conv) {
    // Link a thread that predates the client record.
    if (client && !conv.clientId) {
      conv = await prisma.conversation.update({ where: { id: conv.id }, data: { clientId: client.id, displayName: clientName(client) }, include: CONV_INCLUDE });
    }
    return { conversation: conv, client, created: false };
  }

  if (!create) return { conversation: null, client, created: false };
  if (!h) throw new HttpError(422, client ? 'This client has no phone number or email to text' : 'A phone number is required');
  if (!h.includes('@') && h.replace(/\D/g, '').length < 7) throw new HttpError(422, 'Enter a valid phone number');

  const channel = service || (client && client.deviceMode) || (h.includes('@') ? 'imessage' : 'imessage');
  const data = {
    workspaceId,
    clientId: client ? client.id : null,
    handle: h,
    channel,
    displayName: client ? clientName(client) : (displayName || formatPhone(h) || h),
    lane: lane || 'active',
    deliveryMode: client && client.deviceMode ? client.deviceMode : null,
    deliveryModeReason: client && client.deviceModeReason ? client.deviceModeReason : null,
  };
  try {
    conv = await prisma.conversation.create({ data, include: CONV_INCLUDE });
    return { conversation: conv, client, created: true };
  } catch (err) {
    if (err.code === 'P2002') {
      conv = await prisma.conversation.findFirst({ where: { workspaceId, handle: h }, include: CONV_INCLUDE });
      if (conv) return { conversation: conv, client, created: false };
    }
    throw err;
  }
}

// ── per-message bookkeeping ───────────────────────────────────────────────
// direction: 'in' | 'out'. Returns the updated conversation (with client).
async function afterMessage({ workspaceId, conversation, client, message, direction, source = 'agent', silent = false }) {
  const now = new Date();
  const sentAt = new Date(message.sentAt || now);
  const preview = previewFor(message);
  const isCampaign = source === 'campaign';
  const conv = conversation;

  const data = {};
  const newer = !conv.lastMessageAt || sentAt >= new Date(conv.lastMessageAt);
  // A campaign send into a live client thread must not shuffle the inbox
  // (RevMatch rule); automation-lane threads do track their latest send.
  const touchesPreview = newer && !(direction === 'out' && isCampaign && conv.lane !== 'automations');
  if (touchesPreview) {
    data.lastMessageAt = sentAt;
    data.lastMessagePreview = preview || conv.lastMessagePreview;
    data.lastMessageFromMe = direction === 'out';
    data.lastMessageStatus = message.status;
  }
  if (direction === 'in') {
    if (!conv.blocked && !silent) data.unreadCount = { increment: 1 };
    if (conv.lane === 'automations') data.lane = 'active'; // the client replied — the thread is the agent's now
    if (conv.archived) data.archived = false;
    if (message.service && message.service !== conv.channel && message.service !== 'email') data.channel = message.service;
  } else if (source === 'agent' || source === 'serena') {
    if ((conv.unreadCount || 0) > 0) data.unreadCount = 0;
    if (conv.archived) data.archived = false;
  }

  let updated = conv;
  if (Object.keys(data).length) {
    try {
      updated = await prisma.conversation.update({ where: { id: conv.id }, data, include: CONV_INCLUDE });
    } catch (err) {
      if (err.code === 'P2002' && data.channel) {
        delete data.channel; // another row already owns (channel, handle)
        updated = await prisma.conversation.update({ where: { id: conv.id }, data, include: CONV_INCLUDE });
      } else throw err;
    }
  }

  if (client) {
    const cdata = direction === 'in'
      ? { lastInboundAt: sentAt, lastContactedAt: sentAt }
      : { lastOutboundAt: sentAt, lastContactedAt: sentAt };
    try { await prisma.client.update({ where: { id: client.id }, data: cdata }); } catch (_) { /* client deleted mid-flight */ }
    if (!silent) await logDayActivity({ workspaceId, client, conversation: updated, message, direction, preview, source });
  }

  if (!silent) {
    hub.broadcast(workspaceId, 'conversation_updated', { conversation: serializeConversation(updated) });
    if (direction === 'out' && (conv.unreadCount || 0) > 0 && data.unreadCount === 0) {
      hub.broadcast(workspaceId, 'conversation_read', { conversationId: conv.id });
    }
  }
  return updated;
}

// One Activity row per client per day per direction — updated in place as the
// day's texting continues (never one row per message).
async function logDayActivity({ workspaceId, client, conversation, message, direction, preview, source }) {
  try {
    const tz = await workspaceTz(workspaceId);
    const now = new Date(message.sentAt || Date.now());
    const { start, end } = dayBounds(dayKey(now, tz), tz);
    const type = direction === 'in' ? 'message_in' : 'message_out';
    const first = firstNameOf(client) || clientName(client);
    const existing = await prisma.activity.findFirst({
      where: { workspaceId, clientId: client.id, type, occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' },
    });
    const count = existing ? ((existing.meta && existing.meta.count) || 1) + 1 : 1;
    const title = direction === 'in'
      ? (count > 1 ? `${first} texted · ${count} messages` : `${first} texted`)
      : (count > 1 ? `Texted ${first} · ${count} messages` : `Texted ${first}`);
    const meta = {
      conversationId: conversation.id,
      lastMessageId: message.id,
      count,
      service: message.service,
      ...(source && source !== 'agent' ? { source } : {}),
    };
    const actor = direction === 'in' ? 'client' : (source === 'campaign' ? 'system' : source === 'serena' ? 'ai' : 'agent');
    let row;
    if (existing) {
      row = await prisma.activity.update({ where: { id: existing.id }, data: { title, body: preview || existing.body, meta, occurredAt: now } });
    } else {
      row = await prisma.activity.create({
        data: { workspaceId, clientId: client.id, type, title, body: preview || null, meta, actor, occurredAt: now },
      });
    }
    hub.broadcast(workspaceId, 'activity_created', row);
  } catch (err) {
    console.error('[messaging] day activity failed:', err.message);
  }
}

module.exports = { CONV_INCLUDE, workspaceTz, loadConversation, resolveConversation, afterMessage, logDayActivity, findConversationForClient };

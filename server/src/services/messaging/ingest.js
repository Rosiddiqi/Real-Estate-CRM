// ingestInbound — ONE pipeline for every inbound text (demo replies, Twilio
// webhook, future transports). Dedupes by provider id, files the message in
// the right conversation, updates unread/bookkeeping, broadcasts, notifies and
// runs the real-estate intent capture (SERENA SUGGESTS tasks).
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { notify } = require('../../lib/notify');
const { resolveConversation, afterMessage, loadConversation } = require('./conversations');
const { serializeMessage, serializeConversation, MESSAGE_INCLUDE } = require('./serialize');
const { applyEvidence } = require('./routing');
const { isShortCode, normService, previewFor, kindOfMime } = require('./util');
const events = require('./events');

// Pure dedupe decision (unit-tested): given the incoming provider id and the
// row already stored under it (if any), what should happen?
//   'insert'  — new message
//   'skip'    — exact replay, nothing to do
//   'upgrade' — replay that carries data the stored row is missing
function dedupeDecision(incoming, existing) {
  if (!existing) return 'insert';
  const inBody = String(incoming.body || '').trim();
  const exBody = String(existing.body || '').trim();
  const inAtt = (incoming.attachments || []).length;
  const exAtt = (existing.attachments || []).length;
  if ((!exBody && inBody) || inAtt > exAtt) return 'upgrade';
  return 'skip';
}

async function wantsMessageNotifications(workspaceId) {
  try {
    const users = await prisma.user.findMany({ where: { workspaceId }, select: { preferences: true } });
    if (!users.length) return true;
    return users.some((u) => {
      const n = u.preferences && u.preferences.notifications;
      return !n || n.message !== false;
    });
  } catch { return true; }
}

async function ingestInbound({
  workspaceId, conversationId, handle, body, attachments = [], service, externalId = null,
  sentAt, senderHandle, senderName, provider = 'demo', meta = null, silent = false,
}) {
  if (!conversationId && isShortCode(handle)) return { ignored: 'shortcode' };
  const text = typeof body === 'string' ? body.replace(/^\s+|\s+$/g, '') : '';
  const atts = (attachments || []).filter((a) => a && a.url).map((a) => ({
    url: a.url,
    mimeType: a.mimeType || null,
    fileName: a.fileName || null,
    size: Number.isFinite(+a.size) ? Math.round(+a.size) : null,
    kind: a.kind || kindOfMime(a.mimeType, a.fileName),
  }));
  if (!text && !atts.length) return { ignored: 'empty' };

  if (externalId) {
    const existing = await prisma.message.findFirst({ where: { workspaceId, externalId }, include: MESSAGE_INCLUDE });
    const decision = dedupeDecision({ body: text, attachments: atts }, existing);
    if (decision === 'skip') return { duplicate: true, message: serializeMessage(existing) };
    if (decision === 'upgrade') {
      const have = new Set(existing.attachments.map((a) => a.url));
      const up = await prisma.message.update({
        where: { id: existing.id },
        data: {
          body: existing.body || text || null,
          attachments: { create: atts.filter((a) => !have.has(a.url)).map((a) => ({ ...a, workspaceId })) },
        },
        include: MESSAGE_INCLUDE,
      });
      const message = serializeMessage(up);
      hub.broadcast(workspaceId, 'message_updated', { message, conversationId: up.conversationId });
      return { duplicate: true, upgraded: true, message };
    }
  }

  const svc = normService(service, 'imessage');
  const { conversation, client } = conversationId
    ? { conversation: await loadConversation(workspaceId, conversationId), client: null }
    : await resolveConversation({ workspaceId, handle, service: svc, create: true });
  if (!conversation) return { ignored: 'no_conversation' };
  const linkedClient = client || (conversation.clientId ? await prisma.client.findFirst({ where: { id: conversation.clientId, workspaceId } }) : null);

  const row = await prisma.message.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      clientId: conversation.clientId,
      isFromMe: false,
      body: text || null,
      kind: text ? 'text' : 'attachment',
      service: svc,
      status: 'received',
      sentAt: sentAt ? new Date(sentAt) : new Date(),
      externalId,
      senderHandle: senderHandle || conversation.handle,
      senderName: senderName || null,
      meta: meta || (provider ? { provider } : undefined),
      attachments: atts.length ? { create: atts.map((a) => ({ ...a, workspaceId })) } : undefined,
    },
    include: MESSAGE_INCLUDE,
  });

  const updated = await afterMessage({ workspaceId, conversation, client: linkedClient, message: row, direction: 'in', silent });
  const message = serializeMessage(row);
  const convOut = serializeConversation(updated);

  // Inbound service is ground truth for which phone they carry.
  if (!conversation.isGroup && svc !== 'email') {
    applyEvidence({ workspaceId, clientId: conversation.clientId, conversationId: conversation.id, event: svc === 'imessage' ? 'inbound_imessage' : 'inbound_sms' });
  }

  if (!silent && !conversation.blocked) {
    hub.broadcast(workspaceId, 'message_received', { message, conversationId: conversation.id, conversation: convOut });
    if (!conversation.muted && (await wantsMessageNotifications(workspaceId))) {
      notify({
        workspaceId,
        type: 'message',
        title: convOut.name,
        body: previewFor(row) || 'New message',
        data: { conversationId: conversation.id, clientId: conversation.clientId, messageId: row.id },
      });
    }
  }

  if (!silent && linkedClient && text) {
    // Fire-and-forget: never on the hot path.
    setImmediate(() => {
      require('./intent').captureIntent({ workspaceId, client: linkedClient, conversation: updated, message: row })
        .catch((err) => console.error('[messaging] intent capture failed:', err.message));
    });
  }

  events.emit('inbound', { workspaceId, message, conversation: convOut, client: linkedClient });
  return { message, conversation: convOut };
}

module.exports = { ingestInbound, dedupeDecision };

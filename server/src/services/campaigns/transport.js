// Transport adapter — the ONE place campaign/automation texts leave the
// building. Routes through the inbox builder's messaging stack
// (services/messaging/send.js → sendMessage) when it exists; until then (or if
// it fails to load) it writes the outbound Message itself as a demo send with
// the same conversation bookkeeping. Swapping transports is one line.
//
// Callers must have passed the Sender Guard (checkSend + checkContent) first —
// deliver() never decides whether a text may go, only how it goes.
//
// Thread routing (fishing-boat rule): a thread the campaign itself opens lands
// in the inbox's Automations lane (Conversation.lane = 'automations') and stays
// there until the client replies; existing threads are never bumped by a
// campaign echo.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { normalizePhone } = require('../../lib/phone');
const { clientName } = require('../../lib/clients');

function loadSendModule() {
  try {
    // eslint-disable-next-line global-require
    const mod = require('../messaging/send');
    if (mod && typeof mod.sendMessage === 'function') return mod;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') console.error('[campaigns/transport] messaging/send.js failed to load, using demo fallback:', err.message);
  }
  return null;
}

function serviceFor(client, conv) {
  if (conv && conv.channel === 'sms') return 'sms';
  if (client && client.deviceMode === 'sms') return 'sms';
  return 'imessage';
}

async function findThread(workspaceId, client) {
  const phone = normalizePhone(client.phone || '');
  return prisma.conversation.findFirst({
    where: { workspaceId, isGroup: false, OR: [{ clientId: client.id }, ...(phone ? [{ handle: phone }] : [])] },
    orderBy: [{ lastMessageAt: 'desc' }],
  });
}

// Demo fallback: write the outbound message + bookkeeping ourselves.
async function fallbackSend({ workspaceId, client, body, attachments = [], campaignId, recipientId, aiGenerated }) {
  const handle = normalizePhone(client.phone || '');
  if (!handle) throw new Error('No phone number on file');
  let conv = await findThread(workspaceId, client);
  let created = false;
  if (!conv) {
    const channel = client.deviceMode === 'sms' ? 'sms' : 'imessage';
    try {
      conv = await prisma.conversation.create({
        data: { workspaceId, clientId: client.id, handle, channel, displayName: clientName(client), lane: 'automations' },
      });
      created = true;
    } catch (err) {
      conv = await findThread(workspaceId, client); // lost a create race
      if (!conv) throw err;
    }
  }
  const now = new Date();
  const service = serviceFor(client, conv);
  const message = await prisma.message.create({
    data: {
      workspaceId, conversationId: conv.id, clientId: client.id,
      isFromMe: true, body, kind: 'text', service,
      // Demo provider: delivery is simulated instantly.
      status: 'delivered', sentAt: now, deliveredAt: now,
      campaignId: campaignId || null, campaignRecipientId: recipientId || null,
      aiGenerated: !!aiGenerated,
      attachments: attachments.length ? {
        create: attachments.map((a) => ({
          workspaceId, url: a.url, mimeType: a.mimeType || null, fileName: a.fileName || null,
          kind: /^image\//.test(a.mimeType || '') ? 'image' : /^video\//.test(a.mimeType || '') ? 'video' : 'file',
        })),
      } : undefined,
    },
    include: { attachments: true },
  });
  // Bookkeeping: a campaign-born (automations-lane) thread shows its latest
  // text; an existing inbox thread is never bumped by a campaign echo.
  const preview = body ? body.slice(0, 100) : (attachments.length ? 'Attachment' : '');
  if (created || conv.lane === 'automations') {
    conv = await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: now, lastMessagePreview: preview, lastMessageFromMe: true, lastMessageStatus: 'delivered', ...(conv.clientId ? {} : { clientId: client.id }) },
    });
  }
  await prisma.client.update({ where: { id: client.id }, data: { lastOutboundAt: now } }).catch(() => {});
  hub.broadcast(workspaceId, 'message_sent', { message, conversation: conv, conversationId: conv.id, campaignSend: true });
  hub.broadcast(workspaceId, 'conversation_updated', conv);
  return { message, conversation: conv, created, via: 'fallback' };
}

// deliver({ workspaceId, client, body, attachments, campaignId, recipientId, aiGenerated })
//   -> { message, conversation, created, via }
// Throws on a hard failure; returns a message with status 'failed' when the
// provider refused it (caller records the failure with the guard).
async function deliver({ workspaceId, client, body, attachments = [], campaignId = null, recipientId = null, aiGenerated = true }) {
  const mod = loadSendModule();
  if (!mod) return fallbackSend({ workspaceId, client, body, attachments, campaignId, recipientId, aiGenerated });

  const before = await findThread(workspaceId, client);
  // The messaging stack routes campaign-born threads into the Automations lane
  // itself, persists campaignId/campaignRecipientId, and never bumps a live
  // inbox thread with a campaign echo.
  const out = await mod.sendMessage({
    workspaceId,
    clientId: client.id,
    ...(before ? { conversationId: before.id } : {}),
    body,
    attachments,
    source: 'campaign',
    campaignId,
    campaignRecipientId: recipientId,
    aiGenerated,
  });
  const message = out && (out.message || out);
  const conversation = out && out.conversation;
  const created = !before;
  return { message, conversation, created, via: 'messaging' };
}

module.exports = { deliver, serviceFor, findThread };

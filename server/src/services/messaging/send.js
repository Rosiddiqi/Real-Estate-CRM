// sendMessage — THE outbound entry point for every feature (inbox composer,
// client card, campaigns, Serena, matchmaker, scheduled sends).
//
//   const { sendMessage } = require('../services/messaging/send');
//   const { message, conversation } = await sendMessage({
//     workspaceId, clientId?, conversationId?, handle?,      // one of these identifies the thread
//     body, attachments?: [{url, mimeType, fileName, size?}],
//     service?: 'imessage'|'sms',                              // default: device routing
//     source: 'agent'|'campaign'|'serena',
//     campaignId?, campaignRecipientId?, aiGenerated?, clientTempId?,
//     listingId?,          // sends a listing card (+ share link in the body)
//     scheduledFor?,       // Date/ISO in the future → stored as a scheduled message
//     replyToId?, meta?,
//   });
//
// Finds or creates the conversation for the client's phone, writes the
// Message (+ attachments), enqueues it on the workspace's transport
// (fire-once — a failure stays failed until the agent taps Retry), updates
// conversation / client / day-activity bookkeeping and broadcasts
// `message_sent` + `conversation_updated`. Throws HttpError for refusals
// (empty, opted out, kill switch, rate limit, no phone).
//
// Transport is per workspace (mode.js): 'demo' simulates, 'twilio' sends,
// 'device' records the text as sent from the agent's phone and returns
//   { message, conversation, smsUrl, handoff: 'device', notice? }
// — the caller opens `smsUrl` (Messages with the text prefilled). In device
// mode campaigns and Send Later refuse with 409 { details: { code: 'device_mode' } }.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { toE164 } = require('../../lib/phone');
const { resolveConversation, afterMessage } = require('./conversations');
const { serializeMessage, serializeConversation, MESSAGE_INCLUDE } = require('./serialize');
const { demo: demoProvider, twilio: twilioProvider } = require('./providers');
const { messagingModeFor, assertCanAutoSend, DEVICE_MODE_CODE } = require('./mode');
const { resolveSendService, applyEvidence } = require('./routing');
const { applyStatus } = require('./status');
const { buildListingMessage } = require('./listingCard');
const { kindOfMime, normService } = require('./util');
const safety = require('./safety');
const events = require('./events');

const MAX_SCHEDULE_DAYS = 60;
const DEVICE_CHANNELS = ['imessage', 'sms'];

const providerForMode = (mode) => (mode === 'twilio' ? twilioProvider : demoProvider);

// iOS Messages hand-off: sms:+13055550142&body=… (group: sms:/open?addresses=a,b&body=…)
function smsHandoffUrl(conversation, body) {
  const enc = encodeURIComponent(String(body || ''));
  const addr = (h) => (String(h || '').includes('@') ? String(h).trim() : toE164(h));
  if (conversation.isGroup) {
    const parts = (Array.isArray(conversation.participants) ? conversation.participants : [])
      .map((p) => addr(p && p.handle)).filter(Boolean);
    if (parts.length) return `sms:/open?addresses=${parts.join(',')}&body=${enc}`;
  }
  const to = addr(conversation.handle);
  return to ? `sms:${to}&body=${enc}` : `sms:&body=${enc}`;
}

function deviceModeError(message) {
  const err = new HttpError(409, message, { code: DEVICE_MODE_CODE });
  err.code = DEVICE_MODE_CODE;
  return err;
}

function cleanAttachments(list) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && (a.url || a.path))
    .slice(0, 20)
    .map((a) => {
      const mimeType = a.mimeType || a.mimetype || a.type || null;
      const fileName = a.fileName || a.name || a.originalName || null;
      return {
        url: String(a.url || a.path),
        mimeType,
        fileName,
        size: Number.isFinite(+a.size) ? Math.round(+a.size) : null,
        width: Number.isFinite(+a.width) ? Math.round(+a.width) : null,
        height: Number.isFinite(+a.height) ? Math.round(+a.height) : null,
        durationMs: Number.isFinite(+a.durationMs) ? Math.round(+a.durationMs) : null,
        kind: a.kind || kindOfMime(mimeType, fileName),
      };
    });
}

async function sendMessage(opts = {}) {
  const {
    workspaceId, clientId, conversationId, handle,
    source = 'agent', campaignId = null, campaignRecipientId = null, aiGenerated = false,
    clientTempId = null, listingId = null, replyToId = null, userId = null,
  } = opts;
  if (!workspaceId) throw new HttpError(400, 'workspaceId is required');

  let body = typeof opts.body === 'string' ? opts.body.replace(/\s+$/, '').replace(/^\s*\n/, '') : '';
  let kind = opts.kind && ['text', 'attachment', 'listing', 'system', 'note'].includes(opts.kind) ? opts.kind : 'text';
  let meta = opts.meta && typeof opts.meta === 'object' ? { ...opts.meta } : null;
  const attachments = cleanAttachments(opts.attachments);

  if (listingId) {
    const card = await buildListingMessage({ workspaceId, listingId, note: body });
    if (!card) throw new HttpError(404, 'Listing not found');
    kind = 'listing';
    body = card.body;
    meta = { ...(meta || {}), ...card.meta };
  }
  if (kind === 'text' && !body.trim() && attachments.length) kind = 'attachment';
  if (!body.trim() && !attachments.length) throw new HttpError(400, 'Message is empty');
  if (body.length > 4000) throw new HttpError(400, 'Message is too long (4,000 characters max)');

  const { conversation, client } = await resolveConversation({
    workspaceId, conversationId, clientId, handle,
    lane: source === 'campaign' ? 'automations' : 'active',
  });
  if (conversation.isGroup && source === 'campaign') throw new HttpError(400, 'Campaigns can’t text group threads');

  const mode = await messagingModeFor(workspaceId);
  if (source === 'campaign') await assertCanAutoSend(workspaceId, 'campaigns');
  const provider = mode === 'device' ? null : providerForMode(mode);
  const requested = opts.service ? normService(opts.service) : null;
  const service = resolveSendService({
    requested,
    explicit: !!opts.explicitService,
    deviceMode: (conversation.deliveryMode || (client && client.deviceMode)) || null,
    channel: conversation.channel,
    isGroup: conversation.isGroup,
    capabilities: provider ? provider.capabilities.channels : DEVICE_CHANNELS,
  });

  // ── Scheduled ("Send Later") ───────────────────────────────────────────
  const when = opts.scheduledFor ? new Date(opts.scheduledFor) : null;
  if (when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 30_000) {
    if (mode === 'device') throw deviceModeError('Send Later needs a business texting line — connect one in Settings, or send it now from your phone.');
    if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 864e5) throw new HttpError(400, `Schedule within ${MAX_SCHEDULE_DAYS} days`);
    const row = await prisma.message.create({
      data: {
        workspaceId, conversationId: conversation.id, clientId: conversation.clientId,
        isFromMe: true, body: body || null, kind, service, status: 'scheduled',
        sentAt: when, scheduledFor: when, clientTempId, replyToId, campaignId, campaignRecipientId,
        aiGenerated: !!aiGenerated, meta: { ...(meta || {}), source, scheduledBy: userId || undefined },
        attachments: attachments.length ? { create: attachments.map((a) => ({ ...a, workspaceId })) } : undefined,
      },
      include: MESSAGE_INCLUDE,
    });
    const message = serializeMessage(row);
    hub.broadcast(workspaceId, 'message_updated', { message, conversationId: conversation.id, scheduled: true });
    return { message, conversation: serializeConversation(conversation) };
  }

  const { delayMs } = safety.check({ workspaceId, handle: conversation.handle, source, client });

  // ── Device hand-off (no business line): record it, return the sms: URL ──
  if (mode === 'device') {
    if (!body.trim()) throw new HttpError(400, 'Photos and files can’t be handed to Messages — add a note, or send them from your phone.');
    const row = await prisma.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        clientId: conversation.clientId,
        isFromMe: true,
        body,
        kind: kind === 'attachment' ? 'text' : kind,
        service,
        status: 'sent',
        sentAt: new Date(),
        clientTempId,
        replyToId,
        aiGenerated: !!aiGenerated,
        meta: { ...(meta || {}), via: 'device', ...(source !== 'agent' ? { source } : {}), ...(attachments.length ? { droppedAttachments: attachments.length } : {}) },
      },
      include: MESSAGE_INCLUDE,
    });
    const updatedConv = await afterMessage({ workspaceId, conversation, client, message: row, direction: 'out', source });
    const message = serializeMessage(row);
    const convOut = serializeConversation(updatedConv);
    hub.broadcast(workspaceId, 'message_sent', { message, conversationId: conversation.id, clientTempId, conversation: convOut });
    events.emit('outbound', { workspaceId, message, conversation: convOut, client, source, campaignId, campaignRecipientId });
    return {
      message,
      conversation: convOut,
      smsUrl: smsHandoffUrl(conversation, body),
      handoff: 'device',
      ...(attachments.length ? { notice: 'Photos and files aren’t included — attach them in Messages.' } : {}),
    };
  }

  const row = await prisma.message.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      clientId: conversation.clientId,
      isFromMe: true,
      body: body || null,
      kind,
      service,
      status: 'sending',
      sentAt: new Date(),
      clientTempId,
      replyToId,
      campaignId,
      campaignRecipientId,
      aiGenerated: !!aiGenerated,
      meta: meta || (source !== 'agent' ? { source } : undefined),
      attachments: attachments.length ? { create: attachments.map((a) => ({ ...a, workspaceId })) } : undefined,
    },
    include: MESSAGE_INCLUDE,
  });

  const queue = await prisma.outboundQueue.create({
    data: {
      workspaceId,
      messageId: row.id,
      conversationId: conversation.id,
      toHandle: conversation.handle,
      body: body || null,
      attachments: attachments.length ? attachments : undefined,
      service,
      provider: provider.id,
      status: 'pending',
      notBefore: delayMs ? new Date(Date.now() + delayMs) : null,
    },
  });

  const updatedConv = await afterMessage({ workspaceId, conversation, client, message: row, direction: 'out', source });
  const message = serializeMessage(row);
  const convOut = serializeConversation(updatedConv);
  hub.broadcast(workspaceId, 'message_sent', { message, conversationId: conversation.id, clientTempId, conversation: convOut });

  if (opts.explicitService && requested) {
    applyEvidence({ workspaceId, clientId: conversation.clientId, conversationId: conversation.id, event: requested === 'sms' ? 'explicit_sms' : 'explicit_imessage' });
  }

  safety.record(workspaceId, conversation.handle);
  const run = () => dispatch({ workspaceId, row, queue, conversation: updatedConv, client, provider, source });
  const effectiveDelay = provider.id === 'demo' ? 0 : delayMs;
  if (effectiveDelay) { const t = setTimeout(run, effectiveDelay); if (t.unref) t.unref(); } else setImmediate(run);

  events.emit('outbound', { workspaceId, message, conversation: convOut, client, source, campaignId, campaignRecipientId });
  return { message, conversation: convOut };
}

// Hand one queued message to the provider. Fire-once: never auto-retried.
async function dispatch({ workspaceId, row, queue, conversation, client, provider, source }) {
  try {
    await prisma.outboundQueue.update({ where: { id: queue.id }, data: { status: 'sending', attempts: { increment: 1 } } });
    const res = await provider.send({
      workspaceId,
      queueId: queue.id,
      message: { ...row, attachments: row.attachments || [] },
      conversation,
      client,
      source,
      to: toE164(conversation.handle),
    });
    if (!res || !res.accepted) {
      await applyStatus({ workspaceId, messageId: row.id, status: 'failed', error: (res && res.error) || 'Not delivered' });
      return;
    }
    if (res.externalId) {
      try { await prisma.message.update({ where: { id: row.id }, data: { externalId: res.externalId } }); } catch (_) { /* duplicate provider id */ }
    }
    if (res.status && res.status !== 'sending') await applyStatus({ workspaceId, messageId: row.id, status: res.status });
  } catch (err) {
    console.error('[messaging] dispatch failed:', err.message);
    await applyStatus({ workspaceId, messageId: row.id, status: 'failed', error: err.message || 'Send failed' }).catch(() => {});
  }
}

// Retry a failed outbound (a deliberate user action — the only way a failed
// text is ever re-sent). Re-uses the same bubble, new queue row.
async function retryMessage({ workspaceId, messageId }) {
  const row = await prisma.message.findFirst({ where: { id: messageId, workspaceId }, include: MESSAGE_INCLUDE });
  if (!row) throw new HttpError(404, 'Message not found');
  if (!row.isFromMe || row.status !== 'failed') throw new HttpError(409, 'Only a failed message can be retried');
  const conversation = await prisma.conversation.findFirst({ where: { id: row.conversationId, workspaceId } });
  if (!conversation) throw new HttpError(404, 'Conversation not found');
  const client = conversation.clientId ? await prisma.client.findFirst({ where: { id: conversation.clientId, workspaceId } }) : null;
  safety.check({ workspaceId, handle: conversation.handle, source: 'agent', client });
  const mode = await messagingModeFor(workspaceId);
  if (mode === 'device') {
    // No business line: retrying hands the text to the agent's phone.
    if (!(row.body || '').trim()) throw new HttpError(400, 'Photos and files can’t be handed to Messages — send them from your phone.');
    const fresh = await prisma.message.update({
      where: { id: row.id },
      data: { status: 'sent', error: null, sentAt: new Date(), meta: { ...(row.meta || {}), via: 'device' } },
      include: MESSAGE_INCLUDE,
    });
    const message = serializeMessage(fresh);
    hub.broadcast(workspaceId, 'message_updated', { message, conversationId: conversation.id });
    return { message, smsUrl: smsHandoffUrl(conversation, row.body), handoff: 'device' };
  }
  const provider = providerForMode(mode);
  const fresh = await prisma.message.update({
    where: { id: row.id },
    data: { status: 'sending', error: null, sentAt: new Date() },
    include: MESSAGE_INCLUDE,
  });
  const queue = await prisma.outboundQueue.create({
    data: {
      workspaceId, messageId: row.id, conversationId: conversation.id, toHandle: conversation.handle,
      body: row.body, attachments: row.attachments.length ? row.attachments.map((a) => ({ url: a.url, mimeType: a.mimeType, fileName: a.fileName })) : undefined,
      service: row.service, provider: provider.id, status: 'pending',
    },
  });
  const message = serializeMessage(fresh);
  hub.broadcast(workspaceId, 'message_updated', { message, conversationId: conversation.id });
  safety.record(workspaceId, conversation.handle);
  setImmediate(() => dispatch({ workspaceId, row: fresh, queue, conversation, client, provider, source: 'agent' }));
  return { message };
}

// Dispatch a scheduled message whose time has come (called by the job and by
// "Send now"). The claim is atomic so two servers can't both send it.
async function dispatchScheduled({ workspaceId, messageId }) {
  const claim = await prisma.message.updateMany({
    where: { id: messageId, workspaceId, status: 'scheduled' },
    data: { status: 'sending', sentAt: new Date() },
  });
  if (!claim.count) return null;
  const row = await prisma.message.findFirst({ where: { id: messageId, workspaceId }, include: MESSAGE_INCLUDE });
  const conversation = await prisma.conversation.findFirst({ where: { id: row.conversationId, workspaceId } });
  if (!conversation) return null;
  const client = conversation.clientId ? await prisma.client.findFirst({ where: { id: conversation.clientId, workspaceId } }) : null;
  const source = (row.meta && row.meta.source) || 'agent';
  try {
    safety.check({ workspaceId, handle: conversation.handle, source, client });
  } catch (err) {
    await applyStatus({ workspaceId, messageId: row.id, status: 'failed', error: err.message });
    return null;
  }
  const mode = await messagingModeFor(workspaceId);
  if (mode === 'device') {
    // The business line went away after this was scheduled — it can't go out
    // on its own. Fail it so the bubble offers "Tap to retry" (→ the phone).
    await applyStatus({ workspaceId, messageId: row.id, status: 'failed', error: 'Send Later needs a business texting line — tap to send it from your phone' });
    return null;
  }
  const provider = providerForMode(mode);
  const queue = await prisma.outboundQueue.create({
    data: {
      workspaceId, messageId: row.id, conversationId: conversation.id, toHandle: conversation.handle, body: row.body,
      attachments: row.attachments.length ? row.attachments.map((a) => ({ url: a.url, mimeType: a.mimeType, fileName: a.fileName })) : undefined,
      service: row.service, provider: provider.id, status: 'pending',
    },
  });
  const updatedConv = await afterMessage({ workspaceId, conversation: { ...conversation }, client, message: row, direction: 'out', source });
  const message = serializeMessage(row);
  hub.broadcast(workspaceId, 'message_sent', { message, conversationId: conversation.id, clientTempId: row.clientTempId, conversation: serializeConversation(updatedConv), fromSchedule: true });
  safety.record(workspaceId, conversation.handle);
  await dispatch({ workspaceId, row, queue, conversation: updatedConv, client, provider, source });
  events.emit('outbound', { workspaceId, message, conversation: serializeConversation(updatedConv), client, source, campaignId: row.campaignId, campaignRecipientId: row.campaignRecipientId });
  return message;
}

module.exports = { sendMessage, retryMessage, dispatchScheduled, dispatch, cleanAttachments, smsHandoffUrl };

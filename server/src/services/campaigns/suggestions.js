// The approval queue — AI drafts that wait for the agent's tap. Two kinds,
// both stored as AiInsight { type: 'campaign_reply_suggestion', status: new }:
//   reply             the reply agent's answer to an on-topic campaign question
//   automation_draft  a draft-mode automation's trigger text (e.g. a 90+ match)
// Approving queues an `approved_send` on the recipient row; the engine sends it
// through the full Sender Guard (it may wait for a safe slot — the agent is
// told when). The AI never sends a conversational reply on its own.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { clientName } = require('../../lib/clients');
const Q = require('./queue');
const guard = require('./senderGuard');
const { draftReply } = require('./replyAgent');
const { sanitizeOutbound } = require('./drafter');

const TYPE = 'campaign_reply_suggestion';

function emit(workspaceId, payload) {
  try { hub.broadcast(workspaceId, 'campaign_updated', { ...payload, at: new Date().toISOString() }); } catch { /* noop */ }
}

async function supersede(workspaceId, recipientId) {
  await prisma.aiInsight.updateMany({
    where: { workspaceId, type: TYPE, status: 'new', data: { path: ['recipientId'], equals: recipientId } },
    data: { status: 'dismissed' },
  }).catch(() => {});
}

async function draftReplySuggestion({ workspaceId, row, campaign, question, threadTail, conversationId, messageId, tz }) {
  const client = await prisma.client.findFirst({ where: { id: row.clientId, workspaceId } });
  if (!client) return null;
  const listingId = Array.isArray(campaign.steps) && campaign.steps[0] && campaign.steps[0].listingId;
  const listing = listingId ? await prisma.listing.findFirst({ where: { id: listingId, workspaceId } }).catch(() => null) : null;
  const result = await draftReply({ workspaceId, campaign, client, listing, question, threadTail, tz });
  if (!result) return null;
  await supersede(workspaceId, row.id);
  const name = clientName(client);
  const insight = await prisma.aiInsight.create({
    data: {
      workspaceId, clientId: client.id, conversationId: conversationId || null, type: TYPE,
      title: result.abstain ? `${name} needs you` : `Reply ready for ${name}`,
      body: result.abstain ? null : result.text,
      data: {
        kind: 'reply', campaignId: campaign.id, campaignName: campaign.name, recipientId: row.id, clientName: name,
        inboundText: String(question || '').slice(0, 500), messageId, abstain: !!result.abstain,
        abstainReason: result.abstain ? result.reason : null, via: result.via || null,
      },
      status: 'new',
    },
  });
  try {
    const { notify } = require('../../lib/notify');
    await notify({ workspaceId, type: 'ai', title: insight.title, body: result.abstain ? `${result.reason} · "${String(question).slice(0, 80)}"` : result.text, data: { campaignId: campaign.id, clientId: client.id, conversationId, insightId: insight.id, screen: 'campaign' } });
  } catch { /* best effort */ }
  emit(workspaceId, { campaignId: campaign.id, kind: 'suggestion', recipientId: row.id, insightId: insight.id });
  return insight;
}

async function createDraftForApproval({ workspaceId, campaign, recipientId, client, text, via, item, listing }) {
  await supersede(workspaceId, recipientId);
  const name = clientName(client);
  const insight = await prisma.aiInsight.create({
    data: {
      workspaceId, clientId: client.id, listingId: listing ? listing.id : null, type: TYPE,
      title: `${campaign.name}: draft for ${name}`,
      body: text,
      data: {
        kind: 'automation_draft', campaignId: campaign.id, campaignName: campaign.name, recipientId, clientName: name,
        trigger: campaign.trigger, step: item.step || 0, payload: item.payload || null, via,
        listingId: listing ? listing.id : null,
      },
      status: 'new',
    },
  });
  try {
    const { notify } = require('../../lib/notify');
    await notify({ workspaceId, type: 'ai', title: `${campaign.name} for ${name}`, body: text, data: { campaignId: campaign.id, clientId: client.id, insightId: insight.id, screen: 'automations' } });
  } catch { /* best effort */ }
  return insight;
}

function shape(i) {
  const d = i.data || {};
  return {
    id: i.id, kind: d.kind || 'reply', campaignId: d.campaignId, campaignName: d.campaignName, recipientId: d.recipientId,
    clientId: i.clientId, clientName: d.clientName, conversationId: i.conversationId, title: i.title, text: i.body || '',
    inboundText: d.inboundText || null, abstain: !!d.abstain, abstainReason: d.abstainReason || null, via: d.via || null,
    trigger: d.trigger || null, listingId: d.listingId || null, createdAt: i.createdAt, status: i.status,
  };
}

async function listSuggestions(workspaceId, { campaignId, limit = 50 } = {}) {
  const rows = await prisma.aiInsight.findMany({
    where: { workspaceId, type: TYPE, status: 'new', ...(campaignId ? { data: { path: ['campaignId'], equals: campaignId } } : {}) },
    orderBy: { createdAt: 'desc' }, take: limit,
  });
  return rows.map(shape);
}

// Approve (optionally edited) → queued approved_send → engine → Sender Guard.
async function approveSuggestion({ workspaceId, insightId, text }) {
  const insight = await prisma.aiInsight.findFirst({ where: { id: insightId, workspaceId, type: TYPE } });
  if (!insight) throw new HttpError(404, 'Suggestion not found');
  if (insight.status !== 'new') throw new HttpError(409, 'Already handled');
  // No business line: the agent sends it from the thread instead.
  await require('./mode').assertCanSend(workspaceId);
  const d = insight.data || {};
  const body = sanitizeOutbound(text != null ? text : insight.body);
  if (!body) throw new HttpError(400, 'Write the reply first');
  const row = await prisma.campaignRecipient.findFirst({ where: { id: d.recipientId, workspaceId }, include: { campaign: true } });
  if (!row) throw new HttpError(404, 'That person is no longer in this campaign');
  if (['opted_out', 'muted'].includes(row.status)) throw new HttpError(409, row.status === 'opted_out' ? 'They opted out of texts' : 'This person is muted');
  const client = await prisma.client.findFirst({ where: { id: row.clientId, workspaceId } });
  if (!client || client.textOptOut) throw new HttpError(409, 'They opted out of texts');

  const now = new Date();
  const origin = d.kind === 'automation_draft' ? 'auto_step' : 'reply';
  // Preview the guard so the agent knows when it will actually go.
  const check = await guard.checkSend({ workspaceId, client, kind: origin === 'auto_step' ? 'auto_step' : 'lane_step', now });
  if (!check.allow && !check.deferUntil) throw new HttpError(409, check.reason || 'This text cannot be sent');
  const at = check.allow ? now : new Date(check.deferUntil);
  const meta = Q.metaOf(row);
  const q = [...Q.queueOf(row), Q.item('approved_send', now, { payload: { text: body, insightId, origin, edited: text != null && text !== insight.body } })];
  const { awaitingApproval, ...rest } = meta;
  await prisma.campaignRecipient.update({
    where: { id: row.id },
    data: { ...Q.withQueue(rest, q), ...(row.status === 'drafting' ? {} : { status: ['canceled', 'failed'].includes(row.status) ? (row.lastSentAt ? 'sent' : 'pending') : row.status }) },
  });
  await prisma.aiInsight.update({ where: { id: insight.id }, data: { data: { ...d, approvedAt: now.toISOString(), approvedText: body }, status: 'seen' } });
  emit(workspaceId, { campaignId: d.campaignId, kind: 'suggestion_approved', recipientId: row.id, insightId });
  // Nudge the engine now (it claims atomically; harmless if a tick is running).
  setTimeout(() => { require('./engine').tick().catch(() => {}); }, 50);
  return { ok: true, sendsAt: at.toISOString(), waiting: check.allow ? null : check.reason };
}

async function dismissSuggestion({ workspaceId, insightId }) {
  const insight = await prisma.aiInsight.findFirst({ where: { id: insightId, workspaceId, type: TYPE } });
  if (!insight) throw new HttpError(404, 'Suggestion not found');
  await prisma.aiInsight.update({ where: { id: insight.id }, data: { status: 'dismissed' } });
  const d = insight.data || {};
  if (d.kind === 'automation_draft' && d.recipientId) {
    const row = await prisma.campaignRecipient.findFirst({ where: { id: d.recipientId, workspaceId } });
    if (row) {
      const { awaitingApproval, ...rest } = Q.metaOf(row);
      await prisma.campaignRecipient.update({ where: { id: row.id }, data: { meta: rest, ...(row.lastSentAt ? {} : { status: 'canceled', error: 'You skipped this one' }) } }).catch(() => {});
    }
  }
  emit(workspaceId, { campaignId: d.campaignId, kind: 'suggestion_dismissed', insightId });
  return { ok: true };
}

module.exports = { draftReplySuggestion, createDraftForApproval, listSuggestions, approveSuggestion, dismissSuggestion, shape, TYPE };

// Campaigns boot hook — reacts to messaging instantly when the inbox's
// in-process bus (services/messaging/events.js) is available:
//   inbound  → campaign reply pipeline (lanes, opt-outs, draft-first answers)
//   outbound → the agent's own text to a recipient = permanent takeover
//   status   → a campaign text that failed to deliver feeds the Sender Guard
// The 15s poller (jobs/campaignReplies.js) remains the safety net; both paths
// claim each (recipient, message) pair atomically, so nothing runs twice.
function init() {
  let bus = null;
  try {
    // eslint-disable-next-line global-require
    bus = require('../services/messaging/events');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') console.error('[campaigns] messaging bus failed to load:', err.message);
    return;
  }
  if (!bus || typeof bus.on !== 'function') return;
  const replies = require('../services/campaigns/replies');
  const guard = require('../services/campaigns/senderGuard');
  const prisma = require('../lib/prisma');

  const clientIdOf = (p) => (p.message && p.message.clientId) || (p.conversation && (p.conversation.clientId || (p.conversation.client && p.conversation.client.id))) || (p.client && p.client.id) || null;
  const isGroup = (p) => !!(p.conversation && p.conversation.isGroup);

  bus.on('inbound', async (p) => {
    if (!p || !p.workspaceId || !p.message || isGroup(p)) return;
    const clientId = clientIdOf(p);
    if (!clientId) return;
    await replies.onInboundMessage({ workspaceId: p.workspaceId, clientId, conversationId: p.message.conversationId, message: p.message });
  });

  bus.on('outbound', async (p) => {
    if (!p || !p.workspaceId || !p.message || isGroup(p)) return;
    if (p.source === 'campaign' || p.message.campaignId) return; // our own sends
    if (p.message.status === 'scheduled') return;
    const clientId = clientIdOf(p);
    if (!clientId) return;
    await replies.onManualOutbound({ workspaceId: p.workspaceId, clientId, conversationId: p.message.conversationId, message: p.message });
  });

  bus.on('status', async (p) => {
    if (!p || !p.workspaceId || !p.message) return;
    const status = p.status || p.message.status;
    if (status !== 'failed' || !p.message.campaignId || !p.message.isFromMe) return;
    await guard.recordFailure({ workspaceId: p.workspaceId });
    const m = await prisma.message.findUnique({ where: { id: p.message.id }, select: { campaignRecipientId: true, error: true } }).catch(() => null);
    if (m && m.campaignRecipientId) {
      await prisma.campaignRecipient.update({ where: { id: m.campaignRecipientId }, data: { error: `Last text did not deliver${m.error ? `: ${String(m.error).slice(0, 120)}` : ''}` } }).catch(() => {});
    }
  });
  console.log('[campaigns] listening to the messaging bus');
}

module.exports = { init };

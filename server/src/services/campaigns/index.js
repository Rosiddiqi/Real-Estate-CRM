// Campaigns + Automations — public service API (for routes, jobs, and other
// features such as Serena's campaign tools).
//
//   launchCampaign({ workspaceId, campaignId, startAt?, endAt? })
//   pauseCampaign / resumeCampaign / stopCampaign({ workspaceId, campaignId })
//   onInboundMessage({ workspaceId, clientId, conversationId, message })   reply pipeline
//   onManualOutbound({ workspaceId, clientId, conversationId, message })   agent takeover
//   senderGuard.status(workspaceId) / senderGuard.checkSend(...)
//   resolveAudience(workspaceId, audience) / resolveFromText(workspaceId, text)
//   listAutomations(workspaceId) / updateAutomation({ workspaceId, id, patch }) / runTriggers(workspaceId)
//   listSuggestions(workspaceId) / approveSuggestion / dismissSuggestion
const engine = require('./engine');
const replies = require('./replies');
const senderGuard = require('./senderGuard');
const audience = require('./audience');
const automations = require('./automations');
const suggestions = require('./suggestions');

module.exports = {
  launchCampaign: engine.launchCampaign,
  pauseCampaign: engine.pauseCampaign,
  resumeCampaign: engine.resumeCampaign,
  stopCampaign: engine.stopCampaign,
  tick: engine.tick,
  onInboundMessage: replies.onInboundMessage,
  onManualOutbound: replies.onManualOutbound,
  pollReplies: replies.pollReplies,
  senderGuard,
  resolveAudience: audience.resolveAudience,
  resolveFromText: audience.resolveFromText,
  listAutomations: automations.listAutomations,
  updateAutomation: automations.updateAutomation,
  runTriggers: automations.runTriggers,
  listSuggestions: suggestions.listSuggestions,
  approveSuggestion: suggestions.approveSuggestion,
  dismissSuggestion: suggestions.dismissSuggestion,
};

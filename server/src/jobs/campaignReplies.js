// Campaign replies — every 15s: a safety net behind the messaging event bus.
// Scans inbound messages since Workspace.settings.campaignCursor for active
// recipients (lane | question | off_topic, STOP → opt-out) and outbound
// texts the agent sent by hand (→ taken_over). Per-message claims make the
// bus handler and this poller idempotent.
const replies = require('../services/campaigns/replies');

module.exports = {
  name: 'campaign-replies',
  intervalMs: 15000,
  runOnBoot: true,
  bootDelayMs: 25000,
  run: () => replies.pollReplies(),
};

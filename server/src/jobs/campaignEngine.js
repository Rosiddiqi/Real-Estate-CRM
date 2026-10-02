// Campaign engine — every 10s: promote scheduled campaigns, recover stale
// claims, and send whatever is due (initial texts, lane follow-ups, reminders,
// approved replies, automation texts). Every send passes the Sender Guard;
// refusals park the recipient as rate_deferred with a plain reason.
const engine = require('../services/campaigns/engine');

module.exports = {
  name: 'campaign-engine',
  intervalMs: 10000,
  runOnBoot: true,
  bootDelayMs: 20000,
  run: () => engine.tick(),
};

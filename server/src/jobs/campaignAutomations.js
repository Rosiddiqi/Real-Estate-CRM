// Default automations — hourly sweep of every workspace with automations on:
// home anniversaries and birthdays (today, workspace timezone), new listing
// matches and price drops (last 48h), open-house and showing follow-ups (the
// morning after), post-closing check-ins and lease-expiry nudges. Enrollment
// is idempotent per trigger key, so re-running is safe; the engine does the
// sending (Sender Guard, quiet hours, draft-for-approval where set).
const automations = require('../services/campaigns/automations');

module.exports = {
  name: 'campaign-automations',
  schedule: '7 * * * *',
  runOnBoot: true,
  bootDelayMs: 45000,
  run: () => automations.runAllWorkspaces(),
};

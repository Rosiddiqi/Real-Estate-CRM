// Every 30s: send scheduled ("Send Later") messages whose time has come.
// The per-message claim is atomic, so overlapping servers never double-send.
const { dispatchDue } = require('../services/messaging/scheduled');

module.exports = {
  name: 'scheduled-sends',
  intervalMs: 30_000,
  runOnBoot: true,
  bootDelayMs: 5000,
  run: async () => {
    const { sent } = await dispatchDue({ limit: 50 });
    if (sent) console.log(`[scheduled-sends] sent ${sent} scheduled message(s)`);
  },
};

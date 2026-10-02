// Matchmaker full rescore: on boot (after the server settles) and nightly at
// 3:15 AM (APP_TIMEZONE) — every listing + owned home scored against every
// buyer search; Match rows (≥25) refreshed. The first population of a
// workspace never notifies (no "47 new matches" storm on day one).
const { rescoreAll } = require('../services/matchmaker/engine');

module.exports = {
  name: 'match-rescore',
  schedule: '15 3 * * *',
  runOnBoot: true,
  bootDelayMs: 9000,
  run: async () => {
    const out = await rescoreAll({});
    const total = out.reduce((n, w) => n + (w.stored || 0), 0);
    if (out.length) console.log(`[match-rescore] ${out.length} workspace(s), ${total} match rows`);
  },
};

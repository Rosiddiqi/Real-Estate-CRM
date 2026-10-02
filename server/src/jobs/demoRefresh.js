// Nightly demo refresh. The demo book is anchored to the moment it was seeded
// (today's showings, last night's unread texts, this month's closings), so a
// long-running TestFlight server re-seeds it before dawn to keep it "live".
// Off unless DEMO_DAILY_RESET=1. Touches only the demo workspace — the seed
// wipes by the demo user's workspace and keeps stable ids, so sessions survive.
const { execFile } = require('node:child_process');
const path = require('node:path');
const config = require('../config');
const prisma = require('../lib/prisma');

const SERVER_DIR = path.join(__dirname, '..', '..');

module.exports = {
  name: 'demo-refresh',
  schedule: '20 4 * * *', // 4:20 AM in APP_TIMEZONE
  run: async () => {
    if (!/^(1|true|yes|on)$/i.test(process.env.DEMO_DAILY_RESET || '') || !config.auth.demoLogin) return;
    const ok = await new Promise((resolve) => {
      execFile(process.execPath, [path.join(SERVER_DIR, 'prisma', 'seed', 'index.js')], {
        cwd: SERVER_DIR,
        env: { ...process.env, SEED_NOW: '' }, // always "now" — never a preview date
        timeout: 5 * 60e3,
        maxBuffer: 4 * 1024 * 1024,
      }, (err, _stdout, stderr) => {
        if (err) console.error('[demo-refresh] seed failed:', err.message, String(stderr || '').slice(-800));
        resolve(!err);
      });
    });
    if (!ok) return;
    console.log('[demo-refresh] demo book re-anchored to today');
    // Anyone with the demo open refetches instead of looking at yesterday.
    try {
      const email = String(process.env.DEMO_EMAIL || 'demo@keymatch.app').toLowerCase();
      const user = await prisma.user.findUnique({ where: { email }, select: { workspaceId: true } });
      if (user) require('../realtime/hub').broadcast(user.workspaceId, 'resync', { reason: 'demo-refresh' });
    } catch { /* best effort */ }
  },
};

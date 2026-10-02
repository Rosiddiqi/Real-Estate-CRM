// Battle Plan watchdog — every 30 minutes, make sure each agent has today's
// and tomorrow's plan (generates only what's missing). Quiet 01:00–04:59 local
// so the 4 AM warm pass owns the day roll.
const prisma = require('../lib/prisma');
const config = require('../config');
const { partsIn, dayKey, addDays } = require('../lib/dates');
const bp = require('../services/battlePlan');

module.exports = {
  name: 'battle-plan-watchdog',
  schedule: '*/30 * * * *',
  async run() {
    const users = await prisma.user.findMany({ select: { id: true, workspaceId: true, timezone: true } });
    const ws = await prisma.workspace.findMany({ select: { id: true, timezone: true } });
    const tzBy = new Map(ws.map((w) => [w.id, w.timezone]));
    for (const u of users) {
      const tz = u.timezone || tzBy.get(u.workspaceId) || config.timezone;
      const { hour } = partsIn(new Date(), tz);
      if (hour >= 1 && hour < 5) continue;
      const today = dayKey(new Date(), tz);
      try {
        await bp.ensurePlan({ workspaceId: u.workspaceId, userId: u.id, date: today });
        await bp.ensurePlan({ workspaceId: u.workspaceId, userId: u.id, date: addDays(today, 1) });
      } catch (err) {
        console.error(`[battle-plan-watchdog] ${u.id}:`, err.message);
      }
    }
  },
};

// Battle Plan pre-generation, per agent, in the agent's own time zone:
//   • boot (+45 s): warm tomorrow, then today
//   • 04:00 local: warm today + tomorrow (non-forced)
//   • 12:00 and 19:00 local: FORCE-regenerate tomorrow (the 7 PM pass is the
//     one the rail's auto-flip relies on)
// Runs every 15 minutes and acts when an agent's local clock is inside one of
// those windows; a per-day slot stamp on the PlanDay keeps each forced pass
// to once per window. Plans for a date are keyed by date, so the day roll
// never discards tomorrow's plan — it simply becomes today's.
const prisma = require('../lib/prisma');
const config = require('../config');
const { partsIn, dayKey, addDays } = require('../lib/dates');
const bp = require('../services/battlePlan');

async function agents() {
  const users = await prisma.user.findMany({ select: { id: true, workspaceId: true, timezone: true } });
  const ws = await prisma.workspace.findMany({ where: { id: { in: [...new Set(users.map((u) => u.workspaceId))] } }, select: { id: true, timezone: true } });
  const tzBy = new Map(ws.map((w) => [w.id, w.timezone]));
  return users.map((u) => ({ ...u, tz: u.timezone || tzBy.get(u.workspaceId) || config.timezone }));
}

async function warm(a) {
  const today = dayKey(new Date(), a.tz);
  const tomorrow = addDays(today, 1);
  await bp.ensurePlan({ workspaceId: a.workspaceId, userId: a.id, date: tomorrow });
  await bp.ensurePlan({ workspaceId: a.workspaceId, userId: a.id, date: today });
}

async function forceTomorrow(a, slot) {
  const today = dayKey(new Date(), a.tz);
  const tomorrow = addDays(today, 1);
  const pd = await prisma.planDay.findUnique({ where: { userId_date: { userId: a.id, date: tomorrow } }, select: { meta: true } });
  const stamp = `${today}:${slot}`;
  if (pd && pd.meta && pd.meta.forcedSlot === stamp) return;
  await bp.generatePlanDay({ workspaceId: a.workspaceId, userId: a.id, date: tomorrow, force: true, reason: `pregen_${slot}`, metaExtra: { forcedSlot: stamp } });
}

let booted = false;

module.exports = {
  name: 'battle-plan-pregen',
  schedule: '*/15 * * * *',
  runOnBoot: true,
  bootDelayMs: 45000,
  async run() {
    const list = await agents();
    for (const a of list) {
      try {
        if (!booted) { await warm(a); continue; }
        const { hour, minute } = partsIn(new Date(), a.tz);
        if (minute >= 15) continue;
        if (hour === 4) await warm(a);
        else if (hour === 12) await forceTomorrow(a, 'noon');
        else if (hour === 19) await forceTomorrow(a, 'evening');
      } catch (err) {
        console.error(`[battle-plan-pregen] ${a.id}:`, err.message);
      }
    }
    booted = true;
  },
};

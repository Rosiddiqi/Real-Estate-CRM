// Month rollover — closed deals from earlier months leave the board (archivedAt)
// on the 1st, in EACH workspace's own time zone (RevMatch hard-coded New York).
// Works both ways: a closed deal whose closing date was edited back into the
// current month returns to the Closed column. Runs hourly and on boot; it is
// idempotent, so the hour it lands in a given zone doesn't matter. The Book of
// Business and Commissions query closed deals directly, so nothing is lost.
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { monthBounds } = require('../lib/dates');

async function rolloverWorkspace(workspaceId, tz, now = new Date()) {
  const { start, end } = monthBounds(now, tz);
  const [toArchive, toRestore] = await Promise.all([
    prisma.deal.findMany({ where: { workspaceId, stage: 'closed', archivedAt: null, closedAt: { lt: start } }, select: { id: true } }),
    prisma.deal.findMany({ where: { workspaceId, stage: 'closed', archivedAt: { not: null }, closedAt: { gte: start, lt: end } }, select: { id: true } }),
  ]);
  if (toArchive.length) {
    await prisma.deal.updateMany({ where: { id: { in: toArchive.map((d) => d.id) } }, data: { archivedAt: now } });
  }
  if (toRestore.length) {
    await prisma.deal.updateMany({ where: { id: { in: toRestore.map((d) => d.id) } }, data: { archivedAt: null } });
  }
  const changed = [...toArchive, ...toRestore].map((d) => d.id);
  if (changed.length) {
    try {
      const { normalizeMany } = require('../services/pipeline/normalize');
      const rows = await prisma.deal.findMany({ where: { id: { in: changed } } });
      for (const n of await normalizeMany(workspaceId, rows)) hub.broadcast(workspaceId, 'deal_updated', n);
    } catch (err) {
      console.error('[pipeline-rollover] broadcast failed', err.message);
    }
  }
  return { archived: toArchive.length, restored: toRestore.length };
}

async function run() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, timezone: true } });
  for (const ws of workspaces) {
    try {
      const r = await rolloverWorkspace(ws.id, ws.timezone || 'America/New_York');
      if (r.archived || r.restored) console.log(`[pipeline-rollover] ${ws.id}: archived ${r.archived}, restored ${r.restored}`);
    } catch (err) {
      console.error(`[pipeline-rollover] workspace ${ws.id} failed:`, err.message);
    }
  }
}

module.exports = {
  name: 'pipeline-rollover',
  schedule: '7 * * * *',
  runOnBoot: true,
  bootDelayMs: 30000,
  run,
  rolloverWorkspace,
};

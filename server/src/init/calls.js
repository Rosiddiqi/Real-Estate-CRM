// Boot hook for calls: simulated calls live in memory, so any call left
// "ringing" / "in progress" by a previous process is closed out on boot (its
// transcript so far is kept and the recap still runs).
const prisma = require('../lib/prisma');

function init() {
  setTimeout(async () => {
    try {
      // Only calls nobody has touched for a minute (several API processes may share a DB in dev).
      const stale = await prisma.phoneCall.findMany({ where: { status: { in: ['ringing', 'in_progress'] }, updatedAt: { lt: new Date(Date.now() - 60000) } }, select: { id: true, workspaceId: true, meta: true } });
      const sims = stale.filter((c) => c.meta && c.meta.mode === 'simulated');
      if (!sims.length) return;
      const sim = require('../services/calls/simulator');
      for (const c of sims) await sim.hangup(c.id, { by: 'system', workspaceId: c.workspaceId }).catch(() => {});
      console.log(`[calls] closed ${sims.length} interrupted simulated call(s)`);
    } catch (err) {
      console.warn('[calls] boot cleanup skipped:', err.message);
    }
  }, 3000).unref();
}

module.exports = { init };

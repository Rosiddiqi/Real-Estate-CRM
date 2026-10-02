// Matchmaker change watch (every minute): rescoring is debounced on writes
// that go through /api/listings, but buyer searches, owned homes and clients
// are edited by other surfaces — so we fingerprint those tables per workspace
// and rescore when anything moved. Also closes the draft loop: a drafted
// match flips to "sent" once an outbound text to that client follows.
const prisma = require('../lib/prisma');
const { scheduleRescore } = require('../services/matchmaker/engine');
const { bustPool } = require('../services/matchmaker/pool');

const last = new Map(); // workspaceId -> fingerprint
let firstPass = true; // boot rescore (match-rescore job) covers workspaces that exist at boot

async function fingerprint(workspaceId) {
  const [s, p, l, c] = await Promise.all([
    prisma.buyerSearch.aggregate({ where: { workspaceId }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.portfolioProperty.aggregate({ where: { workspaceId }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.listing.aggregate({ where: { workspaceId }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.client.aggregate({ where: { workspaceId }, _max: { updatedAt: true }, _count: { _all: true } }),
  ]);
  const part = (a) => `${a._count._all}:${a._max.updatedAt ? new Date(a._max.updatedAt).getTime() : 0}`;
  return [part(s), part(p), part(l), part(c)].join('|');
}

async function closeDraftLoop(workspaceId) {
  const drafted = await prisma.match.findMany({
    where: { workspaceId, draftText: { not: null }, status: { in: ['new', 'seen'] }, updatedAt: { gte: new Date(Date.now() - 3 * 864e5) } },
    select: { id: true, clientId: true, factors: true, listingId: true },
    take: 200,
  });
  for (const m of drafted) {
    const at = m.factors && m.factors.draftedAt ? new Date(m.factors.draftedAt) : null;
    if (!at) continue;
    const sent = await prisma.message.findFirst({ where: { workspaceId, clientId: m.clientId, isFromMe: true, sentAt: { gte: at }, status: { notIn: ['failed', 'cancelled', 'scheduled'] } }, select: { sentAt: true } });
    if (!sent) continue;
    await prisma.match.update({ where: { id: m.id }, data: { status: 'sent', sentAt: sent.sentAt } });
    await prisma.matchFeedback.create({ data: { workspaceId, matchId: m.id, clientId: m.clientId, listingId: m.listingId, event: 'sent', meta: { via: 'thread' } } }).catch(() => {});
  }
}

module.exports = {
  name: 'match-watch',
  intervalMs: 60 * 1000,
  runOnBoot: true,
  bootDelayMs: 30000,
  run: async () => {
    const ws = await prisma.workspace.findMany({ select: { id: true } });
    for (const w of ws) {
      try {
        const fp = await fingerprint(w.id);
        const prev = last.get(w.id);
        last.set(w.id, fp);
        // changed since last minute — or a workspace created after boot
        // (signup, demo seed): score it now instead of waiting for 3:15 AM
        if ((prev && prev !== fp) || (!prev && !firstPass)) {
          bustPool(w.id);
          scheduleRescore(w.id, { all: true, delay: 2000 });
        }
        await closeDraftLoop(w.id);
      } catch (err) {
        console.error('[match-watch] failed for', w.id, err.message);
      }
    }
    firstPass = false;
  },
};

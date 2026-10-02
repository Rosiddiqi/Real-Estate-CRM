// Matchmaker service — the public surface other features consume.
//
//   const mm = require('../services/matchmaker');
//   await mm.getRecentMatches({ workspaceId, sinceDays: 7, minScore: 80, limit: 50 })
//     → [{ id, kind, score, priority, summary, confidence, status, createdAt, updatedAt, raisedAt,
//          clientId, client:{id,name,firstName,avatarUrl,phone,isWhale},
//          listingId, listing:{id,title,clientLabel,neighborhood,price,photo,status,lane,origin} | null,
//          propertyId, property:{id,label,ownerClientId,ownerName} | null,
//          headline, factors, mustHaves, verifyHold, bucket, searchName }]
//   mm.scoreListingForSearch(listing, search, ctx)   (pure scorer — see ./score.js)
//   await mm.clientMatches({ workspaceId, clientId, minScore }) (best matches per BuyerSearch)
//   await mm.hottest({ workspaceId, minScore: 90 })  (live, one row per person)
//   mm.scheduleRescore(workspaceId, { listingId })   (debounced, after writes)
const prisma = require('../../lib/prisma');
const { scoreListingForSearch, MATCH_CONFIG, rankScored } = require('./score');
const engine = require('./engine');
const { getDemandPool, bustPool, clientName, searchSummary } = require('./pool');
const shape = require('../listings/shape');

const CLIENT_SEL = { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, phone: true, isWhale: true, lifetimeVolume: true };

async function getRecentMatches({ workspaceId, sinceDays = 7, minScore = MATCH_CONFIG.showThreshold, limit = 50 } = {}) {
  if (!workspaceId) return [];
  const count = await prisma.match.count({ where: { workspaceId } });
  if (!count) {
    try { await engine.rescoreWorkspace(workspaceId, { notifyHot: false, emit: false }); } catch (err) { console.error('[matchmaker] lazy rescore failed', err.message); }
  }
  const since = Date.now() - sinceDays * 864e5;
  const rows = await prisma.match.findMany({
    where: { workspaceId, score: { gte: minScore }, status: { not: 'dismissed' } },
    include: {
      client: { select: CLIENT_SEL },
      listing: { include: { source: { select: { id: true, name: true, kind: true, color: true } } } },
    },
    orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
    take: 600,
  });
  const recent = rows.filter((m) => {
    const meta = m.factors && typeof m.factors === 'object' ? m.factors : {};
    const raised = meta.raisedAt ? new Date(meta.raisedAt).getTime() : 0;
    return new Date(m.createdAt).getTime() >= since || raised >= since;
  }).slice(0, limit);
  const ppIds = [...new Set(recent.filter((m) => m.propertyId).map((m) => m.propertyId))];
  const props = ppIds.length ? await prisma.portfolioProperty.findMany({ where: { id: { in: ppIds }, workspaceId }, include: { client: { select: CLIENT_SEL } } }) : [];
  const ppMap = new Map(props.map((p) => [p.id, p]));
  const { propertyLabel } = require('./offmarket');
  return recent.map((m) => {
    const meta = m.factors && typeof m.factors === 'object' ? m.factors : {};
    const c = m.client;
    const name = clientName(c);
    const card = m.listing ? shape.cardShape(m.listing) : null;
    const pp = m.propertyId ? ppMap.get(m.propertyId) : null;
    const subjectLabel = card ? card.title : pp ? propertyLabel(pp) : 'a home';
    return {
      id: m.id, kind: m.kind, score: m.score, priority: m.priority, summary: m.summary, confidence: m.confidence,
      status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt, raisedAt: meta.raisedAt || m.createdAt,
      clientId: m.clientId,
      client: c ? { id: c.id, name, firstName: c.firstName, avatarUrl: c.avatarUrl, phone: c.phone, isWhale: !!c.isWhale || (c.lifetimeVolume || 0) >= 10e6 } : null,
      listingId: m.listingId,
      listing: card ? { id: card.id, title: card.title, clientLabel: card.clientLabel, neighborhood: card.neighborhood, price: card.listPrice, photo: card.photos[0] || null, status: card.status, lane: card.lane, origin: card.origin, dropAmount: card.dropAmount } : null,
      propertyId: m.propertyId,
      property: pp ? { id: pp.id, label: propertyLabel(pp), ownerClientId: pp.clientId, ownerName: clientName(pp.client), photo: pp.heroPhoto || (pp.photos || [])[0] || null } : null,
      headline: `${name} → ${subjectLabel}`,
      narrative: m.narrative,
      factors: meta.factors || [], mustHaves: meta.mustHaves || [], verifyHold: !!meta.verifyHold,
      bucket: meta.bucket || null, searchName: meta.searchName || null, whale: !!meta.whale,
    };
  });
}

// Best matches for ONE client, per BuyerSearch (live scoring, owner excluded).
async function clientMatches({ workspaceId, clientId, minScore = MATCH_CONFIG.contactThreshold, perSearch = 6 }) {
  const pool = await getDemandPool(workspaceId);
  const entries = pool.entries.filter((e) => e.clientId === clientId);
  const listings = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null, status: { in: ['active', 'coming_soon', 'off_market'] } }, include: engine.LISTING_INCLUDE });
  const dismissed = new Set((await prisma.match.findMany({ where: { workspaceId, clientId, status: 'dismissed' }, select: { subjectKey: true } })).map((m) => m.subjectKey));
  const statusBy = new Map((await prisma.match.findMany({ where: { workspaceId, clientId }, select: { subjectKey: true, status: true, id: true } })).map((m) => [m.subjectKey, m]));
  const searches = entries.map((e) => {
    const scored = [];
    for (const l of listings) {
      if (l.ownerClientId === clientId || dismissed.has(l.id)) continue;
      const r = scoreListingForSearch(l, e.search, { extraMustHaves: e.extraMustHaves, signals: e.signals });
      if (r.gated || r.score < minScore) continue;
      const pm = statusBy.get(l.id);
      scored.push({ listing: shape.cardShape(l), matchId: pm ? pm.id : null, status: pm ? pm.status : null, score: r.score, summary: r.summary, confidence: r.confidence, verifyHold: r.verifyHold, crossedBudget: r.crossedBudget, factors: r.factors, mustHaves: r.mustHaves });
    }
    scored.sort((a, b) => b.score - a.score || shape.tierRank(a.listing) - shape.tierRank(b.listing));
    return {
      search: { id: e.search.id, name: e.search.name, bucket: e.bucket, summary: searchSummary(e.search), priority: e.priority },
      matches: scored.slice(0, perSearch),
      total: scored.length,
    };
  });
  // Demand for the homes THIS client owns (off-market interest).
  let ownedDemand = [];
  try {
    const { computePairs, propertyLabel } = require('./offmarket');
    const pairs = await computePairs(workspaceId, { pool, minScore: MATCH_CONFIG.showThreshold });
    ownedDemand = pairs.filter((p) => p.property.clientId === clientId).map((p) => ({
      propertyId: p.property.id, label: propertyLabel(p.property), triggers: p.triggers,
      buyers: p.rows.slice(0, 5).map((r) => ({ clientId: r.entry.clientId, name: r.entry.name, score: r.result.score, bucket: r.entry.bucket, whale: r.entry.whale })),
      count: p.rows.length,
    }));
  } catch (err) { console.error('[matchmaker] owned demand failed', err.message); }
  const best = searches.flatMap((s) => s.matches.map((m) => ({ ...m, searchId: s.search.id }))).sort((a, b) => b.score - a.score);
  const seen = new Set();
  const bestUnique = best.filter((m) => (seen.has(m.listing.id) ? false : (seen.add(m.listing.id), true)));
  return { clientId, threshold: minScore, searches, best: bestUnique.slice(0, 10), ownedDemand };
}

// Live hottest matches across listings, whispers and off-market — one row per person.
async function hottest({ workspaceId, minScore = MATCH_CONFIG.hotThreshold, limit = 30 } = {}) {
  const { peopleRows } = require('./feeds');
  const out = await peopleRows(workspaceId, { minScore, includeOffMarket: true });
  return out.slice(0, limit);
}

module.exports = {
  MATCH_CONFIG,
  scoreListingForSearch,
  rankScored,
  getRecentMatches,
  clientMatches,
  hottest,
  rescoreWorkspace: engine.rescoreWorkspace,
  rescoreListing: engine.rescoreListing,
  rescoreAll: engine.rescoreAll,
  scheduleRescore: engine.scheduleRescore,
  listingBuyers: engine.listingBuyers,
  getDemandPool,
  bustPool,
};

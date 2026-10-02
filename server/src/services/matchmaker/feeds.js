// Matchmaker feeds — the shapes behind each Matchmaker mode, scored live from
// the cached demand pool (so every surface shows identical numbers).
//
//   listingsFeed(ws)  → { people, listings, threshold, counts }        (Listings mode)
//   whisperFeed(ws)   → { whispers, people }                           (Whisper mode)
//   offMarketFeed(ws) → { pairs, counts }                              (Off-Market mode)
//   dropsFeed(ws)     → { drops, windowDays }                          (Price Drops mode)
//   peopleRows(ws, {minScore}) → one row per person, best match first (Clients list, digest)
const prisma = require('../../lib/prisma');
const { MATCH_CONFIG, rankScored } = require('./score');
const engine = require('./engine');
const { getDemandPool } = require('./pool');
const shape = require('../listings/shape');

const DAY = 864e5;

async function feedbackState(workspaceId) {
  const rows = await prisma.match.findMany({
    where: { workspaceId, status: { in: ['dismissed', 'sent'] } },
    select: { id: true, subjectKey: true, clientId: true, status: true, sentAt: true },
  });
  const dismissed = new Set();
  const sent = new Map();
  for (const r of rows) {
    const k = `${r.subjectKey}|${r.clientId}`;
    if (r.status === 'dismissed') dismissed.add(k);
    else sent.set(k, r.sentAt || true);
  }
  const ids = new Map((await prisma.match.findMany({ where: { workspaceId, score: { gte: MATCH_CONFIG.contactThreshold } }, select: { id: true, subjectKey: true, clientId: true } })).map((m) => [`${m.subjectKey}|${m.clientId}`, m.id]));
  return { dismissed, sent, ids };
}

function subjectOfCard(card) {
  return {
    kind: card.lane === 'whisper' ? 'whisper' : 'listing',
    id: card.id,
    listingId: card.id,
    label: card.title,
    sub: card.subtitle,
    photo: card.photos[0] || null,
    price: card.listPrice || null,
    lane: card.lane, laneLabel: card.laneLabel, laneColor: card.laneColor,
    badges: card.badges, dropAmount: card.dropAmount, status: card.status,
    neighborhood: card.neighborhood,
  };
}

// Every live listing, scored. Dismissed pairs removed.
async function scoredListings(workspaceId, { where = {}, fb } = {}) {
  const pool = await getDemandPool(workspaceId);
  const state = fb || await feedbackState(workspaceId);
  const listings = await prisma.listing.findMany({
    where: { workspaceId, droppedAt: null, status: { notIn: ['sold', 'withdrawn', 'expired'] }, ...where },
    include: engine.LISTING_INCLUDE,
  });
  return {
    pool,
    state,
    items: listings.map((l) => {
      const rows = engine.scoreSubject(l, pool, { ownerClientId: l.ownerClientId })
        .filter((r) => !state.dismissed.has(`${l.id}|${r.entry.clientId}`));
      return { listing: l, card: shape.cardShape(l), rows };
    }),
  };
}

function matchExtra(state, subjectKey, clientId) {
  const k = `${subjectKey}|${clientId}`;
  return { matchId: state.ids.get(k) || null, sent: state.sent.has(k) };
}

function topMatchOf(rows, state, subjectKey) {
  const r = rows[0];
  if (!r) return null;
  return {
    clientId: r.entry.clientId, name: r.entry.name, first: r.entry.first, avatarUrl: r.entry.client.avatarUrl || null,
    score: r.result.score, bucket: r.entry.bucket, whale: r.entry.whale, verifyHold: r.result.verifyHold,
    summary: r.result.summary, ...matchExtra(state, subjectKey, r.entry.clientId),
  };
}

// People-first list: one row per person, their best match (+N more).
function collapsePeople(entries, { minScore }) {
  const byClient = new Map();
  for (const e of entries) {
    if (e.buyer.score < minScore) continue;
    const k = e.buyer.clientId;
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k).push(e);
  }
  const rows = [];
  for (const [clientId, list] of byClient) {
    list.sort((a, b) => b.buyer.score - a.buyer.score || (a.tier ?? 0) - (b.tier ?? 0));
    const best = list[0];
    rows.push({
      key: clientId,
      clientId,
      client: {
        id: clientId, name: best.buyer.name, first: best.buyer.first, avatarUrl: best.buyer.avatarUrl,
        whale: best.buyer.whale, bucket: best.buyer.bucket, priority: best.buyer.priority, channel: best.buyer.channel, phone: best.buyer.phone,
      },
      best: { ...best.buyer, subject: best.subject },
      others: list.slice(1).map((x) => ({ ...x.buyer, subject: x.subject })),
      count: list.length,
      priority: best.buyer.priority,
      tier: best.tier ?? 0,
    });
  }
  rows.sort((a, b) => b.best.score - a.best.score || b.priority - a.priority || a.tier - b.tier || a.client.name.localeCompare(b.client.name));
  return rows;
}

async function peopleRows(workspaceId, { minScore = MATCH_CONFIG.showThreshold, includeOffMarket = false, lanes = null } = {}) {
  const { items, state, pool } = await scoredListings(workspaceId);
  const entries = [];
  for (const it of items) {
    if (lanes && !lanes.includes(it.card.lane)) continue;
    const subject = subjectOfCard(it.card);
    const tier = shape.tierRank(it.card);
    for (const r of it.rows) {
      if (r.result.score < minScore) break; // rows are score-sorted
      entries.push({ subject, tier, buyer: engine.buyerRow(r, matchExtra(state, it.listing.id, r.entry.clientId)) });
    }
  }
  if (includeOffMarket) {
    const { computePairs, propertyLabel, placeOf } = require('./offmarket');
    const pairs = await computePairs(workspaceId, { pool, minScore });
    for (const pr of pairs) {
      const subjectKey = `pp:${pr.property.id}`;
      const subject = {
        kind: 'offmarket', id: pr.property.id, propertyId: pr.property.id,
        label: propertyLabel(pr.property), sub: `Owned by ${pr.owner.firstName || 'a client'} · off-market`,
        photo: pr.property.heroPhoto || (pr.property.photos || [])[0] || null,
        price: pr.property.estValue || null, lane: 'offmarket', laneLabel: 'Off-market', laneColor: '#C08BFF',
        badges: ['OFF-MARKET'], place: placeOf(pr.property), ownerClientId: pr.owner.id,
      };
      for (const r of pr.rows) {
        if (state.dismissed.has(`${subjectKey}|${r.entry.clientId}`)) continue;
        entries.push({ subject, tier: 5e5, buyer: engine.buyerRow(r, matchExtra(state, subjectKey, r.entry.clientId)) });
      }
    }
  }
  return collapsePeople(entries, { minScore });
}

async function listingsFeed(workspaceId) {
  const threshold = MATCH_CONFIG.showThreshold;
  const { items, state } = await scoredListings(workspaceId);
  const entries = [];
  const listings = items.map((it) => {
    const shown = it.rows.filter((r) => r.result.score >= threshold);
    const subject = subjectOfCard(it.card);
    const tier = shape.tierRank(it.card);
    for (const r of shown) entries.push({ subject, tier, buyer: engine.buyerRow(r, matchExtra(state, it.listing.id, r.entry.clientId)) });
    return {
      ...it.card,
      tier,
      matchCount: shown.length,
      hotCount: shown.filter((r) => r.result.score >= MATCH_CONFIG.hotThreshold).length,
      topMatch: shown.length ? topMatchOf(shown, state, it.listing.id) : null,
      bestScore: it.rows[0] ? it.rows[0].result.score : 0,
    };
  });
  listings.sort((a, b) => a.tier - b.tier || b.bestScore - a.bestScore);
  const people = collapsePeople(entries, { minScore: threshold });
  return { threshold, people, listings, counts: { listings: listings.length, people: people.length, matched: listings.filter((l) => l.matchCount).length } };
}

async function whisperFeed(workspaceId) {
  const { items, state } = await scoredListings(workspaceId, { where: { origin: 'whisper' } });
  const whispers = items.map((it) => {
    const ranked = rankScored(it.rows.map((r) => ({ ...r, priority: r.entry.priority })), { fallback: true });
    return {
      ...it.card,
      note: it.listing.description || it.listing.headline || null,
      confidence: it.listing.confidence || null,
      threshold: ranked.threshold,
      fallback: ranked.fallback,
      shownCount: ranked.shown.length,
      topMatch: ranked.shown.length ? topMatchOf(ranked.shown, state, it.listing.id) : null,
      bestScore: it.rows[0] ? it.rows[0].result.score : 0,
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { whispers };
}

async function dropsFeed(workspaceId, { windowDays = 21 } = {}) {
  const since = new Date(Date.now() - windowDays * DAY);
  const { items, state } = await scoredListings(workspaceId, { where: { previousPrice: { not: null }, priceDroppedAt: { gte: since } } });
  const ids = items.map((it) => it.listing.id);
  const events = ids.length ? await prisma.listingPriceEvent.findMany({ where: { listingId: { in: ids } }, orderBy: { changedAt: 'desc' } }) : [];
  const evBy = new Map();
  for (const e of events) { if (!evBy.has(e.listingId)) evBy.set(e.listingId, []); evBy.get(e.listingId).push(e); }
  const drops = items
    .filter((it) => it.card.previousPrice && it.card.listPrice && it.card.previousPrice > it.card.listPrice)
    .map((it) => {
      const shown = it.rows.filter((r) => r.result.score >= MATCH_CONFIG.showThreshold);
      const crossed = it.rows.filter((r) => r.result.crossedBudget && r.result.score >= MATCH_CONFIG.contactThreshold);
      return {
        ...it.card,
        priceEvents: (evBy.get(it.listing.id) || []).slice(0, 6).map((e) => ({ fromPrice: e.fromPrice, toPrice: e.toPrice, changedAt: e.changedAt })),
        matchCount: shown.length,
        topMatch: shown.length ? topMatchOf(shown, state, it.listing.id) : null,
        nowInBudget: crossed.map((r) => ({ clientId: r.entry.clientId, name: r.entry.name, first: r.entry.first, score: r.result.score, whale: r.entry.whale })),
      };
    })
    .sort((a, b) => (b.dropAmount || 0) - (a.dropAmount || 0));
  return { windowDays, drops };
}

async function offMarketFeed(workspaceId) {
  const { computePairs, pairCards, ACTIVE_FLOOR } = require('./offmarket');
  const state = await feedbackState(workspaceId);
  const pairs = await computePairs(workspaceId, {});
  const cards = pairCards(pairs, { dismissed: state.dismissed, minScore: ACTIVE_FLOOR })
    .map((c) => ({ ...c, ...matchExtra(state, `pp:${c.property.id}`, c.buyer.clientId) }));
  const owners = await prisma.portfolioProperty.count({ where: { workspaceId, relationship: 'owns' } });
  return {
    pairs: cards,
    counts: { active: cards.filter((c) => c.status === 'active').length, watching: cards.filter((c) => c.status === 'watching').length, ownedHomes: owners },
    checkedAt: new Date().toISOString(),
  };
}

// Buyers for one listing (detail sheet). Price-drop crossers sort first.
async function buyersForListing(workspaceId, listing, { fallback = false } = {}) {
  const state = await feedbackState(workspaceId);
  const rows = (await engine.listingBuyers(workspaceId, listing))
    .filter((r) => !state.dismissed.has(`${listing.id}|${r.entry.clientId}`));
  const crossedFirst = [...rows].sort((a, b) => (Number(b.result.crossedBudget) - Number(a.result.crossedBudget)) || b.result.score - a.result.score);
  const ranked = rankScored(crossedFirst.map((r) => ({ ...r, priority: r.entry.priority })), { fallback });
  // keep crossers on top inside the shown list
  const shown = [...ranked.shown].sort((a, b) => (Number(b.result.crossedBudget) - Number(a.result.crossedBudget)) || b.result.score - a.result.score);
  return {
    threshold: ranked.threshold,
    fallback: ranked.fallback,
    shown: shown.map((r) => engine.buyerRow(r, matchExtra(state, listing.id, r.entry.clientId))),
    hiddenCount: ranked.hidden.length,
    hidden: ranked.shown.length ? ranked.hidden.slice(0, 12).map((r) => engine.buyerRow(r, matchExtra(state, listing.id, r.entry.clientId))) : [],
    closest: ranked.shown.length ? [] : ranked.hidden.slice(0, 3).map((r) => engine.buyerRow(r, matchExtra(state, listing.id, r.entry.clientId))),
  };
}

module.exports = { listingsFeed, whisperFeed, dropsFeed, offMarketFeed, peopleRows, scoredListings, buyersForListing, feedbackState };

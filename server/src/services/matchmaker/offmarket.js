// Off-market pairing (RM "C2C", spec 06 §8.7): a home one client OWNS scored
// against every OTHER client's searches — a potential double-ended private
// deal. Owner excluded by id + normalized name + household links. Pair status
// comes from seller-likelihood triggers:
//   tenure         owned 5–15 yrs → watching; 7–12 yrs → active
//   loan_event     ARM reset / balloon / IO end / maturity ≤180d → watching; ≤60d → active
//   stated_intent  thinkingOfSelling, or a sell signal ≥0.3 → watching; ≥0.6 → active
//   prior_listing  their listing expired / withdrawn ≤12 months → active
//   second_home    bought another home in the same market ≤18 months → watching
//   active pair = score ≥80 AND an active trigger; stored ≥50.
const prisma = require('../../lib/prisma');
const { getDemandPool, clientName, firstOf } = require('./pool');
const { scoreSubject, persistSubject, buyerRow } = require('./engine');
const distill = require('./distill');
const V = require('./vocab');

const DAY = 864e5;
const PAIR_FLOOR = 50;
const ACTIVE_FLOOR = 80;

// PortfolioProperty → the listing shape the scorer reads.
function propertyAsListing(pp) {
  const flags = {};
  if (Array.isArray(pp.features)) {
    for (const f of pp.features) {
      const key = f && V.normalizeAmenity(f.name || f.feature || '');
      if (key && f.confirmed === true) flags[key] = true;
      if (key && f.confirmed === false) flags[key] = false;
    }
  }
  return {
    id: `pp:${pp.id}`,
    updatedAt: pp.updatedAt,
    origin: 'portfolio',
    status: 'active',
    market: pp.market, city: pp.city, neighborhood: pp.neighborhood || pp.subdivision, buildingName: pp.buildingName,
    street: pp.street, unitNumber: pp.unit, postalCode: pp.zip, state: pp.state, lat: pp.lat, lng: pp.lng,
    propertyType: pp.propertyType, architecturalStyle: pp.architecturalStyle, styleFamily: pp.styleFamily,
    listPrice: pp.estValue || pp.purchasePrice || null,
    beds: pp.beds, bathsTotal: pp.baths, livingAreaSqft: pp.sqft, lotSqft: pp.lotSqft, lotAcres: pp.lotAcres,
    yearBuilt: pp.yearBuilt, stories: pp.stories, garageSpaces: pp.garageSpaces,
    waterfront: pp.waterfront, waterFrontageFt: pp.waterFrontageFt, dockLengthFt: pp.dockLengthFt,
    views: pp.views || [], amenities: pp.amenities || [], amenityFlags: flags,
    hoaFee: pp.hoaMonthly, hoaFrequency: 'monthly', taxAnnual: pp.taxAnnual,
    photoUrls: pp.photos || [], heroPhoto: pp.heroPhoto || null,
    ownerClientId: pp.clientId,
  };
}

function yearsSince(d, now) { return d ? (now - new Date(d).getTime()) / (365.25 * DAY) : null; }
function daysUntil(d, now) { return d ? Math.round((new Date(d).getTime() - now) / DAY) : null; }

function triggersFor(pp, ctx, now = Date.now()) {
  const out = [];
  // tenure
  const yrs = yearsSince(pp.purchasedAt, now);
  if (yrs != null && yrs >= 5 && yrs <= 15) {
    out.push({ kind: 'tenure', status: yrs >= 7 && yrs <= 12 ? 'active' : 'watching', label: `Owned ${Math.floor(yrs)} yrs`, at: null });
  }
  // loan events
  const loanType = String(pp.loanType || '').toLowerCase();
  const reset = daysUntil(pp.loanResetAt, now);
  const mature = daysUntil(pp.loanMaturesAt, now);
  const pick = [reset, mature].filter((d) => d != null && d >= -30 && d <= 180).sort((a, b) => a - b)[0];
  if (pick != null) {
    const what = reset === pick ? (loanType === 'interest_only' ? 'Interest-only period ends' : loanType === 'balloon' ? 'Balloon due' : 'ARM resets') : 'Loan matures';
    out.push({ kind: 'loan_event', status: pick <= 60 ? 'active' : 'watching', label: pick <= 0 ? `${what} now` : `${what} in ${pick < 45 ? `${pick}d` : `${Math.round(pick / 30)}mo`}`, at: pick });
  }
  // stated intent
  const signals = Array.isArray(pp.sellSignals) ? pp.sellSignals : [];
  const d = ctx.distilled && ctx.distilled.sellSignals ? ctx.distilled.sellSignals : [];
  const strongest = [...signals, ...d].reduce((m, s) => (Number(s && s.strength) > Number(m && m.strength || 0) ? s : m), null);
  if (pp.thinkingOfSelling) out.push({ kind: 'stated_intent', status: 'active', label: 'Thinking of selling', quote: strongest && strongest.quote, at: null });
  else if (strongest && Number(strongest.strength) >= 0.3) {
    out.push({ kind: 'stated_intent', status: Number(strongest.strength) >= 0.6 ? 'active' : 'watching', label: String(strongest.signal || 'Hinted at selling').slice(0, 48), quote: strongest.quote, at: null });
  }
  // prior listing expired / withdrawn ≤12 months
  const prior = (ctx.priorListings || []).find((l) => ['expired', 'withdrawn'].includes(l.status) && now - new Date(l.updatedAt).getTime() <= 365 * DAY);
  if (prior) out.push({ kind: 'prior_listing', status: 'active', label: `Listing ${prior.status} ${Math.max(1, Math.round((now - new Date(prior.updatedAt).getTime()) / (30 * DAY)))}mo ago`, at: null });
  // second home in the same market ≤18 months
  const other = (ctx.otherOwned || []).find((o) => o.id !== pp.id && o.purchasedAt && now - new Date(o.purchasedAt).getTime() <= 548 * DAY
    && ((o.market && pp.market && V.sameName(o.market, pp.market)) || (o.city && pp.city && V.sameName(o.city, pp.city))));
  if (other) out.push({ kind: 'second_home', status: 'watching', label: 'Bought again nearby', at: null });
  // strongest first: active first, then soonest dated trigger
  out.sort((a, b) => (a.status === b.status ? (a.at ?? 9999) - (b.at ?? 9999) : a.status === 'active' ? -1 : 1));
  return out;
}

const TRIGGER_WORD = { tenure: 'tenure', loan_event: 'loan event', stated_intent: 'stated plans', prior_listing: 'expired listing', second_home: 'second home' };

function narrativeFor(owner, buyer, trigger, place) {
  const o = firstOf(owner);
  const b = buyer.first;
  if (trigger) return `${trigger.label}: ${o}'s ${place || 'home'} fits ${b}'s ${buyer.bucket.toLowerCase()} search${buyer.searchSummary ? ` (${buyer.searchSummary})` : ''}.`.slice(0, 180);
  return `${o}'s ${place || 'home'} fits ${b}'s ${buyer.bucket.toLowerCase()} search. No sell signal yet — worth a soft ask.`.slice(0, 180);
}

async function loadSupply(workspaceId) {
  const props = await prisma.portfolioProperty.findMany({
    where: { workspaceId, relationship: 'owns', client: { archivedAt: null } },
    include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, isWhale: true, lifetimeVolume: true, phone: true, deviceMode: true, preferredChannel: true } } },
    take: 3000,
  });
  const clientIds = [...new Set(props.map((p) => p.clientId))];
  const [links, priorListings] = await Promise.all([
    clientIds.length ? prisma.clientLink.findMany({ where: { workspaceId, OR: [{ clientId: { in: clientIds } }, { relatedClientId: { in: clientIds } }] } }) : [],
    clientIds.length ? prisma.listing.findMany({ where: { workspaceId, ownerClientId: { in: clientIds } }, select: { id: true, ownerClientId: true, status: true, updatedAt: true } }) : [],
  ]);
  const linked = new Map();
  for (const l of links) {
    if (!linked.has(l.clientId)) linked.set(l.clientId, new Set());
    if (!linked.has(l.relatedClientId)) linked.set(l.relatedClientId, new Set());
    linked.get(l.clientId).add(l.relatedClientId);
    linked.get(l.relatedClientId).add(l.clientId);
  }
  const byOwner = new Map();
  for (const p of props) {
    if (!byOwner.has(p.clientId)) byOwner.set(p.clientId, []);
    byOwner.get(p.clientId).push(p);
  }
  return { props, linked, priorListings, byOwner };
}

function placeOf(pp) {
  return pp.buildingName || pp.neighborhood || pp.subdivision || pp.city || null;
}

function propertyLabel(pp) {
  if (pp.nickname) return pp.nickname;
  if (pp.street) return `${pp.street}${pp.unit ? ` #${pp.unit}` : ''}`;
  const t = V.canonicalType(pp.propertyType);
  return `${t ? V.typeLabel(t) : 'Home'}${placeOf(pp) ? ` in ${placeOf(pp)}` : ''}`;
}

// Compute every pair (live). → [{ property, owner, triggers, status, buyers:[rows] }]
async function computePairs(workspaceId, { pool, minScore = PAIR_FLOOR } = {}) {
  const p = pool || await getDemandPool(workspaceId);
  const { props, linked, priorListings, byOwner } = await loadSupply(workspaceId);
  const now = Date.now();
  const out = [];
  for (const pp of props) {
    const subject = propertyAsListing(pp);
    const rows = scoreSubject(subject, p, {
      ownerClientId: pp.clientId, ownerName: clientName(pp.client),
      linkedIds: [...(linked.get(pp.clientId) || [])],
    }).filter((r) => r.result.score >= minScore);
    if (!rows.length) continue;
    const triggers = triggersFor(pp, {
      distilled: distill.peek(workspaceId, pp.clientId),
      priorListings: priorListings.filter((l) => l.ownerClientId === pp.clientId || l.id === pp.listingId),
      otherOwned: byOwner.get(pp.clientId) || [],
    }, now);
    const activeTrigger = triggers.find((t) => t.status === 'active');
    out.push({ property: pp, subject, owner: pp.client, triggers, activeTrigger, rows });
  }
  return out;
}

async function rescoreOffMarket(workspaceId, { pool, notifyHot = false, emit = true } = {}) {
  const pairs = await computePairs(workspaceId, { pool });
  let stored = 0;
  const liveKeys = new Set();
  for (const pr of pairs) {
    const subjectKey = `pp:${pr.property.id}`;
    liveKeys.add(subjectKey);
    const label = `${clientName(pr.owner)}'s ${propertyLabel(pr.property)}`;
    const r = await persistSubject(workspaceId, {
      subjectKey, kind: 'offmarket', propertyId: pr.property.id, label, rows: pr.rows, notifyHot, emit,
      extraFor: (row) => {
        const trig = pr.triggers[0] || null;
        const status = row.result.score >= ACTIVE_FLOOR && pr.activeTrigger ? 'active' : 'watching';
        return {
          narrative: narrativeFor(pr.owner, { first: row.entry.first, bucket: row.entry.bucket, searchSummary: row.entry.summary }, trig, placeOf(pr.property)),
          meta: { ownerClientId: pr.owner.id, ownerName: clientName(pr.owner), pairStatus: status, triggers: pr.triggers },
        };
      },
    });
    stored += r.stored;
  }
  await prisma.match.deleteMany({ where: { workspaceId, kind: 'offmarket', NOT: { subjectKey: { in: [...liveKeys] } }, status: { notIn: ['sent', 'interested', 'toured'] } } });
  return { pairs: pairs.length, stored };
}

// Feed shape for the Off-Market mode: one card per owner ↔ buyer pair.
function pairCards(pairs, { dismissed = new Set(), minScore = ACTIVE_FLOOR } = {}) {
  const cards = [];
  for (const pr of pairs) {
    for (const row of pr.rows) {
      if (row.result.score < minScore) continue;
      if (dismissed.has(`pp:${pr.property.id}|${row.entry.clientId}`)) continue;
      const status = row.result.score >= ACTIVE_FLOOR && pr.activeTrigger ? 'active' : 'watching';
      const trig = pr.triggers[0] || null;
      cards.push({
        id: `pp:${pr.property.id}|${row.entry.clientId}`,
        status,
        score: row.result.score,
        narrative: narrativeFor(pr.owner, { first: row.entry.first, bucket: row.entry.bucket, searchSummary: row.entry.summary }, trig, placeOf(pr.property)),
        owner: {
          clientId: pr.owner.id, name: clientName(pr.owner), first: firstOf(pr.owner), avatarUrl: pr.owner.avatarUrl || null,
          whale: !!pr.owner.isWhale || (pr.owner.lifetimeVolume || 0) >= 10e6,
        },
        property: {
          id: pr.property.id, label: propertyLabel(pr.property), place: placeOf(pr.property),
          photo: pr.property.heroPhoto || (pr.property.photos || [])[0] || null,
          estValue: pr.property.estValue || pr.property.purchasePrice || null,
          beds: pr.property.beds, baths: pr.property.baths, sqft: pr.property.sqft,
          waterfront: V.canonicalWaterfront(pr.property.waterfront), propertyType: V.canonicalType(pr.property.propertyType),
          neighborhood: pr.property.neighborhood, city: pr.property.city,
          purchasedAt: pr.property.purchasedAt,
        },
        triggers: pr.triggers,
        buyer: buyerRow(row),
      });
    }
  }
  cards.sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === 'active' ? -1 : 1));
  return cards;
}

module.exports = { propertyAsListing, triggersFor, computePairs, rescoreOffMarket, pairCards, propertyLabel, placeOf, TRIGGER_WORD, PAIR_FLOOR, ACTIVE_FLOOR };

// Deal transition service — the ONE writer for deals. Every path (REST routes,
// Serena tools, importers, the client card) goes through these exports so
// side effects can never drift between entry points.
//
//   const deals = require('../services/pipeline/deals');
//   await deals.createDeal({ workspaceId, clientId, side: 'buyer', stage: 'touring', price: 4250000, listingId });
//   await deals.updateDeal(dealId, { closingDate: '2026-11-14', contractPrice: 4100000 }, { workspaceId });
//   await deals.moveDeal(dealId, 'under_contract', { workspaceId });
//   await deals.moveDeal(dealId, 'closed', { workspaceId, closedAt: '2026-10-02', commission: 61200 });
//   await deals.closeDeal(dealId, { workspaceId, commission: 61200 });       // close, or re-book a closed one
//   await deals.reopenDeal(dealId, { workspaceId });                        // Closed/Lost → back on the board
//   await deals.markLost(dealId, { workspaceId, reason: 'Bought with another agent', note });
//   await deals.deleteDeal(dealId, { workspaceId });
//   await deals.listDeals({ workspaceId, clientId, open: true });          // → { deals, total } (normalized)
//   await deals.getDeal(dealId, { workspaceId })                            // → normalized deal
// Every mutator resolves to the NORMALIZED deal (normalize.js) and has already
// broadcast deal_created / deal_updated / deal_deleted to the workspace.
//
// Rules (RevMatch port notes §10):
//  • Side effects are transition-only — gated on an actual stage change.
//  • Only Closed books money: stamps closedAt (also when created directly at
//    Closed), locks salePrice, rolls up client lifetimeVolume / lifetimeGci /
//    transactionsCount / lastClosedAt, closes the portfolio loop (buyer → owns,
//    seller → sold), marks the listing sold, notifies and logs deal_closed.
//  • Close-out is idempotent (closeProcessedAt + extras.closeApplied records
//    exactly what was applied) and is reversed precisely when a deal leaves
//    Closed or is deleted — no double counting on re-entry.
//  • Booked `commission` (net received) is typed by the agent and never re-split.
//  • Closed deals dated before the current month (workspace tz) are archived
//    off the board immediately; the rollover job handles month turns.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { logActivity } = require('../../lib/activity');
const { notify } = require('../../lib/notify');
const { zonedTime, monthBounds } = require('../../lib/dates');
const S = require('./stages');
const C = require('./commission');
const { pricingContext } = require('./plan');
const N = require('./normalize');

const TX_OPTS = { timeout: 20000, maxWait: 10000 };

// ── input coercion ─────────────────────────────────────────────────────────
const MONEY_FIELDS = ['price', 'listPrice', 'contractPrice', 'salePrice', 'commissionFlat', 'coopBonus', 'monthlyRent', 'grossCommission', 'commission'];
const RATE_FIELDS = ['sideRate', 'listRate', 'buyRate', 'referralOutPct'];
const DATE_FIELDS = ['contractDate', 'closingDate', 'inspectionDeadline', 'appraisalDeadline', 'financingDeadline', 'finishSelectionDue', 'estCompletion', 'closedAt'];
const STRING_FIELDS = ['title', 'subStatus', 'propertyAddress', 'propertyLabel', 'lenderName', 'titleCompany', 'coAgentName', 'coAgentBrokerage', 'leadSource', 'lostReason', 'lostNote', 'notes'];
const ID_FIELDS = ['listingId', 'portfolioPropertyId', 'linkedDealId'];
const MERGE_JSON = ['contingencies', 'depositSchedule'];

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).trim().replace(/[$,\s]/g, '');
  const m = /^(-?\d*\.?\d+)([kmb])?$/i.exec(s);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}
function parseRate(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace('%', ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n; // 2.5 → 0.025; rates over 100% can't exist
}
function parseShare(v) {
  if (v == null || v === '') return 1;
  let n = parseFloat(String(v).replace('%', ''));
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n > 1) n /= 100;
  return Math.min(1, Math.max(0.01, n));
}
function parseDate(v, tz) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return zonedTime(s, 12, 0, tz); // date-only → noon local, never shifts a day
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Whitelist + coerce. Only keys present in `input` appear in the result.
function sanitize(input, tz) {
  const data = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  for (const k of MONEY_FIELDS) if (has(k)) data[k] = parseMoney(input[k]);
  for (const k of RATE_FIELDS) if (has(k)) data[k] = parseRate(input[k]);
  if (has('splitShare')) data.splitShare = parseShare(input.splitShare);
  if (has('position')) data.position = Number(input.position) || 0;
  for (const k of DATE_FIELDS) {
    if (!has(k)) continue;
    const d = parseDate(input[k], tz);
    if (d === undefined) throw new HttpError(400, `${k}: not a valid date`);
    data[k] = d;
  }
  for (const k of STRING_FIELDS) if (has(k)) data[k] = input[k] == null ? null : String(input[k]).slice(0, 2000);
  for (const k of ID_FIELDS) if (has(k)) data[k] = input[k] || null;
  if (has('inventoryType')) data.inventoryType = S.INVENTORY_IDS.includes(input.inventoryType) ? input.inventoryType : 'resale';
  if (has('shortlist')) {
    const list = Array.isArray(input.shortlist) ? input.shortlist : [];
    data.shortlist = list.slice(0, 30).map((x) => ({
      key: String(x.key || x.listingId || x.portfolioPropertyId || x.label || Math.random().toString(36).slice(2)),
      listingId: x.listingId || null,
      portfolioPropertyId: x.portfolioPropertyId || null,
      label: x.label ? String(x.label).slice(0, 200) : null,
      address: x.address ? String(x.address).slice(0, 200) : null,
      price: parseMoney(x.price),
      photo: x.photo || null,
      mlsNumber: x.mlsNumber || null,
    }));
  }
  return data;
}

function mergeJson(prev, patch) {
  const out = { ...obj(prev) };
  for (const [k, v] of Object.entries(obj(patch))) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function clientDisplayName(c) {
  return N.clientName(c);
}

// ── rollups (client lifetime numbers) ─────────────────────────────────────
function rollupWant(deal, px) {
  if (!deal || deal.stage !== 'closed') return { volume: 0, gci: 0, tx: 0 };
  const est = C.estimate(deal, px.plan, px.ytd);
  return {
    volume: deal.side === 'referral_out' || C.isLease(deal.side) ? 0 : Math.round(C.dealPrice(deal)),
    gci: est.myGci,
    tx: 1,
  };
}

const maxDate = (...ds) => ds.filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;

// Apply the difference between what this deal SHOULD contribute (given its
// current state) and what it already contributed (`prevApplied`).
async function syncRollups(tx, deal, px, prevApplied) {
  const want = rollupWant(deal, px);
  const prev = prevApplied || { volume: 0, gci: 0, tx: 0 };
  const client = await tx.client.findUnique({ where: { id: deal.clientId } });
  if (!client) return { applied: null, client: null };
  const prevLastClosedAt = prev.prevLastClosedAt !== undefined ? prev.prevLastClosedAt : (client.lastClosedAt ? client.lastClosedAt.toISOString() : null);
  const data = {};
  const dv = want.volume - (prev.volume || 0);
  const dg = want.gci - (prev.gci || 0);
  const dt = want.tx - (prev.tx || 0);
  if (dv) data.lifetimeVolume = Math.max(0, (client.lifetimeVolume || 0) + dv);
  if (dg) data.lifetimeGci = Math.max(0, (client.lifetimeGci || 0) + dg);
  if (dt) data.transactionsCount = Math.max(0, (client.transactionsCount || 0) + dt);
  const agg = await tx.deal.aggregate({
    where: { clientId: deal.clientId, stage: 'closed', ...(deal.stage !== 'closed' ? { id: { not: deal.id } } : {}) },
    _max: { closedAt: true },
  });
  const last = maxDate(agg._max.closedAt, prevLastClosedAt);
  if (String(last && last.toISOString()) !== String(client.lastClosedAt && client.lastClosedAt.toISOString())) data.lastClosedAt = last;
  let updated = null;
  if (Object.keys(data).length) updated = await tx.client.update({ where: { id: client.id }, data });
  const applied = deal.stage === 'closed' ? { ...want, prevLastClosedAt } : null;
  return { applied, client: updated };
}

// ── portfolio close-the-loop ──────────────────────────────────────────────
function propertyFieldsFromListing(l) {
  if (!l) return {};
  return {
    listingId: l.id,
    street: l.street || null,
    unit: l.unitNumber || null,
    city: l.city || null,
    state: l.state || null,
    zip: l.postalCode || null,
    neighborhood: l.neighborhood || null,
    buildingName: l.buildingName || null,
    market: l.market || null,
    mlsNumber: l.mlsNumber || null,
    parcelNumber: l.parcelNumber || null,
    propertyType: l.propertyType || null,
    beds: l.beds ?? null,
    baths: l.bathsTotal ?? null,
    sqft: l.livingAreaSqft ?? null,
    lotSqft: l.lotSqft ?? null,
    lotAcres: l.lotAcres ?? null,
    yearBuilt: l.yearBuilt ?? null,
    heroPhoto: l.heroPhoto || (l.photoUrls || [])[0] || null,
    photos: (l.photoUrls || []).slice(0, 12),
    views: l.views || [],
    amenities: l.amenities || [],
    waterfront: l.waterfront || null,
  };
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? null : o[k]]));

async function loopBuyer(tx, deal, clientId, rel, listing, price) {
  const where = { workspaceId: deal.workspaceId, clientId };
  let prop = null;
  if (deal.portfolioPropertyId && clientId === deal.clientId) {
    prop = await tx.portfolioProperty.findFirst({ where: { ...where, id: deal.portfolioPropertyId } });
  }
  if (!prop) prop = await tx.portfolioProperty.findFirst({ where: { ...where, purchasedDealId: deal.id } });
  if (!prop && deal.listingId) prop = await tx.portfolioProperty.findFirst({ where: { ...where, listingId: deal.listingId } });
  const fields = rel === 'rents'
    ? { relationship: 'rents', rentAmount: deal.monthlyRent ?? null, purchasedDealId: deal.id }
    : { relationship: 'owns', purchasePrice: price || null, purchasedAt: deal.closedAt, purchasedDealId: deal.id, boughtWithMe: true, thinkingOfSelling: false };
  if (prop) {
    const prev = pick(prop, Object.keys(fields));
    const fill = {};
    const lf = propertyFieldsFromListing(listing);
    for (const [k, v] of Object.entries(lf)) {
      const cur = prop[k];
      if ((cur == null || (Array.isArray(cur) && !cur.length)) && v != null && !(Array.isArray(v) && !v.length)) fill[k] = v;
    }
    await tx.portfolioProperty.update({ where: { id: prop.id }, data: { ...fill, ...fields } });
    return { propertyId: prop.id, clientId, created: false, prev };
  }
  if (!listing && !deal.propertyAddress) return null;
  const created = await tx.portfolioProperty.create({
    data: {
      workspaceId: deal.workspaceId,
      clientId,
      source: 'pipeline',
      occupancy: rel === 'rents' ? 'rental' : 'primary',
      ...propertyFieldsFromListing(listing),
      ...(listing ? {} : { street: deal.propertyAddress, nickname: deal.propertyLabel || null }),
      ...fields,
    },
  });
  return { propertyId: created.id, clientId, created: true };
}

async function loopSeller(tx, deal, rel, listing, price) {
  const where = { workspaceId: deal.workspaceId, clientId: deal.clientId };
  let prop = null;
  if (deal.portfolioPropertyId) prop = await tx.portfolioProperty.findFirst({ where: { workspaceId: deal.workspaceId, id: deal.portfolioPropertyId } });
  if (!prop && deal.listingId) prop = await tx.portfolioProperty.findFirst({ where: { ...where, listingId: deal.listingId } });
  const street = (listing && listing.street) || deal.propertyAddress;
  if (!prop && street) prop = await tx.portfolioProperty.findFirst({ where: { ...where, street: { equals: street, mode: 'insensitive' } } });
  const fields = rel === 'leased_out'
    ? { relationship: 'leased_out', rentAmount: deal.monthlyRent ?? null }
    : { relationship: 'sold', soldPrice: price || null, soldAt: deal.closedAt, soldWithMe: true, thinkingOfSelling: false };
  if (prop) {
    const prev = pick(prop, Object.keys(fields));
    await tx.portfolioProperty.update({ where: { id: prop.id }, data: fields });
    return { propertyId: prop.id, clientId: prop.clientId, created: false, prev };
  }
  if (!listing && !deal.propertyAddress) return null;
  const created = await tx.portfolioProperty.create({
    data: {
      workspaceId: deal.workspaceId,
      clientId: deal.clientId,
      source: 'pipeline',
      ...propertyFieldsFromListing(listing),
      ...(listing ? {} : { street: deal.propertyAddress, nickname: deal.propertyLabel || null }),
      ...fields,
    },
  });
  return { propertyId: created.id, clientId: deal.clientId, created: true };
}

async function portfolioClose(tx, deal, listing, price) {
  const side = deal.side;
  const ex = obj(deal.extras);
  const recs = [];
  if (side === 'buyer' || side === 'referral_in') recs.push(await loopBuyer(tx, deal, deal.clientId, 'owns', listing, price));
  if (side === 'lease_tenant') recs.push(await loopBuyer(tx, deal, deal.clientId, 'rents', listing, price));
  if (side === 'listing' || side === 'dual') recs.push(await loopSeller(tx, deal, 'sold', listing, price));
  if (side === 'lease_landlord') recs.push(await loopSeller(tx, deal, 'leased_out', listing, price));
  if (side === 'dual' && ex.buyerClientId) {
    const other = await tx.client.findFirst({ where: { id: ex.buyerClientId, workspaceId: deal.workspaceId }, select: { id: true } });
    if (other) recs.push(await loopBuyer(tx, deal, other.id, 'owns', listing, price));
  }
  return recs.filter(Boolean);
}

async function portfolioUndo(tx, recs) {
  for (const r of recs || []) {
    try {
      if (r.created) await tx.portfolioProperty.deleteMany({ where: { id: r.propertyId } });
      else if (r.prev) await tx.portfolioProperty.updateMany({ where: { id: r.propertyId }, data: r.prev });
    } catch (err) {
      console.error('[pipeline] portfolio undo failed', r.propertyId, err.message);
    }
  }
}

async function listingClose(tx, deal, listing, price) {
  if (!listing || C.isLease(deal.side) || deal.side === 'referral_out') return null;
  if (listing.status === 'sold' && listing.closePrice) return null;
  const prev = { status: listing.status, closePrice: listing.closePrice ?? null, soldAt: listing.soldAt ?? null };
  await tx.listing.update({ where: { id: listing.id }, data: { status: 'sold', closePrice: price || listing.closePrice || null, soldAt: deal.closedAt } });
  return { listingId: listing.id, prev };
}

async function listingUndo(tx, rec) {
  if (!rec || !rec.listingId) return null;
  try {
    await tx.listing.updateMany({ where: { id: rec.listingId }, data: rec.prev });
    return rec.listingId;
  } catch (err) {
    console.error('[pipeline] listing undo failed', rec.listingId, err.message);
    return null;
  }
}

function archivedAtFor(deal, tz, now = new Date()) {
  if (deal.stage !== 'closed' || !deal.closedAt) return null;
  const { start } = monthBounds(now, tz);
  return new Date(deal.closedAt) < start ? (deal.archivedAt || now) : null;
}

// First close (or re-close after a reopen): everything money-related.
async function closeOut(tx, deal, px, effects) {
  const now = new Date();
  const listing = deal.listingId ? await tx.listing.findFirst({ where: { id: deal.listingId, workspaceId: deal.workspaceId } }) : null;
  const salePrice = deal.salePrice || deal.contractPrice || deal.price || deal.listPrice || (listing && listing.listPrice) || null;
  const locked = { ...deal, salePrice };
  // A stale record (deal reopened outside this service) counts as already applied.
  const stale = obj(deal.extras).closeApplied || null;
  const roll = await syncRollups(tx, locked, px, stale);
  const portfolio = await portfolioClose(tx, locked, listing, salePrice);
  const lst = await listingClose(tx, locked, listing, salePrice);
  const ex = obj(deal.extras);
  const updated = await tx.deal.update({
    where: { id: deal.id },
    data: {
      salePrice,
      closeProcessedAt: now,
      archivedAt: archivedAtFor(locked, px.tz, now),
      extras: { ...ex, closeApplied: { ...(roll.applied || {}), portfolio, listing: lst, at: now.toISOString() } },
    },
  });
  if (roll.client) effects.clients.set(roll.client.id, roll.client);
  if (lst) effects.listings.add(lst.listingId);
  if (portfolio.length) effects.portfolioClients.push(...portfolio.map((p) => p.clientId));
  return updated;
}

// Leaving Closed (reopen / delete): reverse exactly what close-out applied.
async function undoClose(tx, deal, px, effects, before) {
  let ex = obj(deal.extras);
  let ca = ex.closeApplied;
  if (!ca && before && before.stage === 'closed') {
    // A closed deal that predates close-out tracking (seeded/imported):
    // assume the client's rollups already include it, then reverse that.
    const w = rollupWant(before, px);
    ca = { ...w, portfolio: [], listing: null };
  }
  if (ca) {
    const roll = await syncRollups(tx, { ...deal, stage: deal.stage === 'closed' ? 'reopening' : deal.stage }, px, ca);
    if (roll.client) effects.clients.set(roll.client.id, roll.client);
    await portfolioUndo(tx, ca.portfolio);
    if (ca.portfolio && ca.portfolio.length) effects.portfolioClients.push(...ca.portfolio.map((p) => p.clientId));
    const lid = await listingUndo(tx, ca.listing);
    if (lid) effects.listings.add(lid);
  }
  ex = { ...ex };
  delete ex.closeApplied;
  return tx.deal.update({
    where: { id: deal.id },
    data: { closeProcessedAt: null, closedAt: null, archivedAt: null, extras: ex },
  });
}

// A closed deal was edited (price, commission, split, closing date…): re-sync
// the rollup delta and the archive flag without re-running close-out.
async function resyncClosed(tx, deal, px, effects, before) {
  let ex = obj(deal.extras);
  let ca = ex.closeApplied;
  if (!ca) {
    // adopt a legacy closed deal using its pre-edit state
    const w = rollupWant(before || deal, px);
    ca = { ...w, portfolio: [], listing: null, adopted: true };
  }
  const roll = await syncRollups(tx, deal, px, ca);
  if (roll.client) effects.clients.set(roll.client.id, roll.client);
  ex = { ...ex, closeApplied: { ...ca, ...(roll.applied || {}) } };
  return tx.deal.update({
    where: { id: deal.id },
    data: {
      extras: ex,
      archivedAt: archivedAtFor(deal, px.tz),
      closeProcessedAt: deal.closeProcessedAt || deal.closedAt || new Date(),
    },
  });
}

function defaultSubStatus(stage, side, listing) {
  const phase = S.phaseOf(stage);
  if (phase === 'active' && S.familyOf(side) === 'listing') {
    const st = listing && listing.status;
    if (st === 'coming_soon') return 'coming_soon';
    if (st === 'active') return 'active';
    return 'pre_market';
  }
  return null;
}

// Stored estimates (cheap for other builders to query). `probability` is the
// agent's own call when set; otherwise the stage odds fill it in.
function estimateColumns(deal, px) {
  const est = C.estimate(deal, px.plan, px.ytd);
  const out = {
    estimatedGci: est.myGci || null,
    estimatedNet: est.estimatedNet != null ? est.estimatedNet : (est.net || null),
  };
  if (deal.probability == null) out.probability = S.odds(deal.stage);
  return out;
}

const newEffects = () => ({ clients: new Map(), listings: new Set(), portfolioClients: [] });

// ── post-commit: timeline, notifications, realtime ────────────────────────
async function afterWrite(workspaceId, r, { actor = 'agent', created = false } = {}) {
  const n = await N.normalizeOne(workspaceId, r.deal);
  const where = n.address ? ` · ${n.address}` : '';
  const priceTxt = n.price ? ` · ${compactMoney(n.price)}` : '';
  const meta = { dealId: n.id, side: n.side, from: r.before ? r.before.stage : null, to: n.stage, price: n.price || null };
  const jobs = [];
  if (created) {
    jobs.push(logActivity({
      workspaceId, clientId: n.clientId, dealId: n.id, type: 'deal_created', actor,
      title: `New ${n.sideLabel.toLowerCase()} deal — ${n.label}`,
      body: `${n.address || 'Property to be set'}${priceTxt}`, meta,
    }));
  }
  if (r.closing) {
    const verb = S.familyOf(n.side) === 'listing' ? 'Sold' : 'Closed';
    const net = n.commission != null ? n.commission : n.estimates.net;
    jobs.push(logActivity({
      workspaceId, clientId: n.clientId, dealId: n.id, type: 'deal_closed', actor,
      title: `${verb}${where || ' — deal closed'}`,
      body: [n.price ? compactMoney(n.price) : null, net ? `net ${compactMoney(net)}${n.commission != null ? '' : ' est.'}` : null].filter(Boolean).join(' · ') || null,
      meta: { ...meta, net, booked: n.commission != null },
    }));
    jobs.push(notify({
      workspaceId,
      type: 'deal',
      title: `${verb}! ${n.name}`,
      body: `${n.address || 'Deal closed'}${priceTxt}`,
      data: { kind: 'deal_closed', dealId: n.id, clientId: n.clientId },
    }));
  } else if (r.changed && !created) {
    const title = n.stage === 'lost'
      ? 'Deal marked lost'
      : r.before && r.before.stage === 'closed'
        ? `Reopened — back to ${n.label}`
        : `Moved to ${n.label}`;
    jobs.push(logActivity({
      workspaceId, clientId: n.clientId, dealId: n.id, type: 'deal_stage_change', actor,
      title,
      body: n.stage === 'lost' ? (n.lostReason || null) : (n.address || null),
      meta,
    }));
  }
  await Promise.all(jobs);
  hub.broadcast(workspaceId, created ? 'deal_created' : 'deal_updated', n);
  await broadcastEffects(workspaceId, r.effects);
  return n;
}

async function broadcastEffects(workspaceId, effects) {
  if (!effects) return;
  for (const c of effects.clients.values()) hub.broadcast(workspaceId, 'client_updated', c);
  if (effects.listings.size) {
    const rows = await prisma.listing.findMany({ where: { workspaceId, id: { in: [...effects.listings] } } }).catch(() => []);
    for (const l of rows) hub.broadcast(workspaceId, 'listing_updated', l);
  }
}

function compactMoney(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const trim = (x, d) => { const s = x.toFixed(d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
  if (a >= 1e6) return `$${trim(v / 1e6, 2)}M`;
  if (a >= 1e4) return `$${trim(v / 1e3, 0)}K`;
  if (a >= 1e3) return `$${trim(v / 1e3, 1)}K`;
  return `$${Math.round(v)}`;
}

// ── validation helpers ─────────────────────────────────────────────────────
async function assertRefs(db, workspaceId, data) {
  if (data.clientId) {
    const c = await db.client.findFirst({ where: { id: data.clientId, workspaceId }, select: { id: true } });
    if (!c) throw new HttpError(404, 'Client not found');
  }
  let listing = null;
  if (data.listingId) {
    listing = await db.listing.findFirst({ where: { id: data.listingId, workspaceId } });
    if (!listing) throw new HttpError(400, 'Listing not found');
  }
  let property = null;
  if (data.portfolioPropertyId) {
    property = await db.portfolioProperty.findFirst({ where: { id: data.portfolioPropertyId, workspaceId } });
    if (!property) throw new HttpError(400, 'Portfolio property not found');
  }
  if (data.linkedDealId) {
    const d = await db.deal.findFirst({ where: { id: data.linkedDealId, workspaceId }, select: { id: true } });
    if (!d) throw new HttpError(400, 'Linked deal not found');
  }
  return { listing, property };
}

function assertClosedAt(data, now = new Date()) {
  if (data.closedAt && data.closedAt.getTime() > now.getTime() + 2 * 86400000) {
    throw new HttpError(400, "Closing date can't be in the future");
  }
}

// ── public API ─────────────────────────────────────────────────────────────

// createDeal({ workspaceId, clientId, side, stage, track, price, listingId, … , actor })
// (also accepts createDeal(fields, { workspaceId, actor }))
async function createDeal(a, b) {
  const input = { ...(a || {}), ...(b || {}) };
  const { workspaceId, actor = 'agent' } = input;
  if (!workspaceId) throw new HttpError(400, 'workspaceId required');
  if (!input.clientId) throw new HttpError(400, 'clientId is required');
  const px = await pricingContext(workspaceId);
  const now = new Date();
  const side = S.SIDE_IDS.includes(input.side) ? input.side : 'buyer';
  const data = sanitize(input, px.tz);
  assertClosedAt(data, now);
  let track = input.track === 'new_dev' ? 'new_dev' : 'main';
  let stage;
  let subStatus = data.subStatus ?? null;
  if (input.stage) {
    const c = S.canonicalize(input.stage, side);
    if (!c) throw new HttpError(400, `Unknown stage "${input.stage}"`);
    stage = c.stage;
    if (c.subStatus && !subStatus) subStatus = c.subStatus;
  } else {
    stage = track === 'new_dev' ? S.NEW_DEV_KEYS[0] : S.stageForPhase('engaged', side);
  }
  if (S.isNewDevStage(stage)) track = 'new_dev';
  else if (stage !== 'lost') track = 'main';
  const refs = await assertRefs(prisma, workspaceId, { clientId: input.clientId, ...data });

  // Prefill from the linked listing / portfolio property.
  const fam = S.familyOf(side);
  if (refs.listing && refs.listing.listPrice) {
    if (fam === 'listing' && data.listPrice == null) data.listPrice = refs.listing.listPrice;
    if (fam === 'buyer' && data.price == null && !C.isLease(side)) data.price = refs.listing.listPrice;
  }
  if (refs.property && fam === 'listing' && data.listPrice == null && refs.property.estValue) data.listPrice = refs.property.estValue;
  if (!subStatus) subStatus = defaultSubStatus(stage, side, refs.listing);
  const inventoryType = data.inventoryType
    || (track === 'new_dev' ? 'pre_construction' : refs.listing && refs.listing.origin === 'development' ? 'new_construction' : 'resale');
  const extras = mergeJson({}, input.extras);

  const result = await prisma.$transaction(async (tx) => {
    const effects = newEffects();
    let deal = await tx.deal.create({
      data: {
        ...data,
        workspaceId,
        clientId: input.clientId,
        side,
        track,
        stage,
        subStatus,
        inventoryType,
        contingencies: input.contingencies ? obj(input.contingencies) : undefined,
        depositSchedule: Array.isArray(input.depositSchedule) ? input.depositSchedule : input.depositSchedule ? obj(input.depositSchedule) : undefined,
        extras,
        stageChangedAt: now,
        closedAt: stage === 'closed' ? (data.closedAt || now) : null,
        lostAt: stage === 'lost' ? now : null,
      },
    });
    await tx.dealEvent.create({ data: { workspaceId, dealId: deal.id, type: 'created', toStage: stage, meta: { side, price: C.dealPrice(deal) || null, actor } } });
    let closing = false;
    if (stage === 'closed') {
      closing = true;
      deal = await closeOut(tx, deal, px, effects);
      await tx.dealEvent.create({ data: { workspaceId, dealId: deal.id, type: 'closed', toStage: 'closed', meta: { price: deal.salePrice, commission: deal.commission ?? null } } });
    }
    deal = await tx.deal.update({ where: { id: deal.id }, data: estimateColumns(deal, px) });
    return { before: null, deal, changed: true, closing, reopening: false, effects };
  }, TX_OPTS);
  return afterWrite(workspaceId, result, { actor, created: true });
}

// The shared write path for updateDeal / moveDeal / closeDeal / reopenDeal / markLost.
async function writeDeal(dealId, patch, opts = {}) {
  const { workspaceId, actor = 'agent' } = opts;
  if (!workspaceId) throw new HttpError(400, 'workspaceId required');
  const px = await pricingContext(workspaceId);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.deal.findFirst({ where: { id: dealId, workspaceId } });
    if (!before) throw new HttpError(404, 'Deal not found');
    const effects = newEffects();
    const data = sanitize(patch, px.tz);
    assertClosedAt(data, now);
    if (patch.clientId && patch.clientId !== before.clientId) data.clientId = patch.clientId;
    const refs = await assertRefs(tx, workspaceId, { clientId: data.clientId, listingId: data.listingId, portfolioPropertyId: data.portfolioPropertyId, linkedDealId: data.linkedDealId });
    if (data.clientId === undefined) delete data.clientId;

    // side + stage + track resolution
    let side = before.side;
    if (patch.side && S.SIDE_IDS.includes(patch.side) && patch.side !== before.side) { side = patch.side; data.side = side; }
    let stage = before.stage;
    let track = before.track || 'main';
    if (patch.stage != null && patch.stage !== '') {
      const c = S.canonicalize(patch.stage, side);
      if (!c) throw new HttpError(400, `Unknown stage "${patch.stage}"`);
      stage = c.stage;
      if (c.subStatus && data.subStatus === undefined) data.subStatus = c.subStatus;
    } else if (side !== before.side) {
      stage = S.translateStage(before.stage, side);
    }
    if (patch.track === 'new_dev' && !S.isNewDevStage(stage) && stage !== 'lost' && patch.stage == null) stage = S.NEW_DEV_KEYS[0];
    if (patch.track === 'main' && S.isNewDevStage(stage) && patch.stage == null) stage = S.stageForPhase('under_contract', side);
    if (S.isNewDevStage(stage)) track = 'new_dev';
    else if (stage !== 'lost') track = 'main';
    if (track !== before.track) data.track = track;

    const changed = stage !== before.stage;
    const closing = changed && stage === 'closed';
    const reopening = changed && before.stage === 'closed';
    if (changed) {
      data.stage = stage;
      data.stageChangedAt = now;
      if (data.subStatus === undefined) {
        const listing = refs.listing || (before.listingId ? await tx.listing.findFirst({ where: { id: before.listingId, workspaceId } }) : null);
        data.subStatus = defaultSubStatus(stage, side, listing);
      }
      if (stage === 'lost') data.lostAt = now;
      else if (before.stage === 'lost') data.lostAt = null;
      if (closing && !data.closedAt) data.closedAt = now;
    }
    if (!changed && data.closedAt !== undefined && before.stage !== 'closed') delete data.closedAt; // closedAt only means something on Closed
    if (data.closedAt === null && before.stage === 'closed' && !changed) delete data.closedAt; // can't un-date a closed deal

    // A closing date moved by hand: remember where it was first filed.
    if (!changed && before.stage === 'closed' && data.closedAt && before.closedAt && data.closedAt.getTime() !== before.closedAt.getTime()) {
      const ex0 = obj(before.extras);
      data.extras = { ...ex0, closedAtOriginal: ex0.closedAtOriginal || before.closedAt.toISOString(), closedAtMovedAt: now.toISOString() };
    }
    if (patch.extras !== undefined) data.extras = mergeJson(data.extras || before.extras, patch.extras);
    for (const k of MERGE_JSON) {
      if (patch[k] === undefined) continue;
      // arrays (e.g. a dated deposit schedule) replace wholesale; objects merge
      data[k] = Array.isArray(patch[k]) ? patch[k] : patch[k] === null ? null : mergeJson(Array.isArray(before[k]) ? {} : before[k], patch[k]);
    }
    if (data.listingId && data.listingId !== before.listingId && patch.propertyAddress === undefined) data.propertyAddress = null;
    // Prefill the price from a newly linked listing when the deal has none.
    if (refs.listing && refs.listing.listPrice && data.listingId !== before.listingId) {
      const fam = S.familyOf(side);
      if (fam === 'listing' && before.listPrice == null && data.listPrice === undefined) data.listPrice = refs.listing.listPrice;
      if (fam === 'buyer' && before.price == null && data.price === undefined && !C.isLease(side)) data.price = refs.listing.listPrice;
    }

    let deal = await tx.deal.update({ where: { id: dealId }, data });

    if (reopening || (deal.stage !== 'closed' && obj(deal.extras).closeApplied)) {
      deal = await undoClose(tx, deal, px, effects, before.stage === 'closed' ? before : null);
    }
    if (closing) deal = await closeOut(tx, deal, px, effects);
    else if (!changed && deal.stage === 'closed') {
      const touches = ['salePrice', 'contractPrice', 'price', 'listPrice', 'commission', 'grossCommission', 'splitShare', 'sideRate', 'listRate', 'buyRate', 'commissionFlat', 'referralOutPct', 'coopBonus', 'monthlyRent', 'closedAt', 'side', 'clientId']
        .some((k) => data[k] !== undefined);
      if (touches || !deal.closeProcessedAt) deal = await resyncClosed(tx, deal, px, effects, before);
    }

    if (changed) {
      const type = closing ? 'closed' : stage === 'lost' ? 'lost' : (reopening || before.stage === 'lost') ? 'reopened' : 'stage';
      await tx.dealEvent.create({
        data: {
          workspaceId, dealId, type, fromStage: before.stage, toStage: stage,
          meta: { actor, ...(stage === 'lost' ? { reason: deal.lostReason || null } : {}), ...(closing ? { price: deal.salePrice, commission: deal.commission ?? null } : {}) },
        },
      });
    }
    if (data.commission !== undefined && data.commission !== before.commission) {
      await tx.dealEvent.create({ data: { workspaceId, dealId, type: 'commission', meta: { from: before.commission ?? null, to: data.commission ?? null, actor } } });
    }
    const fieldKeys = Object.keys(data).filter((k) => !['stage', 'stageChangedAt', 'track', 'subStatus', 'lostAt', 'closedAt', 'commission', 'extras'].includes(k));
    if (!changed && fieldKeys.length) {
      await tx.dealEvent.create({ data: { workspaceId, dealId, type: 'field', meta: { fields: fieldKeys.slice(0, 20), actor } } });
    }

    // Client fields edited from the deal card (rating / whale) — optional.
    if (patch.client && typeof patch.client === 'object') {
      const cd = {};
      if (patch.client.rating !== undefined) cd.rating = Math.max(0, Math.min(5, parseInt(patch.client.rating, 10) || 0));
      if (patch.client.isWhale !== undefined) cd.isWhale = !!patch.client.isWhale;
      if (Object.keys(cd).length) {
        const c = await tx.client.update({ where: { id: deal.clientId }, data: cd });
        effects.clients.set(c.id, c);
      }
    }

    deal = await tx.deal.update({ where: { id: dealId }, data: estimateColumns(deal, px) });
    return { before, deal, changed, closing, reopening, effects };
  }, TX_OPTS);
  return afterWrite(workspaceId, result, { actor });
}

// All mutators accept positional (dealId, …, { workspaceId, actor }) OR one
// object ({ workspaceId, dealId, …, source|actor }) — Serena calls the latter.
const ACTOR_OF = { serena: 'ai', ai: 'ai', agent: 'agent', system: 'system', client: 'client' };
function unpack(a, b, c) {
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const { dealId, id, ...rest } = a;
    return { dealId: dealId || id, x: undefined, opts: rest };
  }
  return { dealId: a, x: b, opts: c || {} };
}
const actorOf = (o) => ACTOR_OF[o.actor] || ACTOR_OF[o.source] || o.actor || 'agent';
const MOVE_OPTS = ['closedAt', 'commission', 'grossCommission', 'lostReason', 'lostNote', 'track', 'subStatus'];

// updateDeal(dealId, patch, { workspaceId, actor }) — any field patch; a
// `stage` in the patch runs the same transition as moveDeal.
//   or updateDeal({ workspaceId, dealId, patch }) / updateDeal({ workspaceId, dealId, ...fields })
async function updateDeal(a, b, c) {
  const { dealId, x, opts } = unpack(a, b, c);
  let patch = x;
  if (patch === undefined) {
    if (opts.patch && typeof opts.patch === 'object') patch = opts.patch;
    else {
      const { workspaceId, userId, actor, source, ...fields } = opts;
      patch = fields;
    }
  }
  return writeDeal(dealId, patch || {}, { workspaceId: opts.workspaceId, actor: actorOf(opts) });
}

// moveDeal(dealId, stage, { workspaceId, closedAt, commission, grossCommission, lostReason, lostNote, track, actor })
//   or moveDeal({ workspaceId, dealId, stage, subStatus, … , source })
async function moveDeal(a, b, c) {
  const { dealId, x, opts } = unpack(a, b, c);
  const stage = x !== undefined ? x : opts.stage;
  if (!stage) throw new HttpError(400, 'stage is required');
  const patch = { stage };
  for (const k of MOVE_OPTS) if (opts[k] !== undefined) patch[k] = opts[k];
  if (opts.reason !== undefined && patch.lostReason === undefined) patch.lostReason = opts.reason;
  return writeDeal(dealId, patch, { workspaceId: opts.workspaceId, actor: actorOf(opts) });
}

// closeDeal(dealId, { workspaceId, closedAt, commission, grossCommission }) — move to Closed,
// or (already closed) re-book the commission / closing date. Object form accepted.
async function closeDeal(a, b) {
  const { dealId, opts } = unpack(a, undefined, b);
  const o = a && typeof a === 'object' ? opts : (b || {});
  const patch = { stage: 'closed' };
  for (const k of ['closedAt', 'commission', 'grossCommission']) if (o[k] !== undefined) patch[k] = o[k];
  return writeDeal(dealId, patch, { workspaceId: o.workspaceId, actor: actorOf(o) });
}

// reopenDeal(dealId, { workspaceId, stage? }) — Closed → Under Contract, Lost → the stage it was lost from.
async function reopenDeal(a, b) {
  const { dealId } = unpack(a);
  const o = a && typeof a === 'object' ? unpack(a).opts : (b || {});
  const { workspaceId } = o;
  let { stage } = o;
  const deal = await prisma.deal.findFirst({ where: { id: dealId, workspaceId } });
  if (!deal) throw new HttpError(404, 'Deal not found');
  if (!stage) {
    if (deal.stage === 'closed') stage = S.stageForPhase('under_contract', deal.side);
    else if (deal.stage === 'lost') {
      const ev = await prisma.dealEvent.findFirst({ where: { dealId, toStage: 'lost' }, orderBy: { createdAt: 'desc' } });
      stage = ev && ev.fromStage && ev.fromStage !== 'lost' && ev.fromStage !== 'closed' ? ev.fromStage : (deal.track === 'new_dev' ? S.NEW_DEV_KEYS[0] : S.stageForPhase('engaged', deal.side));
    } else return getDeal(dealId, { workspaceId });
  }
  return writeDeal(dealId, { stage }, { workspaceId, actor: actorOf(o) });
}

// markLost(dealId, { workspaceId, reason, note }) — object form accepted.
async function markLost(a, b) {
  const { dealId } = unpack(a);
  const o = a && typeof a === 'object' ? unpack(a).opts : (b || {});
  return writeDeal(dealId, { stage: 'lost', lostReason: o.reason || o.lostReason || 'No reason given', lostNote: o.note ?? o.lostNote ?? undefined }, { workspaceId: o.workspaceId, actor: actorOf(o) });
}

// deleteDeal(dealId, { workspaceId }) — reverses close-out first. Object form accepted.
async function deleteDeal(a, b) {
  const { dealId } = unpack(a);
  const o = a && typeof a === 'object' ? unpack(a).opts : (b || {});
  const { workspaceId } = o;
  const px = await pricingContext(workspaceId);
  const effects = newEffects();
  const deal = await prisma.$transaction(async (tx) => {
    const d = await tx.deal.findFirst({ where: { id: dealId, workspaceId } });
    if (!d) throw new HttpError(404, 'Deal not found');
    if (d.stage === 'closed' || obj(d.extras).closeApplied) await undoClose(tx, { ...d, stage: 'deleting' }, px, effects, d.stage === 'closed' ? d : null);
    await tx.deal.delete({ where: { id: d.id } });
    return d;
  }, TX_OPTS);
  hub.broadcast(workspaceId, 'deal_deleted', { id: deal.id, clientId: deal.clientId });
  await broadcastEffects(workspaceId, effects);
  return { id: deal.id };
}

async function getDeal(a, b) {
  const { dealId } = unpack(a);
  const { workspaceId, withEvents = false } = a && typeof a === 'object' ? unpack(a).opts : (b || {});
  const deal = await prisma.deal.findFirst({ where: { id: dealId, workspaceId } });
  if (!deal) throw new HttpError(404, 'Deal not found');
  const n = await N.normalizeOne(workspaceId, deal);
  if (withEvents) {
    n.events = await prisma.dealEvent.findMany({ where: { dealId }, orderBy: { createdAt: 'desc' }, take: 40 });
  }
  return n;
}

// listDeals({ workspaceId, clientId, stage, open, closed, includeArchived, track, side, board, from, to, limit })
async function listDeals(f = {}) {
  const { workspaceId } = f;
  const and = [{ workspaceId }];
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.stage) {
    const keys = new Set();
    for (const raw of String(f.stage).split(',').map((s) => s.trim()).filter(Boolean)) {
      if (S.PHASE_BY_ID[raw]) {
        if (raw === 'lost') keys.add('lost');
        else for (const fam of Object.values(S.FAMILY_KEYS)) keys.add(fam[S.PHASE_IDS.indexOf(raw)]);
      } else if (raw === 'new_dev') S.NEW_DEV_KEYS.forEach((k) => keys.add(k));
      else keys.add(raw);
    }
    and.push({ stage: { in: [...keys] } });
  }
  if (f.open) and.push({ stage: { notIn: ['closed', 'lost'] } });
  if (f.closed) and.push({ stage: 'closed' });
  if (f.board) {
    // On the board: everything open + Closed for the current month only
    // (rollover may not have run yet for older closings).
    const tz = await require('./plan').workspaceTz(workspaceId);
    const { start } = monthBounds(new Date(), tz);
    and.push({ stage: { not: 'lost' } }, { archivedAt: null }, { OR: [{ stage: { not: 'closed' } }, { closedAt: { gte: start } }] });
  }
  else if (!f.includeArchived) and.push({ archivedAt: null });
  if (f.track) and.push({ track: f.track });
  if (f.side) and.push({ side: { in: String(f.side).split(',') } });
  if (f.from || f.to) and.push({ closedAt: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lt: new Date(f.to) } : {}) } });
  const where = { AND: and };
  const take = Math.min(1000, Math.max(1, Number(f.limit) || 500));
  const [rows, total] = await Promise.all([
    prisma.deal.findMany({ where, orderBy: [{ stageChangedAt: 'desc' }, { createdAt: 'desc' }], take }),
    prisma.deal.count({ where }),
  ]);
  return { deals: await N.normalizeMany(workspaceId, rows), total };
}

module.exports = {
  createDeal,
  updateDeal,
  moveDeal,
  closeDeal,
  reopenDeal,
  markLost,
  deleteDeal,
  getDeal,
  listDeals,
  // helpers other pipeline modules reuse
  sanitize,
  parseMoney,
  parseRate,
  parseDate,
  archivedAtFor,
  compactMoney,
  clientDisplayName,
};

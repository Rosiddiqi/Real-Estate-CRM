// /api/portfolio — the client Portfolio (RevMatch Garage, re-geared):
// PortfolioProperty (owns · rents · sold · watching · leased_out) and
// BuyerSearch (the Wishlist: active · dream · inferred).
//
//   GET    /api/portfolio/properties?clientId=&relationship=owns,rents&limit=   → { properties, total }
//   GET    /api/portfolio/properties/:id                                       → { property }  (+ client, derived, badges)
//   POST   /api/portfolio/properties   { clientId, …fields }                   → 201 { property }
//   PATCH  /api/portfolio/properties/:id                                       → { property }  (`meta` merges)
//   DELETE /api/portfolio/properties/:id                                       → { ok }
//   GET    /api/portfolio/properties/:id/buyers                                → { buyers, source }  "Buyers who'd love this"
//   GET    /api/portfolio/searches?clientId=&bucket=&status=                   → { searches, total }
//   GET/PATCH/DELETE /api/portfolio/searches/:id, POST /api/portfolio/searches → { search }
//   POST   /api/portfolio/parse { text?, url?, target:'property'|'search'|'auto' } → { kind, fields, chips, source, portal }
//   GET    /api/portfolio/suggestions                                          → { neighborhoods, buildings, cities, lenders, styles, features }
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse, paging } = require('../lib/http');
const { logActivity } = require('../lib/activity');
const S = require('../services/clients/serialize');
const { moneyShort } = require('../services/clients/text');
const RP = require('../services/clients/reparse');

const router = express.Router();
const V = RP.V;

const REL = ['owns', 'rents', 'sold', 'watching', 'leased_out'];
const REL_ALIAS = {
  own: 'owns', owned: 'owns', primary: 'owns', vacation: 'owns', investment: 'owns', second_home: 'owns',
  rent: 'rents', renting: 'rents', rental: 'rents', tenant: 'rents',
  former: 'sold', traded: 'sold', sale: 'sold',
  watch: 'watching', tracking: 'watching',
  landlord: 'leased_out', leased: 'leased_out',
};

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optStr = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === undefined ? undefined : v === null ? null : Number(String(v).replace(/[$,\s]/g, ''))), z.number().finite().nullable().optional());
const optInt = z.preprocess((v) => (v === '' || v === undefined ? undefined : v === null ? null : Math.round(Number(String(v).replace(/[$,\s]/g, '')))), z.number().int().nullable().optional());
const optBool = z.preprocess((v) => (v === '' ? undefined : v), z.boolean().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.union([z.string(), z.date()]).nullable().optional());
const strList = z.array(z.string().trim().max(120)).max(80).optional();

const propertySchema = z.object({
  clientId: z.string().optional(),
  relationship: optStr(30), occupancy: optStr(30), nickname: optStr(120), listingId: optStr(64), source: optStr(40),
  listingUrl: optStr(2000), mlsNumber: optStr(60), parcelNumber: optStr(80),
  street: optStr(200), unit: optStr(40), city: optStr(120), state: optStr(40), zip: optStr(20), neighborhood: optStr(120),
  subdivision: optStr(120), buildingName: optStr(160), market: optStr(120), lat: optNum, lng: optNum,
  propertyType: optStr(40), architecturalStyle: optStr(80), styleFamily: optStr(40),
  beds: optInt, baths: optNum, sqft: optInt, lotSqft: optInt, lotAcres: optNum, yearBuilt: optInt, stories: optInt, garageSpaces: optInt,
  waterfront: optStr(40), waterFrontageFt: optInt, dockLengthFt: optInt, views: strList, amenities: strList,
  features: z.array(z.union([z.string(), z.object({ name: z.string(), confirmed: z.boolean().optional(), importance: z.string().optional() }).passthrough()])).max(80).nullable().optional(),
  purchasePrice: optInt, purchasedAt: optDate, purchasedDealId: optStr(64), estValue: optInt, estValueAt: optDate, valueSource: optStr(30),
  titleHolding: optStr(30), lenderName: optStr(120), mortgageBalance: optInt, mortgageRate: optNum, loanType: optStr(30),
  loanResetAt: optDate, loanMaturesAt: optDate, rentAmount: optInt, leaseEndsAt: optDate, hoaMonthly: optInt, taxAnnual: optInt,
  boughtWithMe: optBool, soldWithMe: optBool, soldPrice: optInt, soldAt: optDate, thinkingOfSelling: optBool,
  sellSignals: z.any().optional(), photos: z.array(z.string().max(2000)).max(60).optional(), heroPhoto: optStr(2000),
  documents: z.array(z.object({ url: z.string(), kind: z.string().optional(), name: z.string().optional() }).passthrough()).max(60).nullable().optional(),
  notes: optStr(20000),
  meta: z.record(z.any()).nullable().optional(),
}).passthrough();

const PROPERTY_FIELDS = ['relationship', 'occupancy', 'nickname', 'listingId', 'source', 'listingUrl', 'mlsNumber', 'parcelNumber', 'street', 'unit',
  'city', 'state', 'zip', 'neighborhood', 'subdivision', 'buildingName', 'market', 'lat', 'lng', 'propertyType', 'architecturalStyle', 'styleFamily',
  'beds', 'baths', 'sqft', 'lotSqft', 'lotAcres', 'yearBuilt', 'stories', 'garageSpaces', 'waterfront', 'waterFrontageFt', 'dockLengthFt', 'views',
  'amenities', 'features', 'purchasePrice', 'purchasedAt', 'purchasedDealId', 'estValue', 'estValueAt', 'valueSource', 'titleHolding', 'lenderName',
  'mortgageBalance', 'mortgageRate', 'loanType', 'loanResetAt', 'loanMaturesAt', 'rentAmount', 'leaseEndsAt', 'hoaMonthly', 'taxAnnual',
  'boughtWithMe', 'soldWithMe', 'soldPrice', 'soldAt', 'thinkingOfSelling', 'sellSignals', 'photos', 'heroPhoto', 'documents', 'notes'];
const DATE_FIELDS = ['purchasedAt', 'estValueAt', 'loanResetAt', 'loanMaturesAt', 'leaseEndsAt', 'soldAt'];

// 'YYYY', 'YYYY-MM', 'YYYY-MM-DD', 'Mar 2019', ISO → Date at 12:00 UTC (no day shifting).
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, 15, 12));
  m = /^(\d{4})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], 5, 15, 12));
  m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})$/i.exec(s);
  if (m) return new Date(Date.UTC(+m[2], ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase().slice(0, 3)), 15, 12));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function addMonths(d, months) {
  const x = new Date(d.getTime());
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

function normRelationship(r) {
  if (r == null) return r;
  const k = String(r).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return REL.includes(k) ? k : (REL_ALIAS[k] || 'owns');
}

function normFeatures(list) {
  if (list == null) return list;
  const out = [];
  const seen = new Set();
  for (const f of list) {
    const name = typeof f === 'string' ? f.trim() : String(f.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (RP.PROTECTED.test(name)) continue;
    seen.add(name.toLowerCase());
    out.push(typeof f === 'string' ? { name, confirmed: false, importance: 'stated' } : { ...f, name, confirmed: !!f.confirmed, importance: f.importance || 'stated' });
  }
  return out;
}

function propertyData(input, before = null) {
  const data = {};
  for (const k of PROPERTY_FIELDS) if (input[k] !== undefined) data[k] = input[k];
  if (data.relationship !== undefined) data.relationship = normRelationship(data.relationship) || 'owns';
  for (const k of DATE_FIELDS) if (data[k] !== undefined) data[k] = toDate(data[k]);
  if (data.mortgageRate != null && data.mortgageRate > 1) data.mortgageRate = Math.round(data.mortgageRate * 1000) / 100000;
  if (data.features !== undefined) data.features = normFeatures(data.features);
  if (data.propertyType && V) data.propertyType = V.canonicalType(data.propertyType) || data.propertyType;
  if (data.waterfront && V) data.waterfront = V.canonicalWaterfront(data.waterfront) || data.waterfront;
  if (data.architecturalStyle && V && data.styleFamily === undefined) data.styleFamily = V.styleFamily(data.architecturalStyle) || null;
  if (data.unit) data.unit = String(data.unit).replace(/^#/, '');
  if (data.views) data.views = [...new Set(data.views.map((v) => v.toLowerCase()))];
  if (data.lotAcres != null && data.lotSqft === undefined && !(before && before.lotSqft)) data.lotSqft = Math.round(data.lotAcres * 43560);
  if (data.estValue !== undefined && data.estValue !== null && (!before || before.estValue !== data.estValue)) {
    if (data.estValueAt === undefined) data.estValueAt = new Date();
    if (data.valueSource === undefined && !(before && before.valueSource)) data.valueSource = 'manual';
  }
  if (data.photos && data.heroPhoto === undefined && (!before || !before.heroPhoto || !data.photos.includes(before.heroPhoto))) data.heroPhoto = data.photos[0] || null;
  if (data.loanType === 'cash' && data.mortgageBalance === undefined) data.mortgageBalance = 0;
  // meta merge + deterministic loan date math (LLMs never do date math).
  if (input.meta !== undefined) {
    const meta = { ...((before && before.meta) || {}) };
    for (const [k, v] of Object.entries(input.meta || {})) { if (v === null || v === '') delete meta[k]; else meta[k] = v; }
    data.meta = meta;
  }
  const meta = data.meta !== undefined ? data.meta : (before && before.meta) || {};
  const loanType = data.loanType !== undefined ? data.loanType : before && before.loanType;
  const orig = meta && meta.originatedAt ? toDate(meta.originatedAt) : null;
  if (orig && loanType === 'arm' && meta.armFixedYears && input.loanResetAt === undefined) data.loanResetAt = addMonths(orig, Number(meta.armFixedYears) * 12);
  if (orig && meta.loanTermMonths && input.loanMaturesAt === undefined) data.loanMaturesAt = addMonths(orig, Number(meta.loanTermMonths));
  if (data.relationship === 'sold' && (!before || before.relationship !== 'sold')) {
    if (data.soldAt === undefined && !(before && before.soldAt)) data.soldAt = new Date();
    if (data.thinkingOfSelling === undefined) data.thinkingOfSelling = false;
  }
  return data;
}

async function clientOr404(workspaceId, id) {
  const c = await prisma.client.findFirst({ where: { id, workspaceId } });
  if (!c) throw new HttpError(404, 'Client not found');
  return c;
}

async function touchClient(workspaceId, clientId) {
  const c = await prisma.client.findUnique({ where: { id: clientId } });
  if (c) hub.broadcast(workspaceId, 'client_updated', S.listRow(c));
  try { require('../services/matchmaker/pool').bustPool(workspaceId); } catch (_) { /* optional */ }
}

// ── PROPERTIES ──────────────────────────────────────────────────────────
router.get('/properties', ah(async (req, res) => {
  const wid = req.workspaceId;
  const tz = await S.workspaceTz(wid);
  const { take, skip } = paging(req, { defaultLimit: 200, maxLimit: 1000 });
  const where = { workspaceId: wid };
  if (req.query.clientId) where.clientId = String(req.query.clientId);
  else where.client = { archivedAt: null };
  if (req.query.relationship) where.relationship = { in: String(req.query.relationship).split(',').map(normRelationship) };
  if (req.query.thinkingOfSelling === '1') where.thinkingOfSelling = true;
  const [rows, total] = await Promise.all([
    prisma.portfolioProperty.findMany({ where, orderBy: [{ createdAt: 'asc' }], take, skip, include: req.query.clientId ? undefined : { client: { select: S.MINI_SELECT } } }),
    prisma.portfolioProperty.count({ where }),
  ]);
  res.json({ properties: rows.map((p) => ({ ...S.serializeProperty(p, tz), ...(p.client ? { client: S.mini(p.client) } : {}) })), total });
}));

router.get('/properties/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const tz = await S.workspaceTz(wid);
  const p = await prisma.portfolioProperty.findFirst({ where: { id: req.params.id, workspaceId: wid }, include: { client: { select: S.MINI_SELECT } } });
  if (!p) throw new HttpError(404, 'Property not found');
  const deals = await prisma.deal.findMany({ where: { workspaceId: wid, portfolioPropertyId: p.id, archivedAt: null }, select: { id: true, title: true, side: true, stage: true, price: true, contractPrice: true, salePrice: true, closedAt: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } }).catch(() => []);
  res.json({ property: { ...S.serializeProperty(p, tz), client: S.mini(p.client), deals } });
}));

function addedTitle(p) {
  const t = S.propertyTitle(p);
  if (p.relationship === 'sold') return `Added sale history: ${t}${p.soldPrice ? ` · ${moneyShort(p.soldPrice)}` : ''}`;
  if (p.relationship === 'rents') return `Added rental: ${t}`;
  if (p.relationship === 'watching') return `Watching ${t}`;
  if (p.relationship === 'leased_out') return `Added rental property: ${t}`;
  return `Added ${t} to portfolio`;
}

router.post('/properties', ah(async (req, res) => {
  const wid = req.workspaceId;
  const input = parse(propertySchema, req.body || {});
  if (!input.clientId) throw new HttpError(400, 'clientId is required');
  const client = await clientOr404(wid, input.clientId);
  const data = propertyData(input);
  if (!data.relationship) data.relationship = 'owns';
  if (!data.source) data.source = input.listingUrl ? 'listing_link' : 'manual';
  if (!data.street && !data.buildingName && !data.nickname && !data.neighborhood && !data.city && !data.listingUrl) {
    throw new HttpError(400, 'Add an address, building or neighborhood.');
  }
  const created = await prisma.portfolioProperty.create({ data: { ...data, workspaceId: wid, clientId: client.id } });
  await logActivity({ workspaceId: wid, clientId: client.id, type: 'property_added', title: addedTitle(created), meta: { propertyId: created.id, relationship: created.relationship }, actor: 'agent' });
  touchClient(wid, client.id);
  const tz = await S.workspaceTz(wid);
  res.status(201).json({ property: S.serializeProperty(created, tz) });
}));

router.patch('/properties/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const before = await prisma.portfolioProperty.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!before) throw new HttpError(404, 'Property not found');
  const input = parse(propertySchema, req.body || {});
  const data = propertyData(input, before);
  delete data.clientId;
  const updated = await prisma.portfolioProperty.update({ where: { id: before.id }, data });
  const t = S.propertyTitle(updated);
  if (updated.relationship === 'sold' && before.relationship !== 'sold') {
    await logActivity({ workspaceId: wid, clientId: updated.clientId, type: 'property_sold', title: `Marked ${t} sold${updated.soldPrice ? ` · ${moneyShort(updated.soldPrice)}` : ''}`, meta: { propertyId: updated.id }, actor: 'agent' });
  } else if (updated.thinkingOfSelling && !before.thinkingOfSelling) {
    await logActivity({ workspaceId: wid, clientId: updated.clientId, type: 'property_updated', title: `Thinking of selling ${t}`, meta: { propertyId: updated.id, signal: 'thinking_of_selling' }, actor: 'agent' });
  }
  touchClient(wid, updated.clientId);
  const tz = await S.workspaceTz(wid);
  res.json({ property: S.serializeProperty(updated, tz) });
}));

router.delete('/properties/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const p = await prisma.portfolioProperty.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!p) throw new HttpError(404, 'Property not found');
  await prisma.portfolioProperty.delete({ where: { id: p.id } });
  await logActivity({ workspaceId: wid, clientId: p.clientId, type: 'property_removed', title: `Removed ${S.propertyTitle(p)} from portfolio`, meta: { propertyId: p.id }, actor: 'agent' });
  touchClient(wid, p.clientId);
  res.json({ ok: true });
}));

// "Buyers who'd love this" — score every other client's active search against
// an owned property (off-market client-to-client). Uses the listings
// builder's scorer when present; a light deterministic fit otherwise.
function listingLike(p) {
  const feats = Array.isArray(p.features) ? p.features.map((f) => f.name) : [];
  return {
    ...p, status: 'active', origin: 'pocket', isOwnListing: false,
    listPrice: p.estValue || p.soldPrice || p.purchasePrice || null,
    bathsTotal: p.baths, livingAreaSqft: p.sqft, postalCode: p.zip, unitNumber: p.unit,
    hoaFee: p.hoaMonthly, amenities: [...(p.amenities || []), ...feats],
  };
}

function fallbackFit(p, s) {
  const lc = (x) => String(x || '').toLowerCase();
  const reasons = [];
  let w = 0; let q = 0;
  const add = (weight, quality, why) => { w += weight; q += weight * quality; if (quality >= 0.85 && why) reasons.push(why); };
  const areas = [...(s.neighborhoods || []), ...(s.buildings || [])].map(lc);
  if (areas.length) {
    const hit = areas.some((a) => a && (a === lc(p.neighborhood) || a === lc(p.buildingName) || a === lc(p.subdivision)));
    const city = areas.some((a) => a && a === lc(p.city));
    add(24, hit ? 1 : city ? 0.6 : 0, hit ? `In ${p.neighborhood || p.buildingName}` : null);
  }
  if ((s.propertyTypes || []).length) {
    if (p.propertyType && !s.propertyTypes.includes(p.propertyType)) return null; // type gate
    add(12, p.propertyType ? 1 : 0.6, null);
  }
  const want = (s.waterfront || []).filter((x) => x && x !== 'any' && x !== 'none');
  if ((s.waterfront || []).length) {
    if (!p.waterfront || p.waterfront === 'none') return null; // waterfront required gate
    add(7, !want.length || want.includes(p.waterfront) ? 1 : 0.6, 'Waterfront');
  }
  const price = p.estValue || p.purchasePrice;
  if (price && (s.priceMin || s.priceMax)) {
    const lo = s.priceMin || 0; const hi = s.priceMax || Infinity;
    add(16, price >= lo && price <= hi ? 1 : price <= hi * 1.1 && price >= lo * 0.9 ? 0.6 : 0, price <= hi ? 'In budget' : null);
  }
  if (s.bedsMin && p.beds != null) add(8, p.beds >= s.bedsMin ? 1 : p.beds >= s.bedsMin - 1 ? 0.5 : 0, p.beds >= s.bedsMin ? `${p.beds} bd` : null);
  if (s.sqftMin && p.sqft) add(8, p.sqft >= s.sqftMin ? 1 : p.sqft >= s.sqftMin * 0.85 ? 0.6 : 0, null);
  if (!w) return null;
  return { score: Math.min(99, Math.round((q / w) * 100)), summary: reasons.slice(0, 2).join(' · ') || 'Partial fit', mustHaves: [] };
}

router.get('/properties/:id/buyers', ah(async (req, res) => {
  const wid = req.workspaceId;
  const p = await prisma.portfolioProperty.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!p) throw new HttpError(404, 'Property not found');
  const searches = await prisma.buyerSearch.findMany({
    where: { workspaceId: wid, status: 'active', clientId: { not: p.clientId }, client: { archivedAt: null, contactKind: 'client' } },
    include: { client: { select: S.MINI_SELECT } },
    take: 500,
  });
  let scorer = null;
  try { scorer = require('../services/matchmaker/score'); } catch (_) { scorer = null; }
  const like = listingLike(p);
  const out = [];
  for (const s of searches) {
    let r = null;
    try {
      r = scorer && scorer.scoreListingForSearch ? scorer.scoreListingForSearch(like, s, { allowOffMarket: true, includePending: true }) : fallbackFit(p, s);
    } catch (_) { r = fallbackFit(p, s); }
    if (!r || r.gated || !(r.score >= 65)) continue;
    out.push({ client: S.mini(s.client), search: { id: s.id, title: S.searchTitle(s), bucket: s.bucket }, score: r.score, summary: r.summary, mustHaves: (r.mustHaves || []).slice(0, 4) });
  }
  // best search per client, score desc
  const best = new Map();
  for (const row of out) { const prev = best.get(row.client.id); if (!prev || prev.score < row.score) best.set(row.client.id, row); }
  const buyers = [...best.values()].sort((a, b) => b.score - a.score || (b.client.isWhale ? 1 : 0) - (a.client.isWhale ? 1 : 0)).slice(0, 12);
  res.json({ buyers, total: buyers.length, source: scorer ? 'matchmaker' : 'fallback' });
}));

// ── SEARCHES (Wishlist) ─────────────────────────────────────────────────
const mustHaveItem = z.union([z.string(), z.object({ feature: z.string(), importance: z.union([z.number(), z.string()]).optional(), source: z.string().optional(), min: z.number().nullable().optional(), max: z.number().nullable().optional(), key: z.string().nullable().optional() }).passthrough()]);
const searchSchema = z.object({
  clientId: z.string().optional(),
  name: optStr(160), bucket: optStr(20), status: optStr(20),
  markets: strList, neighborhoods: strList, buildings: strList, propertyTypes: strList,
  priceMin: optInt, priceMax: optInt, budgetFlexible: optBool,
  bedsMin: optInt, bathsMin: optNum, sqftMin: optInt, sqftMax: optInt, lotSqftMin: optInt, yearBuiltMin: optInt, yearBuiltMax: optInt,
  styles: strList, waterfront: strList, views: strList,
  mustHaves: z.array(mustHaveItem).max(40).nullable().optional(),
  niceToHaves: strList, dealBreakers: strList,
  timeline: optStr(40), financing: optStr(40), notes: optStr(20000),
  criteriaRaw: z.record(z.any()).nullable().optional(),
}).passthrough();

const SEARCH_FIELDS = ['name', 'bucket', 'status', 'markets', 'neighborhoods', 'buildings', 'propertyTypes', 'priceMin', 'priceMax', 'budgetFlexible',
  'bedsMin', 'bathsMin', 'sqftMin', 'sqftMax', 'lotSqftMin', 'yearBuiltMin', 'yearBuiltMax', 'styles', 'waterfront', 'views', 'mustHaves',
  'niceToHaves', 'dealBreakers', 'timeline', 'financing', 'notes'];

function searchData(input, before = null) {
  const data = {};
  for (const k of SEARCH_FIELDS) if (input[k] !== undefined) data[k] = input[k];
  const uniqTrim = (l) => [...new Set((l || []).map((x) => String(x).trim()).filter(Boolean))];
  for (const k of ['markets', 'neighborhoods', 'buildings', 'styles', 'views', 'niceToHaves']) if (data[k]) data[k] = RP.scrub(uniqTrim(data[k]));
  if (data.dealBreakers) data.dealBreakers = RP.scrub(uniqTrim(data.dealBreakers));
  if (data.propertyTypes) data.propertyTypes = uniqTrim(data.propertyTypes).map((t) => (V && V.canonicalType(t)) || t.toLowerCase().replace(/[\s-]+/g, '_'));
  if (data.waterfront) data.waterfront = uniqTrim(data.waterfront).map((w) => (V && V.canonicalWaterfront(w)) || w.toLowerCase()).filter((w) => w !== 'none');
  if (data.bucket) data.bucket = ['active', 'dream', 'inferred'].includes(data.bucket) ? data.bucket : 'active';
  if (data.status) data.status = ['active', 'paused', 'found'].includes(data.status) ? data.status : 'active';
  if (data.mustHaves !== undefined && data.mustHaves !== null) {
    data.mustHaves = data.mustHaves.map((m) => {
      const o = typeof m === 'string' ? { feature: m } : { ...m };
      o.feature = String(o.feature || '').trim();
      const imp = o.importance;
      o.importance = imp === 'must' ? 1 : imp === 'want' ? 0.5 : Number.isFinite(Number(imp)) ? Math.max(0, Math.min(1.2, Number(imp))) : 1;
      o.source = o.source || 'search';
      if (o.min == null) delete o.min;
      if (o.max == null) delete o.max;
      if (!o.key) {
        try { const pm = V && V.parseMustHave(o); if (pm && pm.key) { o.key = pm.key; if (pm.min != null && o.min == null) o.min = pm.min; if (pm.max != null && o.max == null) o.max = pm.max; if (pm.value) o.value = pm.value; } } catch (_) { /* optional */ }
      }
      return o;
    }).filter((o) => o.feature && !RP.PROTECTED.test(o.feature));
  }
  if (data.priceMin != null && data.priceMax != null && data.priceMin > data.priceMax) [data.priceMin, data.priceMax] = [data.priceMax, data.priceMin];
  if (input.criteriaRaw !== undefined) {
    const raw = { ...((before && before.criteriaRaw) || {}) };
    for (const [k, v] of Object.entries(input.criteriaRaw || {})) { if (v === null || v === '') delete raw[k]; else raw[k] = v; }
    data.criteriaRaw = raw;
  }
  return data;
}

router.get('/searches', ah(async (req, res) => {
  const wid = req.workspaceId;
  const where = { workspaceId: wid };
  if (req.query.clientId) where.clientId = String(req.query.clientId);
  else where.client = { archivedAt: null };
  if (req.query.bucket) where.bucket = { in: String(req.query.bucket).split(',') };
  if (req.query.status) where.status = { in: String(req.query.status).split(',') };
  const rows = await prisma.buyerSearch.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: 500, include: req.query.clientId ? undefined : { client: { select: S.MINI_SELECT } } });
  res.json({ searches: rows.map((s) => ({ ...S.serializeSearch(s), ...(s.client ? { client: S.mini(s.client) } : {}) })), total: rows.length });
}));

router.get('/searches/:id', ah(async (req, res) => {
  const s = await prisma.buyerSearch.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId }, include: { client: { select: S.MINI_SELECT } } });
  if (!s) throw new HttpError(404, 'Search not found');
  res.json({ search: { ...S.serializeSearch(s), client: S.mini(s.client) } });
}));

router.post('/searches', ah(async (req, res) => {
  const wid = req.workspaceId;
  const input = parse(searchSchema, req.body || {});
  if (!input.clientId) throw new HttpError(400, 'clientId is required');
  const client = await clientOr404(wid, input.clientId);
  const data = searchData(input);
  const created = await prisma.buyerSearch.create({ data: { ...data, workspaceId: wid, clientId: client.id } });
  const t = S.searchTitle(created);
  await logActivity({ workspaceId: wid, clientId: client.id, type: 'search_updated', title: created.bucket === 'dream' ? `Added to wishlist: ${t}` : `Started searching: ${t}`, meta: { searchId: created.id, event: 'created' }, actor: 'agent' });
  touchClient(wid, client.id);
  res.status(201).json({ search: S.serializeSearch(created) });
}));

router.patch('/searches/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const before = await prisma.buyerSearch.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!before) throw new HttpError(404, 'Search not found');
  const input = parse(searchSchema, req.body || {});
  const data = searchData(input, before);
  const updated = await prisma.buyerSearch.update({ where: { id: before.id }, data });
  const t = S.searchTitle(updated);
  let title = `Updated search: ${t}`;
  if (data.status === 'found' && before.status !== 'found') title = `Found it: ${t}`;
  else if (data.status === 'paused' && before.status !== 'paused') title = `Paused search: ${t}`;
  else if (data.bucket === 'active' && before.bucket === 'dream') title = `Started searching: ${t}`;
  await logActivity({ workspaceId: wid, clientId: updated.clientId, type: 'search_updated', title, meta: { searchId: updated.id, event: 'updated' }, actor: 'agent' });
  touchClient(wid, updated.clientId);
  res.json({ search: S.serializeSearch(updated) });
}));

router.delete('/searches/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const s = await prisma.buyerSearch.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!s) throw new HttpError(404, 'Search not found');
  await prisma.buyerSearch.delete({ where: { id: s.id } });
  await logActivity({ workspaceId: wid, clientId: s.clientId, type: 'search_updated', title: `Removed search: ${S.searchTitle(s)}`, meta: { searchId: s.id, event: 'removed' }, actor: 'agent' });
  touchClient(wid, s.clientId);
  res.json({ ok: true });
}));

// ── PARSE (listing link / describe-it) ──────────────────────────────────
router.post('/parse', ah(async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.slice(0, 6000) : '';
  const url = typeof body.url === 'string' ? body.url.slice(0, 2000) : '';
  if (!text.trim() && !url.trim()) throw new HttpError(400, 'Paste a link or describe it.');
  const target = ['property', 'search', 'auto'].includes(body.target) ? body.target : 'auto';
  const out = await RP.parseCapture({ text, url, target, workspaceId: req.workspaceId });
  res.json(out);
}));

// ── SUGGESTIONS (chip inputs / autocomplete) ────────────────────────────
router.get('/suggestions', ah(async (req, res) => {
  const wid = req.workspaceId;
  const [props, searches, listings, clients] = await Promise.all([
    prisma.portfolioProperty.findMany({ where: { workspaceId: wid }, select: { neighborhood: true, buildingName: true, city: true, lenderName: true, architecturalStyle: true, features: true, subdivision: true } }),
    prisma.buyerSearch.findMany({ where: { workspaceId: wid }, select: { neighborhoods: true, buildings: true, markets: true, styles: true, niceToHaves: true } }),
    prisma.listing.findMany({ where: { workspaceId: wid, droppedAt: null }, select: { neighborhood: true, buildingName: true, city: true, developmentName: true, architecturalStyle: true }, take: 2000 }).catch(() => []),
    prisma.client.findMany({ where: { workspaceId: wid, archivedAt: null }, select: { neighborhood: true, city: true } }),
  ]);
  const tally = (vals, seed = []) => {
    const m = new Map();
    for (const v of seed) m.set(v, 0.5);
    for (const v of vals) { if (!v) continue; const k = String(v).trim(); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value).slice(0, 80);
  };
  res.json({
    neighborhoods: tally([...props.map((p) => p.neighborhood), ...props.map((p) => p.subdivision), ...searches.flatMap((s) => s.neighborhoods), ...listings.map((l) => l.neighborhood), ...clients.map((c) => c.neighborhood)], RP.NEIGHBORHOODS.slice(0, 40)),
    buildings: tally([...props.map((p) => p.buildingName), ...searches.flatMap((s) => s.buildings), ...listings.map((l) => l.buildingName), ...listings.map((l) => l.developmentName)], RP.BUILDINGS.slice(0, 20)),
    cities: tally([...props.map((p) => p.city), ...listings.map((l) => l.city), ...clients.map((c) => c.city), ...searches.flatMap((s) => s.markets)]),
    lenders: tally(props.map((p) => p.lenderName), ['First Republic', 'JPMorgan Private Bank', 'Wells Fargo Private Bank', 'City National', 'Northern Trust', 'Bank of America Private Bank', 'Citi Private Bank', 'UBS', 'Morgan Stanley']),
    styles: tally([...props.map((p) => p.architecturalStyle), ...searches.flatMap((s) => s.styles), ...listings.map((l) => l.architecturalStyle)], ['Modern', 'Contemporary', 'Mediterranean', 'Transitional', 'British West Indies', 'Spanish', 'Colonial']),
    features: tally([...props.flatMap((p) => (Array.isArray(p.features) ? p.features.map((f) => f.name) : [])), ...searches.flatMap((s) => s.niceToHaves)], ['Pool', 'Dock', 'Boat lift', 'Wine cellar', 'Guest house', 'Elevator', 'Gated', 'Generator', 'Smart home', 'Home theater', 'Gym', 'Staff quarters', 'Summer kitchen', 'Rooftop terrace', 'Impact windows']),
  });
}));

module.exports = router;

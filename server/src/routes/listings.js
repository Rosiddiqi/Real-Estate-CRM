// /api/listings — Listings inventory (own · MLS feed · pocket & coming soon ·
// whispers · new development) + sources, parsing, photos, status/price
// bookkeeping and private showcase links.
//
//   GET    /                ?search=&status=&lane=&origin=&sort=&limit=&page=&matches=0  → { listings, total, lanes, threshold }
//   GET    /sources                                         → { sources, lanes }
//   POST   /sources         { name, kind, url?, color? }    → { source }
//   POST   /parse           { text?, url?, mode? }          → { fields, confidence, ai, source }
//   GET    /:id                                             → { listing }
//   POST   /                { lane|mode, ...fields }        → { listing, buyers }
//   PATCH  /:id             { ...fields }                   → { listing }
//   POST   /:id/status      { status, listPrice?, closePrice? } → { listing }
//   POST   /:id/photos      { urls[], cover? }              → { listing }
//   POST   /:id/share                                       → { slug, url }
//   DELETE /:id                                             → { ok }
// Broadcasts `listing_updated` ({ id, listing } | { id, deleted: true }).
const express = require('express');
const crypto = require('node:crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const config = require('../config');
const { ah, HttpError, parse } = require('../lib/http');
const shape = require('../services/listings/shape');
const { priceChangeFields, recordPriceEvent } = require('../services/listings/price');
const { parseListing } = require('../services/listings/parse');
const engine = require('../services/matchmaker/engine');
const feeds = require('../services/matchmaker/feeds');
const { getDemandPool } = require('../services/matchmaker/pool');
const { MATCH_CONFIG } = require('../services/matchmaker/score');

const router = express.Router();

const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newSlug() {
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return s;
}
async function ensureSlug(listing) {
  if (listing.publicSlug) return listing.publicSlug;
  for (let i = 0; i < 3; i++) {
    try {
      const slug = newSlug();
      await prisma.listing.update({ where: { id: listing.id }, data: { publicSlug: slug } });
      return slug;
    } catch (err) { if (err.code !== 'P2002') throw err; }
  }
  throw new HttpError(500, 'Could not mint a share link');
}
const publicUrl = (slug) => `${config.appUrl.replace(/\/$/, '')}/api/public/p/${slug}`;

async function tzFor(workspaceId) {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  return (w && w.timezone) || config.timezone;
}

// ── sources ───────────────────────────────────────────────────────────────
const SOURCE_FOR_LANE = {
  mine: { kind: 'own', name: 'My Listings', color: '#F2A93B', origin: 'own' },
  pocket: { kind: 'pocket', name: 'Pocket & Coming Soon', color: '#9A4DFF', origin: 'pocket' },
  whisper: { kind: 'whisper', name: 'Whispers', color: '#30D27A', origin: 'whisper' },
  newdev: { kind: 'development', name: 'New Development', color: '#32D4F5', origin: 'development' },
  mls: { kind: 'mls', name: 'MLS Feed', color: '#2E8BFF', origin: 'manual' },
};

async function sourceForLane(workspaceId, lane) {
  const def = SOURCE_FOR_LANE[lane] || SOURCE_FOR_LANE.mls;
  const existing = await prisma.listingSource.findFirst({ where: { workspaceId, kind: def.kind }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return prisma.listingSource.create({ data: { workspaceId, name: def.name, kind: def.kind, color: def.color } });
}

// ── input schema ──────────────────────────────────────────────────────────
const blankToNull = (v) => (v === '' ? null : v);
const num = z.preprocess(blankToNull, z.coerce.number().finite().nullable()).optional();
const int = z.preprocess(blankToNull, z.coerce.number().finite().transform((v) => (v == null ? v : Math.round(v))).nullable()).optional();
const str = z.preprocess(blankToNull, z.string().trim().max(4000).nullable()).optional();
const strArr = z.array(z.string().trim().min(1).max(200)).max(200).optional();

const listingInput = z.object({
  lane: z.enum(['mine', 'mls', 'pocket', 'whisper', 'newdev']).optional(),
  sourceId: str,
  origin: str,
  isOwnListing: z.boolean().optional(),
  mlsNumber: str, parcelNumber: str, title: str, headline: str, description: str,
  street: str, unitNumber: str, city: str, state: str, postalCode: str, neighborhood: str, buildingName: str, market: str,
  lat: num, lng: num, hideAddress: z.boolean().optional(),
  status: z.enum(['coming_soon', 'active', 'under_contract', 'pending', 'sold', 'withdrawn', 'expired', 'off_market']).optional(),
  propertyType: str, propertySubType: str,
  listPrice: int, originalListPrice: int, closePrice: int,
  beds: int, bathsFull: int, bathsHalf: int, bathsTotal: num, livingAreaSqft: int, lotSqft: int, lotAcres: num,
  yearBuilt: int, yearRenovated: int, stories: int, garageSpaces: int,
  architecturalStyle: str, styleFamily: str, waterfront: str, waterFrontageFt: int, dockLengthFt: int,
  views: strArr, amenities: strArr, amenityFlags: z.record(z.union([z.boolean(), z.null()])).optional(),
  hoaFee: int, hoaFrequency: str, taxAnnual: int,
  listedAt: z.preprocess(blankToNull, z.coerce.date().nullable()).optional(),
  photoUrls: strArr, heroPhoto: str, virtualTourUrl: str, featureSheetUrl: str, hasFeatureSheet: z.boolean().optional(),
  listingUrl: str, listAgentName: str, listOfficeName: str, ownerClientId: str,
  developmentName: str, floor: int, unitLine: str,
  priceGuide: int, eta: str, whisperSource: str, confidence: z.record(z.number()).optional(),
});

function cleanData(d) {
  const out = { ...d };
  delete out.lane;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  if (out.lotAcres != null && out.lotSqft == null) out.lotSqft = Math.round(out.lotAcres * 43560);
  if (out.lotSqft != null && out.lotAcres == null) out.lotAcres = Math.round((out.lotSqft / 43560) * 100) / 100;
  if (out.bathsTotal == null && (out.bathsFull != null || out.bathsHalf != null)) out.bathsTotal = (out.bathsFull || 0) + 0.5 * (out.bathsHalf || 0);
  if (out.views) out.views = [...new Set(out.views.map((v) => v.toLowerCase()))];
  if (out.amenities) out.amenities = [...new Set(out.amenities)];
  return out;
}

async function loadListing(workspaceId, id) {
  const l = await prisma.listing.findFirst({ where: { id, workspaceId }, include: { ...engine.LISTING_INCLUDE, priceEvents: { orderBy: { changedAt: 'desc' }, take: 20 } } });
  if (!l) throw new HttpError(404, 'Listing not found');
  return l;
}

async function detailFor(workspaceId, l) {
  const [owner, buyers] = await Promise.all([
    l.ownerClientId ? prisma.client.findFirst({ where: { id: l.ownerClientId, workspaceId }, select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true } }) : null,
    feeds.buyersForListing(workspaceId, l, { fallback: l.origin === 'whisper' }),
  ]);
  return shape.detailShape(l, {
    owner: owner ? { id: owner.id, name: owner.displayName || [owner.firstName, owner.lastName].filter(Boolean).join(' ') } : null,
    matchCount: buyers.shown.filter((b) => b.score >= MATCH_CONFIG.showThreshold).length,
    hotCount: buyers.shown.filter((b) => b.score >= MATCH_CONFIG.hotThreshold).length,
    topMatch: buyers.shown[0] ? { clientId: buyers.shown[0].clientId, name: buyers.shown[0].name, score: buyers.shown[0].score, bucket: buyers.shown[0].bucket, whale: buyers.shown[0].whale } : null,
    shareUrl: l.publicSlug ? publicUrl(l.publicSlug) : null,
  });
}

function broadcast(workspaceId, l, extra = {}) {
  hub.broadcast(workspaceId, 'listing_updated', { id: l.id, listing: shape.cardShape(l), ...extra });
}

// ── list ──────────────────────────────────────────────────────────────────
const SORTS = {
  tier: (a, b) => a.tier - b.tier || (b.bestScore || 0) - (a.bestScore || 0),
  newest: (a, b) => new Date(b.listedAt || b.createdAt) - new Date(a.listedAt || a.createdAt),
  price_asc: (a, b) => (a.listPrice ?? Infinity) - (b.listPrice ?? Infinity),
  price_desc: (a, b) => (b.listPrice ?? -1) - (a.listPrice ?? -1),
  ppsf: (a, b) => (b.pricePerSqft ?? -1) - (a.pricePerSqft ?? -1),
  sqft: (a, b) => (b.sqft ?? -1) - (a.sqft ?? -1),
  reduced: (a, b) => new Date(b.priceDroppedAt || 0) - new Date(a.priceDroppedAt || 0),
  dom: (a, b) => (a.dom ?? Infinity) - (b.dom ?? Infinity),
};

router.get('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 300));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const where = { workspaceId: wid, droppedAt: null };
  const status = String(req.query.status || '').trim();
  if (status && status !== 'all') where.status = { in: status.split(',').map((s) => s.trim()).filter(Boolean) };
  else if (!status) where.status = { notIn: ['sold', 'withdrawn', 'expired'] };
  if (req.query.origin) where.origin = { in: String(req.query.origin).split(',') };
  if (req.query.sourceId) where.sourceId = String(req.query.sourceId);
  const rows = await prisma.listing.findMany({ where, include: engine.LISTING_INCLUDE, take: 2000 });

  const q = String(req.query.search || '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const lane = String(req.query.lane || '').trim();
  const withMatches = req.query.matches !== '0';
  const pool = withMatches ? await getDemandPool(wid) : null;
  const state = withMatches ? await feeds.feedbackState(wid) : null;

  const counts = Object.fromEntries(shape.LANES.map((l) => [l.id, 0]));
  let list = [];
  for (const l of rows) {
    const card = shape.cardShape(l);
    counts[card.lane] = (counts[card.lane] || 0) + 1;
    if (lane && card.lane !== lane) continue;
    if (tokens.length) {
      const hay = [card.title, card.subtitle, l.street, l.neighborhood, l.buildingName, l.city, l.market, l.mlsNumber, l.architecturalStyle,
        l.propertyType, l.developmentName, (l.amenities || []).join(' '), (l.views || []).join(' '), l.waterfront, l.postalCode].filter(Boolean).join(' ').toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) continue;
    }
    card.tier = shape.tierRank(card);
    if (withMatches) {
      const scored = engine.scoreSubject(l, pool, { ownerClientId: l.ownerClientId }).filter((r) => !state.dismissed.has(`${l.id}|${r.entry.clientId}`));
      const thr = l.origin === 'whisper' && !scored.some((r) => r.result.score >= MATCH_CONFIG.showThreshold) && scored.some((r) => r.result.score >= MATCH_CONFIG.fallbackThreshold)
        ? MATCH_CONFIG.fallbackThreshold : MATCH_CONFIG.showThreshold;
      const shown = scored.filter((r) => r.result.score >= thr);
      card.matchCount = shown.length;
      card.matchThreshold = thr;
      card.hotCount = shown.filter((r) => r.result.score >= MATCH_CONFIG.hotThreshold).length;
      card.bestScore = scored[0] ? scored[0].result.score : 0;
      const top = shown[0];
      card.topMatch = top ? { clientId: top.entry.clientId, name: top.entry.name, first: top.entry.first, avatarUrl: top.entry.client.avatarUrl || null, score: top.result.score, bucket: top.entry.bucket, whale: top.entry.whale, verifyHold: top.result.verifyHold } : null;
    }
    list.push(card);
  }
  const sort = SORTS[req.query.sort] || SORTS.tier;
  list.sort(sort);
  const total = list.length;
  list = list.slice((page - 1) * limit, page * limit);
  res.json({
    listings: list,
    total,
    threshold: MATCH_CONFIG.showThreshold,
    lanes: shape.LANES.map((l) => ({ ...l, count: counts[l.id] || 0 })),
  });
}));

// ── sources ───────────────────────────────────────────────────────────────
router.get('/sources', ah(async (req, res) => {
  const wid = req.workspaceId;
  const [sources, grouped] = await Promise.all([
    prisma.listingSource.findMany({ where: { workspaceId: wid }, orderBy: { createdAt: 'asc' } }),
    prisma.listing.groupBy({ by: ['sourceId'], where: { workspaceId: wid, droppedAt: null }, _count: { _all: true } }),
  ]);
  const countBy = new Map(grouped.map((g) => [g.sourceId, g._count._all]));
  res.json({ sources: sources.map((s) => ({ ...s, count: countBy.get(s.id) || 0 })), lanes: shape.LANES });
}));

router.post('/sources', ah(async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['own', 'mls', 'idx', 'brokerage_site', 'csv', 'development', 'pocket', 'whisper']).default('mls'),
    url: z.string().trim().max(1000).optional().nullable(),
    color: z.string().trim().max(20).optional(),
  }), req.body || {});
  const source = await prisma.listingSource.create({
    data: { workspaceId: req.workspaceId, name: body.name, kind: body.kind, url: body.url ? body.url.replace(/^https?:\/\//, '') : null, color: body.color || SOURCE_FOR_LANE[Object.keys(SOURCE_FOR_LANE).find((k) => SOURCE_FOR_LANE[k].kind === body.kind)]?.color || '#5856D6' },
  });
  res.json({ source: { ...source, count: 0 } });
}));

// ── parse ─────────────────────────────────────────────────────────────────
router.post('/parse', ah(async (req, res) => {
  const body = parse(z.object({
    text: z.string().max(20000).optional().nullable(),
    url: z.string().max(2000).optional().nullable(),
    mode: z.enum(['listing', 'whisper', 'pocket', 'newdev', 'mine', 'mls']).optional(),
  }), req.body || {});
  if (!body.text && !body.url) throw new HttpError(400, 'Paste a link or some text to read');
  const out = await parseListing({ workspaceId: req.workspaceId, text: body.text, url: body.url, mode: body.mode === 'whisper' ? 'whisper' : 'listing' });
  res.json(out);
}));

// ── detail ────────────────────────────────────────────────────────────────
router.get('/:id', ah(async (req, res) => {
  const l = await loadListing(req.workspaceId, req.params.id);
  res.json({ listing: await detailFor(req.workspaceId, l) });
}));

// ── create ────────────────────────────────────────────────────────────────
router.post('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const body = parse(listingInput, req.body || {});
  const lane = body.lane || (body.origin === 'whisper' ? 'whisper' : body.isOwnListing ? 'mine' : 'mls');
  const def = SOURCE_FOR_LANE[lane];
  const source = body.sourceId
    ? await prisma.listingSource.findFirst({ where: { id: body.sourceId, workspaceId: wid } })
    : await sourceForLane(wid, lane);
  const data = cleanData(body);
  data.sourceId = source ? source.id : null;
  data.origin = body.origin || def.origin;
  data.isOwnListing = body.isOwnListing ?? lane === 'mine';
  if (data.hideAddress == null) data.hideAddress = lane === 'pocket' || lane === 'whisper';
  if (!data.status) data.status = lane === 'whisper' ? 'coming_soon' : 'active';
  if (data.listPrice && !data.originalListPrice) data.originalListPrice = data.listPrice;
  if (!data.listedAt && (data.status === 'active' || data.status === 'coming_soon') && lane !== 'whisper') data.listedAt = new Date();
  if (data.photoUrls && data.photoUrls.length && !data.heroPhoto) data.heroPhoto = data.photoUrls[0];
  if (data.ownerClientId) {
    const owner = await prisma.client.findFirst({ where: { id: data.ownerClientId, workspaceId: wid }, select: { id: true } });
    if (!owner) data.ownerClientId = null;
  }
  const created = await prisma.listing.create({ data: { workspaceId: wid, ...data } });
  if (lane !== 'whisper' && lane !== 'mls') await ensureSlug(created);
  if (data.listPrice) await prisma.listingPriceEvent.create({ data: { listingId: created.id, fromPrice: 0, toPrice: data.listPrice, changedAt: new Date() } }).catch(() => {});
  const l = await loadListing(wid, created.id);
  // scored immediately; persisted + match_new / notify for hot matches
  await engine.rescoreListing(wid, l, { notifyHot: true }).catch((err) => console.error('[listings] score on create failed', err));
  const buyers = await feeds.buyersForListing(wid, l, { fallback: lane === 'whisper' });
  broadcast(wid, l, { created: true });
  res.status(201).json({ listing: await detailFor(wid, l), buyers });
}));

// ── update ────────────────────────────────────────────────────────────────
async function applyUpdate(wid, prior, data) {
  const now = new Date();
  const tz = await tzFor(wid);
  if (data.listPrice != null && prior.listPrice && data.listPrice !== prior.listPrice) {
    Object.assign(data, priceChangeFields(prior, data.listPrice, now, tz));
    await recordPriceEvent(prior.id, prior.listPrice, data.listPrice, now, tz);
  } else if (data.listPrice != null && !prior.listPrice) {
    if (!prior.originalListPrice) data.originalListPrice = data.listPrice;
    await prisma.listingPriceEvent.create({ data: { listingId: prior.id, fromPrice: 0, toPrice: data.listPrice, changedAt: now } }).catch(() => {});
  }
  if (data.status && data.status !== prior.status) {
    if (data.status === 'sold' && !prior.soldAt) data.soldAt = now;
    if ((data.status === 'active' || data.status === 'coming_soon') && !prior.listedAt) data.listedAt = now;
  }
  if (data.photoUrls && !data.heroPhoto && (!prior.heroPhoto || !data.photoUrls.includes(prior.heroPhoto))) data.heroPhoto = data.photoUrls[0] || null;
  await prisma.listing.update({ where: { id: prior.id }, data });
  const l = await loadListing(wid, prior.id);
  broadcast(wid, l);
  engine.scheduleRescore(wid, { listingId: l.id, delay: 300 });
  return l;
}

router.patch('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const prior = await loadListing(wid, req.params.id);
  const body = parse(listingInput, req.body || {});
  const data = cleanData(body);
  delete data.origin; delete data.sourceId;
  if (body.lane) {
    const lane = body.lane;
    const source = await sourceForLane(wid, lane);
    data.sourceId = source.id;
    data.origin = SOURCE_FOR_LANE[lane].origin;
    data.isOwnListing = lane === 'mine';
  }
  const l = await applyUpdate(wid, prior, data);
  res.json({ listing: await detailFor(wid, l) });
}));

router.post('/:id/status', ah(async (req, res) => {
  const wid = req.workspaceId;
  const prior = await loadListing(wid, req.params.id);
  const body = parse(z.object({
    status: z.enum(['coming_soon', 'active', 'under_contract', 'pending', 'sold', 'withdrawn', 'expired', 'off_market']),
    listPrice: int, closePrice: int,
  }), req.body || {});
  const data = { status: body.status };
  if (body.listPrice != null) data.listPrice = body.listPrice;
  if (body.closePrice != null) data.closePrice = body.closePrice;
  const l = await applyUpdate(wid, prior, data);
  res.json({ listing: await detailFor(wid, l) });
}));

router.post('/:id/photos', ah(async (req, res) => {
  const wid = req.workspaceId;
  const prior = await loadListing(wid, req.params.id);
  const body = parse(z.object({ urls: z.array(z.string().min(1).max(2000)).max(60).default([]), cover: z.string().max(2000).optional().nullable(), replace: z.boolean().optional() }), req.body || {});
  const photos = body.replace ? body.urls : [...(prior.photoUrls || []), ...body.urls.filter((u) => !(prior.photoUrls || []).includes(u))];
  const data = { photoUrls: photos };
  if (body.cover) data.heroPhoto = body.cover;
  else if (!prior.heroPhoto && photos[0]) data.heroPhoto = photos[0];
  await prisma.listing.update({ where: { id: prior.id }, data });
  const l = await loadListing(wid, prior.id);
  broadcast(wid, l);
  res.json({ listing: await detailFor(wid, l) });
}));

router.post('/:id/share', ah(async (req, res) => {
  const wid = req.workspaceId;
  const l = await loadListing(wid, req.params.id);
  if (l.origin === 'whisper') throw new HttpError(400, 'Whispers stay private — add it as a pocket listing to share it');
  const slug = await ensureSlug(l);
  res.json({ slug, url: publicUrl(slug) });
}));

router.delete('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const l = await loadListing(wid, req.params.id);
  await prisma.listing.delete({ where: { id: l.id } });
  hub.broadcast(wid, 'listing_updated', { id: l.id, deleted: true });
  res.json({ ok: true });
}));

module.exports = router;

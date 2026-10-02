// /api/matchmaker — buyer ↔ home matching.
//
//   GET  /feed?mode=listings|whisper|offmarket|drops      → mode feed (see services/matchmaker/feeds.js)
//   GET  /people?min=80&offmarket=1                       → { people, threshold }   one row per person
//   GET  /hot?min=90&limit=                               → { people }              hottest digest (Serena)
//   GET  /recent?sinceDays=7&minScore=80                  → { matches }             persisted recent matches
//   GET  /client/:clientId?min=65                         → best matches per BuyerSearch (+ owned-home demand)
//   GET  /listing/:id/buyers?fallback=1                   → { threshold, fallback, shown, hiddenCount, closest }
//   GET  /whispers                                        → { whispers }
//   POST /whispers   { note, photoUrls? }                 → { listing, buyers, parsed }
//   POST /draft      { clientId, mode, listingId?, propertyId? } → { text, ai, mode, channel }
//   POST /feedback   { event, matchId? | clientId + (listingId | propertyId) , meta? } → { ok, match }
//   POST /rescore                                         → { result }
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse } = require('../lib/http');
const mm = require('../services/matchmaker');
const feeds = require('../services/matchmaker/feeds');
const engine = require('../services/matchmaker/engine');
const { draftText } = require('../services/matchmaker/draft');
const { parseListing } = require('../services/listings/parse');
const shape = require('../services/listings/shape');
const { MATCH_CONFIG, scoreListingForSearch } = require('../services/matchmaker/score');
const { getDemandPool } = require('../services/matchmaker/pool');
const { logActivity } = require('../lib/activity');

const router = express.Router();

router.get('/feed', ah(async (req, res) => {
  const mode = String(req.query.mode || 'listings');
  const wid = req.workspaceId;
  if (mode === 'whisper') return res.json(await feeds.whisperFeed(wid));
  if (mode === 'offmarket') return res.json(await feeds.offMarketFeed(wid));
  if (mode === 'drops') return res.json(await feeds.dropsFeed(wid, { windowDays: Math.min(90, parseInt(req.query.days, 10) || 21) }));
  return res.json(await feeds.listingsFeed(wid));
}));

router.get('/people', ah(async (req, res) => {
  const min = Math.max(1, Math.min(100, parseInt(req.query.min, 10) || MATCH_CONFIG.showThreshold));
  const people = await feeds.peopleRows(req.workspaceId, { minScore: min, includeOffMarket: req.query.offmarket === '1' });
  res.json({ people, threshold: min });
}));

router.get('/hot', ah(async (req, res) => {
  const min = Math.max(1, Math.min(100, parseInt(req.query.min, 10) || MATCH_CONFIG.hotThreshold));
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
  const people = await mm.hottest({ workspaceId: req.workspaceId, minScore: min, limit });
  res.json({ people, threshold: min });
}));

router.get('/recent', ah(async (req, res) => {
  const matches = await mm.getRecentMatches({
    workspaceId: req.workspaceId,
    sinceDays: Math.min(90, parseInt(req.query.sinceDays, 10) || 7),
    minScore: Math.max(1, parseInt(req.query.minScore, 10) || MATCH_CONFIG.showThreshold),
    limit: Math.min(200, parseInt(req.query.limit, 10) || 50),
  });
  res.json({ matches });
}));

router.get('/client/:clientId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, workspaceId: wid }, select: { id: true, firstName: true, lastName: true, displayName: true } });
  if (!client) throw new HttpError(404, 'Client not found');
  const min = Math.max(1, Math.min(100, parseInt(req.query.min, 10) || MATCH_CONFIG.contactThreshold));
  const out = await mm.clientMatches({ workspaceId: wid, clientId: client.id, minScore: min });
  res.json({ client: { id: client.id, name: client.displayName || [client.firstName, client.lastName].filter(Boolean).join(' ') }, ...out });
}));

router.get('/listing/:id/buyers', ah(async (req, res) => {
  const wid = req.workspaceId;
  const l = await prisma.listing.findFirst({ where: { id: req.params.id, workspaceId: wid }, include: engine.LISTING_INCLUDE });
  if (!l) throw new HttpError(404, 'Listing not found');
  const fallback = req.query.fallback === '1' || l.origin === 'whisper';
  res.json(await feeds.buyersForListing(wid, l, { fallback }));
}));

// ── whispers ──────────────────────────────────────────────────────────────
router.get('/whispers', ah(async (req, res) => {
  res.json(await feeds.whisperFeed(req.workspaceId));
}));

router.post('/whispers', ah(async (req, res) => {
  const wid = req.workspaceId;
  const body = parse(z.object({
    note: z.string().trim().max(6000).optional().default(''),
    photoUrls: z.array(z.string().min(1).max(2000)).max(20).optional().default([]),
    fields: z.record(z.any()).optional(),
  }), req.body || {});
  if (!body.note && !body.photoUrls.length && !body.fields) throw new HttpError(400, 'Drop the whisper first — a note or a photo');
  const t0 = Date.now();
  const parsed = body.note ? await parseListing({ workspaceId: wid, text: body.note, mode: 'whisper' }) : { fields: {}, confidence: {}, ai: false };
  const f = { ...parsed.fields, ...(body.fields || {}) };
  if (!f.neighborhood && !f.buildingName && !f.city && !f.market && !f.beds && !f.propertyType && !f.waterfront && !f.street) {
    throw new HttpError(422, "Couldn't place that one — name a neighborhood, building or the kind of home (e.g. \"5BR waterfront in Bal Harbour\")");
  }
  let source = await prisma.listingSource.findFirst({ where: { workspaceId: wid, kind: 'whisper' } });
  if (!source) source = await prisma.listingSource.create({ data: { workspaceId: wid, name: 'Whispers', kind: 'whisper', color: '#30D27A' } });
  const allowed = ['street', 'unitNumber', 'city', 'state', 'postalCode', 'neighborhood', 'buildingName', 'market', 'developmentName', 'propertyType', 'priceGuide',
    'beds', 'bathsTotal', 'livingAreaSqft', 'lotSqft', 'yearBuilt', 'yearRenovated', 'stories', 'garageSpaces', 'architecturalStyle', 'waterfront', 'waterFrontageFt',
    'dockLengthFt', 'views', 'amenities', 'hoaFee', 'taxAnnual', 'mlsNumber', 'eta', 'whisperSource', 'headline'];
  const data = {};
  for (const k of allowed) if (f[k] != null && f[k] !== '') data[k] = f[k];
  if (data.lotSqft) data.lotAcres = Math.round((data.lotSqft / 43560) * 100) / 100;
  // market fallback from the workspace so location scoring has something to read
  if (!data.market) {
    const ws = await prisma.workspace.findUnique({ where: { id: wid }, select: { market: true } });
    if (ws && ws.market) data.market = ws.market;
  }
  const listing = await prisma.listing.create({
    data: {
      workspaceId: wid, sourceId: source.id, origin: 'whisper', status: 'coming_soon', hideAddress: true,
      description: body.note || null, photoUrls: body.photoUrls, heroPhoto: body.photoUrls[0] || null,
      confidence: parsed.confidence || null, ...data,
    },
    include: engine.LISTING_INCLUDE,
  });
  await engine.rescoreListing(wid, listing, { notifyHot: true }).catch((err) => console.error('[whisper] score failed', err));
  const buyers = await feeds.buyersForListing(wid, listing, { fallback: true });
  hub.broadcast(wid, 'listing_updated', { id: listing.id, listing: shape.cardShape(listing), created: true });
  // the scan overlay is cosmetic; keep a short minimum so it reads as work
  const wait = 900 - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  res.status(201).json({ listing: shape.detailShape(listing), buyers, parsed: { fields: parsed.fields, confidence: parsed.confidence, ai: parsed.ai } });
}));

// ── draft a text ──────────────────────────────────────────────────────────
router.post('/draft', ah(async (req, res) => {
  const wid = req.workspaceId;
  const body = parse(z.object({
    clientId: z.string().min(1),
    mode: z.enum(['listing', 'just_listed', 'price_drop', 'whisper', 'offmarket_owner', 'offmarket_buyer']).default('listing'),
    listingId: z.string().optional().nullable(),
    propertyId: z.string().optional().nullable(),
    matchId: z.string().optional().nullable(),
  }), req.body || {});
  const client = await prisma.client.findFirst({ where: { id: body.clientId, workspaceId: wid }, select: { id: true, firstName: true, lastName: true, displayName: true } });
  if (!client) throw new HttpError(404, 'Client not found');
  let listing = null; let property = null; let result = null;
  if (body.listingId) {
    listing = await prisma.listing.findFirst({ where: { id: body.listingId, workspaceId: wid }, include: engine.LISTING_INCLUDE });
    if (!listing) throw new HttpError(404, 'Listing not found');
  }
  if (body.propertyId) {
    property = await prisma.portfolioProperty.findFirst({ where: { id: body.propertyId, workspaceId: wid } });
    if (!property) throw new HttpError(404, 'Property not found');
  }
  let mode = body.mode === 'just_listed' ? 'listing' : body.mode;
  if (listing && mode === 'listing' && listing.origin === 'whisper') mode = 'whisper';
  if (listing && mode === 'price_drop' && !(listing.previousPrice > listing.listPrice)) mode = 'listing';
  // the fit behind the draft (best of this client's searches)
  const subject = listing || (property ? require('../services/matchmaker/offmarket').propertyAsListing(property) : null);
  if (subject && mode !== 'offmarket_owner') {
    const pool = await getDemandPool(wid);
    for (const e of pool.entries.filter((x) => x.clientId === client.id)) {
      const r = scoreListingForSearch(subject, e.search, { extraMustHaves: e.extraMustHaves });
      if (!r.gated && (!result || r.score > result.score)) result = r;
    }
  }
  const out = await draftText({ workspaceId: wid, userId: req.userId, clientId: client.id, mode, listing, property, result });
  // remember the draft on the match row (the watch job flips it to "sent" when an outbound text follows)
  const subjectKey = listing ? listing.id : property ? `pp:${property.id}` : null;
  const matchClientId = mode === 'offmarket_owner' ? null : client.id;
  if (subjectKey && matchClientId) {
    const m = await prisma.match.findFirst({ where: { workspaceId: wid, subjectKey, clientId: matchClientId } });
    if (m) {
      const meta = m.factors && typeof m.factors === 'object' ? m.factors : {};
      await prisma.match.update({ where: { id: m.id }, data: { draftText: out.text, status: m.status === 'new' ? 'seen' : m.status, factors: { ...meta, draftedAt: new Date().toISOString() } } });
    }
    await prisma.matchFeedback.create({ data: { workspaceId: wid, matchId: m ? m.id : null, clientId: client.id, listingId: listing ? listing.id : null, event: 'drafted', meta: { mode, ai: out.ai } } }).catch(() => {});
  }
  res.json(out);
}));

// ── feedback / telemetry ──────────────────────────────────────────────────
const EVENT_STATUS = { dismissed: 'dismissed', sent: 'sent', interested: 'interested', toured: 'toured', undismissed: 'new' };

router.post('/feedback', ah(async (req, res) => {
  const wid = req.workspaceId;
  const body = parse(z.object({
    event: z.enum(['shown', 'opened', 'drafted', 'sent', 'dismissed', 'undismissed', 'thumbs_up', 'thumbs_down', 'interested', 'toured']),
    matchId: z.string().optional().nullable(),
    clientId: z.string().optional().nullable(),
    listingId: z.string().optional().nullable(),
    propertyId: z.string().optional().nullable(),
    score: z.number().optional().nullable(),
    meta: z.record(z.any()).optional().nullable(),
  }), req.body || {});
  let match = null;
  if (body.matchId) match = await prisma.match.findFirst({ where: { id: body.matchId, workspaceId: wid } });
  const subjectKey = match ? match.subjectKey : body.listingId || (body.propertyId ? `pp:${body.propertyId}` : null);
  const clientId = match ? match.clientId : body.clientId;
  if (!match && subjectKey && clientId) match = await prisma.match.findFirst({ where: { workspaceId: wid, subjectKey, clientId } });
  const status = EVENT_STATUS[body.event];
  if (status) {
    if (!subjectKey || !clientId) throw new HttpError(400, 'Which match? Pass matchId or clientId + listingId/propertyId');
    const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: wid }, select: { id: true } });
    if (!client) throw new HttpError(404, 'Client not found');
    const stamp = body.event === 'dismissed' ? { dismissedAt: new Date() } : body.event === 'sent' ? { sentAt: new Date() } : body.event === 'undismissed' ? { dismissedAt: null } : {};
    if (match) {
      match = await prisma.match.update({ where: { id: match.id }, data: { status, ...stamp } });
    } else {
      match = await prisma.match.create({
        data: {
          workspaceId: wid, clientId, subjectKey, status, ...stamp,
          listingId: body.listingId || null, propertyId: body.propertyId || null,
          kind: body.propertyId ? 'offmarket' : 'listing', score: Math.round(body.score || 0),
        },
      });
    }
    if (body.event === 'sent') {
      logActivity({ workspaceId: wid, clientId, listingId: match.listingId || null, type: 'match', title: 'Match sent', body: match.summary || null, meta: { matchId: match.id, score: match.score }, actor: 'agent' });
    }
  }
  await prisma.matchFeedback.create({ data: { workspaceId: wid, matchId: match ? match.id : null, clientId: clientId || null, listingId: body.listingId || (match && match.listingId) || null, event: body.event, meta: body.meta || null } });
  res.json({ ok: true, match: match ? { id: match.id, status: match.status } : null });
}));

router.post('/rescore', ah(async (req, res) => {
  const result = await mm.rescoreWorkspace(req.workspaceId, {});
  res.json({ result });
}));

module.exports = router;

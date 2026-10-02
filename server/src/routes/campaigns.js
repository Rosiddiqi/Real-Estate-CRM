// /api/campaigns — text campaigns, default automations, the Sender Guard and
// the approval queue. Every query is workspace-scoped. Sends never happen in a
// request: launch lays out the queue and the engine sends through the guard.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse } = require('../lib/http');
const { clientName } = require('../lib/clients');
const engine = require('../services/campaigns/engine');
const guard = require('../services/campaigns/senderGuard');
const audienceSvc = require('../services/campaigns/audience');
const automations = require('../services/campaigns/automations');
const suggestions = require('../services/campaigns/suggestions');
const replies = require('../services/campaigns/replies');
const templates = require('../services/campaigns/templates');
const drafter = require('../services/campaigns/drafter');
const seq = require('../services/campaigns/sequence');
const store = require('../services/campaigns/settingsStore');
const ics = require('../services/campaigns/ics');
const Q = require('../services/campaigns/queue');
const { statsFor, refreshCached, bucketOf } = require('../services/campaigns/stats');
const { TEMPLATES, accentFor, LANES } = require('../services/campaigns/constants');

const router = express.Router();

function emit(workspaceId, payload) {
  hub.broadcast(workspaceId, 'campaign_updated', { ...payload, at: new Date().toISOString() });
}

async function getCampaign(workspaceId, id) {
  const c = await prisma.campaign.findFirst({ where: { id, workspaceId } });
  if (!c) throw new HttpError(404, 'Campaign not found');
  return c;
}

function listingCard(l) {
  if (!l) return null;
  const f = drafter.listingFacts(l);
  return {
    id: l.id, address: f.address, street: f.street, neighborhood: f.neighborhood, city: l.city, price: l.listPrice, priceLabel: f.price,
    specs: f.specs, beds: l.beds, baths: l.bathsTotal, sqft: l.livingAreaSqft, photo: f.photo, status: l.status, origin: l.origin, offMarket: f.offMarket,
  };
}

function builderOf(c) {
  const a = c.audience && typeof c.audience === 'object' ? c.audience : {};
  return a._builder && typeof a._builder === 'object' ? a._builder : {};
}

function shape(c, stats, extra = {}) {
  const run = (c.stats && c.stats.run) || {};
  const tpl = TEMPLATES[c.trigger] || null;
  const step0 = Array.isArray(c.steps) && c.steps[0] ? c.steps[0] : {};
  return {
    id: c.id, name: c.name, kind: c.kind, trigger: c.trigger, status: c.status,
    phase: stats ? stats.phase || c.status : c.status,
    template: tpl ? { key: tpl.key, label: tpl.label, icon: tpl.icon } : null,
    accent: accentFor(c),
    audience: audienceSvc.normalizeAudience(c.audience),
    audienceSummary: audienceSvc.describeAudience(c.audience),
    brief: c.brief || '', steps: Array.isArray(c.steps) ? c.steps : [],
    listingId: step0.listingId || null, includePhoto: !!step0.includePhoto, attachment: step0.attachment || null,
    lanes: c.lanes || null, event: c.event || null, pacing: c.pacing,
    stats: stats || null,
    schedule: { startAt: run.startAt || null, endAt: run.endAt || null, pausedAt: run.pausedAt || null, canceledAt: run.canceledAt || null },
    builder: builderOf(c),
    launchedAt: c.launchedAt, completedAt: c.completedAt, createdAt: c.createdAt, updatedAt: c.updatedAt,
    ...extra,
  };
}

// ── Collections & system ───────────────────────────────────────────────
router.get('/', ah(async (req, res) => {
  const rows = await prisma.campaign.findMany({
    where: { workspaceId: req.workspaceId, kind: { not: 'automation' } },
    orderBy: [{ updatedAt: 'desc' }], take: 200,
  });
  const stats = await statsFor(rows);
  const listingIds = [...new Set(rows.map((c) => Array.isArray(c.steps) && c.steps[0] && c.steps[0].listingId).filter(Boolean))];
  const listings = listingIds.length ? await prisma.listing.findMany({ where: { workspaceId: req.workspaceId, id: { in: listingIds } } }) : [];
  const byId = new Map(listings.map((l) => [l.id, l]));
  const campaigns = rows.map((c) => shape(c, stats.get(c.id), { listing: listingCard(byId.get(Array.isArray(c.steps) && c.steps[0] ? c.steps[0].listingId : null)) }));
  res.json({ campaigns, total: campaigns.length });
}));

router.get('/templates', ah(async (req, res) => { res.json({ templates: templates.catalog() }); }));

router.get('/sender-guard', ah(async (req, res) => { res.json(await guard.status(req.workspaceId)); }));

async function pauseState(workspaceId) {
  const pausedAt = await store.getKey(workspaceId, 'aiTextingPausedAt');
  const heldCount = pausedAt ? await prisma.campaignRecipient.count({ where: { workspaceId, nextSendAt: { not: null } } }) : 0;
  return { paused: !!pausedAt, pausedAt: pausedAt || null, heldCount };
}
router.get('/ai-pause', ah(async (req, res) => { res.json(await pauseState(req.workspaceId)); }));
router.put('/ai-pause', ah(async (req, res) => {
  const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
  await store.setKey(req.workspaceId, 'aiTextingPausedAt', paused ? new Date().toISOString() : null);
  const out = await pauseState(req.workspaceId);
  emit(req.workspaceId, { kind: 'ai_pause', paused });
  res.json(out);
}));

// ── Automations ────────────────────────────────────────────────────────
router.get('/automations', ah(async (req, res) => {
  res.json({ automations: await automations.listAutomations(req.workspaceId) });
}));
router.patch('/automations/:id', ah(async (req, res) => {
  const patch = parse(z.object({
    enabled: z.boolean().optional(), name: z.string().max(120).optional(), brief: z.string().max(2000).optional(),
    steps: z.array(z.object({ dayOffset: z.number().optional(), label: z.string().nullable().optional(), instructions: z.string().max(1000).optional(), includePhoto: z.boolean().optional() })).max(8).optional(),
    approval: z.enum(['auto', 'draft']).optional(), minScore: z.number().optional(), leadDays: z.number().optional(),
    lanes: z.record(z.any()).optional(),
  }), req.body);
  await automations.updateAutomation({ workspaceId: req.workspaceId, id: req.params.id, patch });
  const list = await automations.listAutomations(req.workspaceId);
  res.json({ automation: list.find((a) => a.id === req.params.id) || null });
}));
router.post('/automations/run', ah(async (req, res) => {
  res.json({ enrolled: await automations.runTriggers(req.workspaceId) });
}));

// Campaign-born threads still waiting for a reply (the inbox's Automations lane),
// grouped by the campaign/automation that opened them.
router.get('/live-threads', ah(async (req, res) => {
  const ws = req.workspaceId;
  const convs = await prisma.conversation.findMany({
    where: { workspaceId: ws, lane: 'automations', archived: false },
    orderBy: { lastMessageAt: 'desc' }, take: 150,
    include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, deviceMode: true, isWhale: true } } },
  });
  const ids = convs.map((c) => c.id);
  const lastCampaignMsgs = ids.length ? await prisma.message.findMany({
    where: { conversationId: { in: ids }, campaignId: { not: null }, isFromMe: true },
    orderBy: { sentAt: 'desc' }, select: { conversationId: true, campaignId: true, campaignRecipientId: true, sentAt: true, body: true },
  }) : [];
  const srcByConv = new Map();
  for (const m of lastCampaignMsgs) if (!srcByConv.has(m.conversationId)) srcByConv.set(m.conversationId, m);
  const campIds = [...new Set(lastCampaignMsgs.map((m) => m.campaignId))];
  const camps = campIds.length ? await prisma.campaign.findMany({ where: { workspaceId: ws, id: { in: campIds } } }) : [];
  const campById = new Map(camps.map((c) => [c.id, c]));
  const recIds = [...new Set(lastCampaignMsgs.map((m) => m.campaignRecipientId).filter(Boolean))];
  const recs = recIds.length ? await prisma.campaignRecipient.findMany({ where: { id: { in: recIds } }, select: { id: true, status: true, lane: true, lastSentAt: true, repliedAt: true, nextSendAt: true } }) : [];
  const recById = new Map(recs.map((r) => [r.id, r]));
  const groups = new Map();
  for (const conv of convs) {
    const src = srcByConv.get(conv.id);
    const camp = src ? campById.get(src.campaignId) : null;
    const key = camp ? camp.id : 'other';
    if (!groups.has(key)) {
      groups.set(key, {
        source: camp ? { id: camp.id, name: camp.name, kind: camp.kind, trigger: camp.trigger, status: camp.status, accent: accentFor(camp), type: camp.kind === 'automation' ? 'automation' : 'campaign' }
          : { id: 'other', name: 'Other automated texts', kind: 'other', accent: '#9AA7B8', type: 'campaign' },
        threads: [],
      });
    }
    const rec = src && src.campaignRecipientId ? recById.get(src.campaignRecipientId) : null;
    groups.get(key).threads.push({
      conversationId: conv.id, clientId: conv.clientId, name: conv.client ? clientName(conv.client) : (conv.displayName || conv.handle),
      avatarUrl: conv.client && conv.client.avatarUrl, channel: conv.channel === 'sms' ? 'sms' : 'imessage', isWhale: !!(conv.client && conv.client.isWhale),
      lastMessageAt: conv.lastMessageAt, preview: conv.lastMessagePreview || (src && src.body) || '', unreadCount: conv.unreadCount,
      recipientId: rec ? rec.id : null, status: rec ? rec.status : null, nextSendAt: rec ? rec.nextSendAt : null, sentAt: src ? src.sentAt : null,
    });
  }
  const list = [...groups.values()].sort((a, b) => new Date(b.threads[0].lastMessageAt || 0) - new Date(a.threads[0].lastMessageAt || 0));
  res.json({ groups: list, total: convs.length });
}));

// ── Approval queue ─────────────────────────────────────────────────────
router.get('/suggestions', ah(async (req, res) => {
  res.json({ suggestions: await suggestions.listSuggestions(req.workspaceId, { campaignId: req.query.campaignId || undefined }) });
}));
router.post('/suggestions/:id/approve', ah(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().max(1200).optional() }), req.body || {});
  res.json(await suggestions.approveSuggestion({ workspaceId: req.workspaceId, insightId: req.params.id, text }));
}));
router.post('/suggestions/:id/dismiss', ah(async (req, res) => {
  res.json(await suggestions.dismissSuggestion({ workspaceId: req.workspaceId, insightId: req.params.id }));
}));

// ── Audience ───────────────────────────────────────────────────────────
router.get('/audience/options', ah(async (req, res) => { res.json(await audienceSvc.audienceOptions(req.workspaceId)); }));
router.post('/audience/preview', ah(async (req, res) => {
  const a = audienceSvc.normalizeAudience(req.body && req.body.audience);
  const r = await audienceSvc.resolveAudience(req.workspaceId, a, { limit: Number(req.body && req.body.limit) || 400 });
  res.json({ ...r, summary: audienceSvc.describeAudience(a) });
}));
router.post('/audience/resolve', ah(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().min(1).max(500) }), req.body);
  const out = await audienceSvc.resolveFromText(req.workspaceId, text);
  if (out.rejected) throw new HttpError(400, out.rejected);
  res.json(out);
}));

router.post('/parse-lane', ah(async (req, res) => {
  const { text, lane, hasEvent } = parse(z.object({ text: z.string().max(1200), lane: z.enum(['green', 'yellow', 'red', 'gray', 'reminders']), hasEvent: z.boolean().optional() }), req.body);
  res.json(seq.parseSequence(text, lane === 'reminders' ? 'green' : lane, { hasEvent: !!hasEvent || lane === 'reminders' }));
}));

// ── Create / read / update / delete ────────────────────────────────────
const eventSchema = z.object({
  enabled: z.boolean().optional(), title: z.string().max(140).nullable().optional(), address: z.string().max(240).nullable().optional(),
  startAt: z.string().nullable().optional(), endAt: z.string().nullable().optional(), rsvp: z.boolean().optional(), calendarInvite: z.boolean().optional(),
}).nullable();

function cleanEvent(ev) {
  if (!ev) return null;
  const ok = (d) => (d && !Number.isNaN(new Date(d).getTime()) ? new Date(d).toISOString() : null);
  return {
    enabled: ev.enabled !== false, title: ev.title ? String(ev.title).trim() : null, address: ev.address ? String(ev.address).trim() : null,
    startAt: ok(ev.startAt), endAt: ok(ev.endAt), rsvp: ev.rsvp !== false, calendarInvite: ev.calendarInvite !== false,
  };
}

function cleanLanes(lanes, prev = {}) {
  if (!lanes || typeof lanes !== 'object') return prev;
  const out = { ...prev };
  for (const k of LANES) {
    if (!lanes[k]) continue;
    const l = lanes[k];
    out[k] = k === 'gray'
      ? { enabled: l.enabled !== false, timerText: String(l.timerText || '2 DAYS').slice(0, 20), timerHours: seq.timerTextToHours(l.timerText || '2 DAYS'), text: String(l.text || '').slice(0, 600) }
      : { enabled: l.enabled !== false, text: String(l.text || '').slice(0, 800), steps: Array.isArray(l.steps) ? l.steps.slice(0, 4).map((s) => ({ timing: s.timing || { kind: 'immediate' }, label: String(s.label || '').slice(0, 40), brief: String(s.brief || '').slice(0, 400) })) : [] };
  }
  if (lanes.aiReply) out.aiReply = { mode: ['draft', 'suggest'].includes(lanes.aiReply.mode) ? 'draft' : 'off', instructions: String(lanes.aiReply.instructions || '').slice(0, 1500) };
  if (lanes.reminders) {
    const r = lanes.reminders;
    out.reminders = { enabled: !!r.enabled, text: String(r.text || '').slice(0, 600), audience: r.audience === 'everyone' ? 'everyone' : 'green', steps: Array.isArray(r.steps) ? r.steps.slice(0, 4) : [] };
  }
  return out;
}

router.post('/', ah(async (req, res) => {
  const body = parse(z.object({
    name: z.string().max(120).optional(), trigger: z.string().max(40).optional(), listingId: z.string().optional().nullable(),
    clientIds: z.array(z.string()).max(500).optional(), audience: z.record(z.any()).optional(), brief: z.string().max(2000).optional(),
    event: eventSchema.optional(),
  }), req.body || {});
  const key = body.trigger && TEMPLATES[body.trigger] ? body.trigger : 'custom';
  const listing = body.listingId ? await prisma.listing.findFirst({ where: { id: body.listingId, workspaceId: req.workspaceId } }) : null;
  const tpl = TEMPLATES[key];
  const aud = audienceSvc.normalizeAudience({ ...(body.audience || templates.defaultAudience(key, listing)), ...(body.clientIds ? { clientIds: body.clientIds } : {}) });
  const hasEvent = key === 'open_house_invite';
  const name = body.name || (key === 'custom' ? 'New campaign' : `${tpl.label}${listing ? ` · ${drafter.listingFacts(listing).street || listing.neighborhood || ''}` : ''}`.replace(/ · $/, ''));
  const c = await prisma.campaign.create({
    data: {
      workspaceId: req.workspaceId, name: name.slice(0, 120), kind: 'blast', trigger: key, status: 'draft',
      audience: { ...aud, _builder: { stage: 0 } },
      brief: body.brief != null ? body.brief : templates.fillBrief(key, listing),
      steps: [{ dayOffset: 0, listingId: listing ? listing.id : null, includePhoto: !!(listing && (listing.heroPhoto || (listing.photoUrls || []).length)) }],
      lanes: templates.defaultLanes(key, { hasEvent }),
      event: body.event ? cleanEvent(body.event) : (hasEvent ? { enabled: true, title: listing ? `Open House · ${drafter.listingFacts(listing).street || ''}`.trim() : 'Open House', address: listing ? [listing.street, listing.city].filter(Boolean).join(', ') : null, startAt: null, endAt: null, rsvp: true, calendarInvite: true } : null),
      pacing: 'safe',
    },
  });
  emit(req.workspaceId, { campaignId: c.id, kind: 'created' });
  res.status(201).json({ campaign: shape(c, null, { listing: listingCard(listing) }) });
}));

router.get('/:id', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  const [stats, rows, sugg] = await Promise.all([
    statsFor([c]),
    prisma.campaignRecipient.findMany({
      where: { campaignId: c.id },
      orderBy: [{ repliedAt: { sort: 'desc', nulls: 'last' } }, { lastSentAt: { sort: 'desc', nulls: 'last' } }, { nextSendAt: { sort: 'asc', nulls: 'last' } }],
      take: 600,
    }),
    suggestions.listSuggestions(req.workspaceId, { campaignId: c.id }),
  ]);
  const clients = rows.length ? await prisma.client.findMany({ where: { workspaceId: req.workspaceId, id: { in: rows.map((r) => r.clientId) } }, select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, phone: true, deviceMode: true, isWhale: true, rating: true, textOptOut: true } }) : [];
  const byId = new Map(clients.map((x) => [x.id, x]));
  const recipients = rows.map((r) => {
    const cl = byId.get(r.clientId) || {};
    const m = Q.metaOf(r);
    const next = Q.sortQueue(Q.queueOf(r))[0] || null;
    return {
      id: r.id, clientId: r.clientId, name: clientName(cl), firstName: cl.firstName, avatarUrl: cl.avatarUrl, phone: cl.phone,
      channel: cl.deviceMode === 'sms' ? 'sms' : 'imessage', isWhale: !!cl.isWhale, rating: cl.rating || 0,
      status: r.status, lane: r.lane, bucket: bucketOf(r), stepIndex: r.stepIndex,
      lastSentAt: r.lastSentAt, repliedAt: r.repliedAt, nextSendAt: r.nextSendAt, nextKind: next ? next.kind : null,
      error: r.error, lastReply: m.lastReply || null, lastReplyKind: m.lastReplyKind || null, conversationId: m.conversationId || null,
      tier: m.tier || null, awaitingApproval: !!m.awaitingApproval, laneLockedByAgent: !!m.laneLockedByAgent,
      lastSend: (m.sends || []).slice(-1)[0] || null,
    };
  });
  const step0 = Array.isArray(c.steps) && c.steps[0] ? c.steps[0] : {};
  const listing = step0.listingId ? await prisma.listing.findFirst({ where: { id: step0.listingId, workspaceId: req.workspaceId } }) : null;
  const invite = ics.inviteEnabled(c) ? ics.inviteFile(c) : null;
  res.json({ campaign: shape(c, stats.get(c.id), { listing: listingCard(listing), invite }), recipients, suggestions: sugg });
}));

router.patch('/:id', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  const body = parse(z.object({
    name: z.string().max(120).optional(), brief: z.string().max(2000).optional(), trigger: z.string().max(40).optional(),
    applyTemplate: z.string().max(40).optional(), audience: z.record(z.any()).optional(), lanes: z.record(z.any()).optional(),
    event: eventSchema.optional(), pacing: z.enum(['safe', 'all_now']).optional(),
    listingId: z.string().nullable().optional(), includePhoto: z.boolean().optional(),
    attachment: z.object({ url: z.string(), fileName: z.string().optional(), mimeType: z.string().optional() }).nullable().optional(),
    builder: z.object({ stage: z.number().int().min(0).max(4).optional(), samples: z.array(z.any()).max(5).optional() }).optional(),
    schedule: z.object({ startAt: z.string().nullable().optional(), endAt: z.string().nullable().optional() }).optional(),
  }), req.body || {});
  const live = !['draft'].includes(c.status);
  const data = {};
  if (body.name != null) data.name = body.name.trim() || c.name;
  if (body.brief != null) data.brief = body.brief;
  if (body.pacing) data.pacing = body.pacing;
  const prevAud = c.audience && typeof c.audience === 'object' ? c.audience : {};
  if (body.audience || body.builder) {
    if (body.audience && live) throw new HttpError(409, 'The audience is locked once a campaign launches');
    const builder = { ...(prevAud._builder || {}), ...(body.builder || {}) };
    data.audience = { ...(body.audience ? audienceSvc.normalizeAudience(body.audience) : audienceSvc.normalizeAudience(prevAud)), ...(prevAud.approval ? { approval: prevAud.approval } : {}), _builder: builder };
  }
  const steps = Array.isArray(c.steps) && c.steps.length ? [...c.steps] : [{ dayOffset: 0 }];
  let stepsChanged = false;
  let listing = null;
  if (body.listingId !== undefined) {
    listing = body.listingId ? await prisma.listing.findFirst({ where: { id: body.listingId, workspaceId: req.workspaceId } }) : null;
    if (body.listingId && !listing) throw new HttpError(404, 'Listing not found');
    steps[0] = { ...steps[0], listingId: listing ? listing.id : null, ...(body.includePhoto === undefined ? { includePhoto: !!(listing && (listing.heroPhoto || (listing.photoUrls || []).length)) } : {}) };
    stepsChanged = true;
  }
  if (body.includePhoto !== undefined) { steps[0] = { ...steps[0], includePhoto: body.includePhoto }; stepsChanged = true; }
  if (body.attachment !== undefined) { steps[0] = { ...steps[0], attachment: body.attachment }; stepsChanged = true; }
  if (stepsChanged) {
    if (live) throw new HttpError(409, 'The message is locked once a campaign launches');
    data.steps = steps;
  }
  // A listing attached to an event campaign fills the event's blanks.
  if (listing && c.event && c.event.enabled !== false && body.event === undefined) {
    const ev = { ...c.event };
    const street = drafter.listingFacts(listing).street;
    if (!ev.address) ev.address = [listing.street, listing.unitNumber ? `#${listing.unitNumber}` : null, listing.city].filter(Boolean).join(', ') || null;
    if (!ev.title || ev.title === 'Open House') ev.title = `Open House${street ? ` · ${street}` : ''}`;
    data.event = ev;
  }
  const key = body.applyTemplate && TEMPLATES[body.applyTemplate] ? body.applyTemplate : null;
  if (key) {
    if (live) throw new HttpError(409, 'The message is locked once a campaign launches');
    const lid = steps[0] && steps[0].listingId;
    const l = listing || (lid ? await prisma.listing.findFirst({ where: { id: lid, workspaceId: req.workspaceId } }) : null);
    data.trigger = key;
    if (body.brief == null) data.brief = templates.fillBrief(key, l);
    const prevLanes = c.lanes || {};
    if (!prevLanes.customized) data.lanes = templates.defaultLanes(key, { hasEvent: key === 'open_house_invite' || !!(c.event && c.event.startAt) });
    if (key === 'open_house_invite' && !(c.event && c.event.enabled)) {
      data.event = { enabled: true, title: l ? `Open House · ${drafter.listingFacts(l).street || ''}`.trim() : 'Open House', address: l ? [l.street, l.city].filter(Boolean).join(', ') : null, startAt: null, endAt: null, rsvp: true, calendarInvite: true };
    }
    const autoNamed = !c.name || c.name === 'New campaign' || Object.values(TEMPLATES).some((t) => c.name === t.label || c.name.startsWith(`${t.label} · `));
    if (autoNamed && body.name == null) data.name = `${TEMPLATES[key].label}${l ? ` · ${drafter.listingFacts(l).street || l.neighborhood || ''}` : ''}`.replace(/ · $/, '');
  } else if (body.trigger && TEMPLATES[body.trigger]) data.trigger = body.trigger;
  if (body.lanes) data.lanes = { ...cleanLanes(body.lanes, c.lanes || {}), customized: true };
  if (body.event !== undefined) data.event = cleanEvent(body.event);
  if (body.schedule) {
    const run = { ...((c.stats && c.stats.run) || {}) };
    if (body.schedule.endAt !== undefined) {
      if (body.schedule.endAt && new Date(body.schedule.endAt) <= new Date()) throw new HttpError(400, 'The finish-by time is in the past');
      run.endAt = body.schedule.endAt || null;
    }
    if (body.schedule.startAt !== undefined && c.status === 'draft') run.startAt = body.schedule.startAt || null;
    data.stats = { ...(c.stats || {}), run };
  }
  const updated = await prisma.campaign.update({ where: { id: c.id }, data });
  // A live campaign's event or lanes moved: re-time what's still queued.
  if (live && (body.event !== undefined || body.lanes)) await retimeQueued(updated).catch((e) => console.error('[campaigns] retime failed:', e.message));
  emit(req.workspaceId, { campaignId: c.id, kind: 'updated' });
  const l = (Array.isArray(updated.steps) && updated.steps[0] && updated.steps[0].listingId) ? await prisma.listing.findFirst({ where: { id: updated.steps[0].listingId, workspaceId: req.workspaceId } }) : null;
  const stats = live ? (await statsFor([updated])).get(updated.id) : null;
  res.json({ campaign: shape(updated, stats, { listing: listingCard(l) }) });
}));

async function retimeQueued(c) {
  const { timezone } = await store.readSettings(c.workspaceId);
  const eventAt = c.event && c.event.startAt ? c.event.startAt : null;
  const lanes = c.lanes || {};
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id, nextSendAt: { not: null } }, select: { id: true, meta: true, lane: true } });
  for (const r of rows) {
    const m = Q.metaOf(r);
    const base = m.laneSetAt || new Date().toISOString();
    const q = Q.queueOf(r).map((i) => {
      if (i.kind === 'lane_step') {
        const step = ((lanes[r.lane] || {}).steps || [])[i.step || 0];
        return step ? { ...i, at: seq.resolveStepTime(step, { eventAt, base, tz: timezone }).toISOString() } : i;
      }
      if (i.kind === 'reminder_step' && eventAt) {
        const step = ((lanes.reminders || {}).steps || [])[i.step || 0];
        return step ? { ...i, at: seq.resolveStepTime(step, { eventAt, base: new Date(), tz: timezone }).toISOString() } : i;
      }
      return i;
    });
    await prisma.campaignRecipient.update({ where: { id: r.id }, data: Q.withQueue(m, q) }).catch(() => {});
  }
}

router.delete('/:id', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  if (c.kind === 'automation') throw new HttpError(400, 'Turn the automation off instead');
  if (c.status === 'running') throw new HttpError(409, 'Pause or stop the campaign first, then delete it');
  await prisma.aiInsight.updateMany({ where: { workspaceId: req.workspaceId, type: suggestions.TYPE, status: 'new', data: { path: ['campaignId'], equals: c.id } }, data: { status: 'dismissed' } }).catch(() => {});
  await prisma.campaign.delete({ where: { id: c.id } });
  emit(req.workspaceId, { campaignId: c.id, kind: 'deleted' });
  res.json({ ok: true });
}));

// ── Builder helpers ────────────────────────────────────────────────────
router.post('/:id/samples', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  const body = req.body || {};
  if (typeof body.brief === 'string' && c.status === 'draft' && body.brief !== c.brief) {
    await prisma.campaign.update({ where: { id: c.id }, data: { brief: body.brief } });
    c.brief = body.brief;
  }
  if (!String(c.brief || '').trim()) throw new HttpError(400, 'Tell your AI what to say first');
  const { people, count } = await audienceSvc.resolveAudience(req.workspaceId, c.audience, { limit: 400 });
  if (!people.length) throw new HttpError(400, 'Pick who should get this first');
  const pool = [...people];
  const picks = [];
  const want = Math.min(Number(body.count) || 3, 5);
  while (pool.length && picks.length < want) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const step0 = Array.isArray(c.steps) && c.steps[0] ? c.steps[0] : {};
  const listing = step0.listingId ? await prisma.listing.findFirst({ where: { id: step0.listingId, workspaceId: req.workspaceId } }) : null;
  const agent = await drafter.agentInfo(req.workspaceId);
  const clients = await prisma.client.findMany({ where: { workspaceId: req.workspaceId, id: { in: picks.map((p) => p.id) } } });
  const byId = new Map(clients.map((x) => [x.id, x]));
  const attempt = Number(body.attempt) || 0;
  const samples = await Promise.all(picks.map(async (p) => {
    const client = byId.get(p.id);
    const facts = await guard.recipientFacts({ workspaceId: req.workspaceId, client, now: new Date() }).catch(() => ({ cold: false }));
    const d = await drafter.draft({ workspaceId: req.workspaceId, campaign: c, client, kind: 'initial_send', listing, event: c.event && c.event.enabled !== false ? c.event : null, agent, tier: facts.cold ? 'cold' : 'existing', attempt });
    return { clientId: p.id, name: p.name, firstName: p.firstName, avatarUrl: p.avatarUrl, channel: p.channel, text: d.text, via: d.via, citations: d.citations, cold: !!facts.cold, photo: step0.includePhoto && !facts.cold && listing ? (listing.heroPhoto || (listing.photoUrls || [])[0] || null) : null };
  }));
  const aud = c.audience && typeof c.audience === 'object' ? c.audience : {};
  await prisma.campaign.update({ where: { id: c.id }, data: { audience: { ...aud, _builder: { ...(aud._builder || {}), samples } } } }).catch(() => {});
  res.json({ samples, poolSize: count });
}));

router.post('/:id/plan', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  const { people } = await audienceSvc.resolveAudience(req.workspaceId, c.audience, { limit: 5000 });
  if (!people.length) return res.json({ recipients: 0, guard: null });
  const clients = await prisma.client.findMany({ where: { workspaceId: req.workspaceId, id: { in: people.map((p) => p.id) } }, select: { id: true, phone: true, lastInboundAt: true, deviceMode: true } });
  const byId = new Map(clients.map((x) => [x.id, x]));
  const plan = await guard.planLaunch({ workspaceId: req.workspaceId, pacing: req.body && req.body.pacing ? req.body.pacing : c.pacing, baseMs: Date.now() + 5000, people: people.map((p) => ({ id: p.id, phone: p.phone, client: byId.get(p.id) })) });
  const last = plan.slots.length ? plan.slots[plan.slots.length - 1].at : null;
  res.json({
    recipients: people.length,
    guard: { coldCount: plan.coldCount, newCount: plan.newCount, existingCount: plan.existingCount, estimatedDays: plan.estimatedDays, dailyNewTarget: plan.dailyNewTarget, pace: plan.effectivePace, warmupStep: plan.warmupStep, lastSlotAt: last },
  });
}));

router.post('/:id/launch', ah(async (req, res) => {
  const body = parse(z.object({ startAt: z.string().nullable().optional(), endAt: z.string().nullable().optional() }), req.body || {});
  const out = await engine.launchCampaign({ workspaceId: req.workspaceId, campaignId: req.params.id, startAt: body.startAt || null, endAt: body.endAt || null });
  setTimeout(() => { engine.tick().catch(() => {}); }, 6000);
  res.json(out);
}));
router.post('/:id/pause', ah(async (req, res) => { res.json(await engine.pauseCampaign({ workspaceId: req.workspaceId, campaignId: req.params.id })); }));
router.post('/:id/resume', ah(async (req, res) => { res.json(await engine.resumeCampaign({ workspaceId: req.workspaceId, campaignId: req.params.id })); }));
router.post('/:id/stop', ah(async (req, res) => { res.json(await engine.stopCampaign({ workspaceId: req.workspaceId, campaignId: req.params.id })); }));

router.post('/:id/duplicate', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  if (c.kind === 'automation') throw new HttpError(400, 'Automations cannot be duplicated');
  const aud = c.audience && typeof c.audience === 'object' ? c.audience : {};
  const { _builder, ...audience } = aud;
  const ev = c.event && typeof c.event === 'object' ? { ...c.event } : null;
  if (ev && ev.startAt && new Date(ev.startAt) < new Date()) { ev.startAt = null; ev.endAt = null; }
  const copy = await prisma.campaign.create({
    data: {
      workspaceId: req.workspaceId, name: `${c.name} (copy)`.slice(0, 120), kind: c.kind, trigger: c.trigger, status: 'draft',
      audience: { ...audience, _builder: { stage: 0 } }, brief: c.brief, steps: c.steps || [], lanes: c.lanes || null, event: ev, pacing: c.pacing === 'all_now' ? 'all_now' : 'safe',
    },
  });
  emit(req.workspaceId, { campaignId: copy.id, kind: 'created' });
  res.status(201).json({ campaign: shape(copy, null) });
}));

router.get('/:id/invite', ah(async (req, res) => {
  const c = await getCampaign(req.workspaceId, req.params.id);
  const f = ics.inviteFile(c);
  if (!f) throw new HttpError(400, 'Set the event date and time first');
  res.json(f);
}));

// ── Recipient controls ─────────────────────────────────────────────────
router.patch('/:id/recipients/:rid/lane', ah(async (req, res) => {
  const { lane } = parse(z.object({ lane: z.enum(['green', 'yellow', 'red']) }), req.body);
  const c = await getCampaign(req.workspaceId, req.params.id);
  const row = await prisma.campaignRecipient.findFirst({ where: { id: req.params.rid, campaignId: c.id, workspaceId: req.workspaceId }, include: { campaign: true } });
  if (!row) throw new HttpError(404, 'Recipient not found');
  if (['opted_out', 'muted'].includes(row.status)) throw new HttpError(409, 'This person is not receiving texts');
  const { timezone } = await store.readSettings(req.workspaceId);
  const takenOver = row.status === 'taken_over';
  const data = replies.laneData({ row, lane, now: new Date(), tz: timezone, kind: takenOver ? 'question' : 'lane' });
  data.meta = { ...data.meta, laneLockedByAgent: true };
  await prisma.campaignRecipient.update({ where: { id: row.id }, data: { ...data, ...(takenOver ? {} : { status: row.lastSentAt ? (row.repliedAt ? 'replied' : 'sent') : row.status }) } });
  await refreshCached(c.id);
  emit(req.workspaceId, { campaignId: c.id, kind: 'lane', recipientId: row.id, lane });
  res.json({ ok: true });
}));

router.post('/:id/recipients/:rid/mute', ah(async (req, res) => {
  const { muted } = parse(z.object({ muted: z.boolean() }), req.body);
  const c = await getCampaign(req.workspaceId, req.params.id);
  const row = await prisma.campaignRecipient.findFirst({ where: { id: req.params.rid, campaignId: c.id, workspaceId: req.workspaceId } });
  if (!row) throw new HttpError(404, 'Recipient not found');
  const m = Q.metaOf(row);
  if (muted) {
    await prisma.campaignRecipient.update({ where: { id: row.id }, data: { status: 'muted', ...Q.withQueue({ ...m, mutedFrom: row.status }, []), error: 'Muted by you' } });
  } else {
    if (row.status !== 'muted') throw new HttpError(409, 'Not muted');
    const back = row.repliedAt ? 'replied' : row.lastSentAt ? 'sent' : 'pending';
    const q = !row.lastSentAt && ['running', 'scheduled'].includes(c.status) ? [Q.item('initial_send', new Date(Date.now() + 60000))] : [];
    const { mutedFrom, ...rest } = m;
    await prisma.campaignRecipient.update({ where: { id: row.id }, data: { status: back, ...Q.withQueue(rest, q), error: null } });
  }
  await refreshCached(c.id);
  emit(req.workspaceId, { campaignId: c.id, kind: 'mute', recipientId: row.id, muted });
  res.json({ ok: true, muted });
}));

module.exports = router;

// /api/clients — the client book (clients · partners · vendors), the client
// card's data, notes, household links, block, AI summary + briefing.
//
//   GET    /api/clients?search=&kind=client|partner|vendor&status=&type=&sort=az|newest|recent&limit=&page=&withCounts=1
//          → { clients, total, counts? }   (search: name · phone digits · email · company · neighborhood)
//   GET    /api/clients/facets            → { leadSources, tags, neighborhoods, vendorRoles, partnerRoles }
//   GET    /api/clients/lookup?phone=&email=&excludeId= → { client|null }  (duplicate detection)
//   GET    /api/clients/:id               → { client }  (+ properties, searches, links, referrals, deals, counts, stats)
//   POST   /api/clients                   → 201 { client }  | 200 { client, duplicate:true } when the phone exists
//   PATCH  /api/clients/:id               → { client }   (`personal` merges; null deletes a key)
//   DELETE /api/clients/:id               → { ok, client }  soft delete (archivedAt)
//   POST   /api/clients/:id/restore       → { client }
//   POST   /api/clients/:id/block | /unblock → { client }
//   GET    /api/clients/:id/activity?limit= → { activity, total }  merged feed (activity · calls · showings · deals · notes)
//   GET/POST /api/clients/:id/notes, PATCH/DELETE /api/clients/:id/notes/:noteId
//   GET/POST /api/clients/:id/links, DELETE /api/clients/:id/links/:linkId
//   POST   /api/clients/:id/summary       → { summary, aiSummaryAt, source }
//   GET    /api/clients/:id/briefing?refresh=1 → { briefing }
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse, paging } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { logActivity } = require('../lib/activity');
const S = require('../services/clients/serialize');

const router = express.Router();

const KINDS = ['client', 'partner', 'vendor'];

// ── helpers ──────────────────────────────────────────────────────────────
const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const slug = (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : v);

const optStr = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optInt = z.preprocess((v) => (v === '' || v === undefined ? undefined : v === null ? null : Number(v)), z.number().int().nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());

const clientSchema = z.object({
  firstName: z.preprocess((v) => (v == null ? undefined : v), z.string().trim().max(120).optional()),
  lastName: z.preprocess((v) => (v == null ? undefined : v), z.string().trim().max(120).optional()),
  displayName: optStr(200),
  phone: optStr(40),
  phoneAlt: optStr(40),
  email: optStr(200),
  emailAlt: optStr(200),
  company: optStr(200),
  jobTitle: optStr(200),
  avatarUrl: optStr(1000),
  type: optStr(40),
  contactKind: optStr(20),
  kind: optStr(20),
  vendorRole: optStr(80),
  status: optStr(40),
  rating: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().min(0).max(5).optional()),
  isWhale: z.boolean().optional(),
  leadSource: optStr(80),
  referredById: optStr(64),
  tags: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
  street: optStr(200),
  unit: optStr(40),
  city: optStr(120),
  state: optStr(40),
  zip: optStr(20),
  neighborhood: optStr(120),
  birthday: optStr(20),
  personal: z.record(z.any()).nullable().optional(),
  preferredChannel: optStr(20),
  deviceMode: optStr(20),
  financing: optStr(40),
  preApprovalAmount: optInt,
  preApprovalExpires: optDate,
  lenderName: optStr(200),
  timeline: optStr(40),
  motivation: optStr(2000),
  purchasePower: optInt,
  notes: optStr(20000),
  blocked: z.boolean().optional(),
  textOptOut: z.boolean().optional(),
  lastContactedAt: optDate,
}).passthrough();

const WRITABLE = ['firstName', 'lastName', 'displayName', 'phone', 'phoneAlt', 'email', 'emailAlt', 'company', 'jobTitle',
  'avatarUrl', 'type', 'contactKind', 'vendorRole', 'status', 'rating', 'isWhale', 'leadSource', 'referredById', 'tags',
  'street', 'unit', 'city', 'state', 'zip', 'neighborhood', 'birthday', 'preferredChannel', 'deviceMode', 'financing',
  'preApprovalAmount', 'preApprovalExpires', 'lenderName', 'timeline', 'motivation', 'purchasePower', 'blocked',
  'textOptOut', 'lastContactedAt'];

function normalizeBirthday(v) {
  if (v == null) return v;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(?:--)?(\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return `--${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? (Number(m[3]) > 30 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return s.slice(0, 20);
}

// Build a Prisma data object from validated input.
function toData(input, { creating = false } = {}) {
  const data = {};
  for (const k of WRITABLE) if (input[k] !== undefined) data[k] = input[k];
  if (input.kind !== undefined && input.contactKind === undefined) data.contactKind = input.kind;
  if (data.contactKind != null) {
    data.contactKind = slug(data.contactKind);
    if (!KINDS.includes(data.contactKind)) data.contactKind = 'client';
  }
  if (data.type != null) data.type = slug(data.type);
  if (data.status != null) data.status = slug(data.status);
  if (data.phone !== undefined) data.phone = data.phone ? normalizePhone(data.phone) || null : null;
  if (data.phoneAlt !== undefined) data.phoneAlt = data.phoneAlt ? normalizePhone(data.phoneAlt) || null : null;
  if (data.email !== undefined) data.email = data.email ? data.email.trim().toLowerCase() : null;
  if (data.emailAlt !== undefined) data.emailAlt = data.emailAlt ? data.emailAlt.trim().toLowerCase() : null;
  if (data.deviceMode != null && !['imessage', 'sms'].includes(data.deviceMode)) data.deviceMode = null;
  if (data.birthday !== undefined) data.birthday = normalizeBirthday(data.birthday);
  if (data.tags) data.tags = [...new Set(data.tags.map((t) => t.trim()).filter(Boolean))];
  if (data.firstName !== undefined) data.firstName = data.firstName || '';
  if (data.lastName !== undefined) data.lastName = data.lastName || '';
  if (creating) {
    if (data.firstName === undefined) data.firstName = '';
    if (data.lastName === undefined) data.lastName = '';
  }
  return data;
}

function mergePersonal(existing, patch) {
  if (patch === null) return {};
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete out[k];
    else out[k] = v;
  }
  return out;
}

async function getClientOr404(workspaceId, id, select) {
  const c = await prisma.client.findFirst({ where: { id, workspaceId }, ...(select ? { select } : {}) });
  if (!c) throw new HttpError(404, 'Client not found');
  return c;
}

function broadcastClient(workspaceId, client) {
  hub.broadcast(workspaceId, 'client_updated', S.listRow(client));
}

// Search clause: name (incl. "first last"), phone digits, email, company,
// neighborhood, city, vendor role, tags.
function searchWhere(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  const ci = { contains: s, mode: 'insensitive' };
  const digits = s.replace(/\D/g, '');
  const looksPhone = digits.length >= 3 && /^[\d\s()+.-]+$/.test(s);
  const words = s.split(/\s+/).filter(Boolean);
  const or = [
    { firstName: ci }, { lastName: ci }, { displayName: ci }, { email: ci }, { emailAlt: ci },
    { company: ci }, { neighborhood: ci }, { city: ci }, { vendorRole: ci },
    { tags: { has: s } }, { tags: { has: s.toLowerCase() } },
  ];
  if (digits.length >= 3) {
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    or.push({ phone: { contains: d } }, { phoneAlt: { contains: d } });
  }
  if (words.length > 1 && !looksPhone) {
    or.push({ AND: [{ firstName: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' } }] });
  }
  return { OR: or };
}

// ── LIST ────────────────────────────────────────────────────────────────
router.get('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const { take, skip, limit, page } = paging(req, { defaultLimit: 100, maxLimit: 2000 });
  const sort = ['az', 'newest', 'recent', 'rating', 'volume'].includes(req.query.sort) ? req.query.sort : 'az';
  const and = [{ workspaceId: wid }];
  if (req.query.archived === '1') and.push({ archivedAt: { not: null } });
  else and.push({ archivedAt: null });
  const kind = slug(req.query.kind || '');
  if (kind && kind !== 'all') and.push({ contactKind: kind });
  if (req.query.status) and.push({ status: { in: String(req.query.status).split(',').map(slug) } });
  if (req.query.type) and.push({ type: { in: String(req.query.type).split(',').map(slug) } });
  if (req.query.whale === '1') and.push({ isWhale: true });
  if (req.query.minRating) and.push({ rating: { gte: Number(req.query.minRating) || 0 } });
  if (req.query.tag) and.push({ tags: { has: String(req.query.tag) } });
  if (req.query.ids) and.push({ id: { in: String(req.query.ids).split(',').filter(Boolean).slice(0, 500) } });
  if (req.query.exclude) and.push({ id: { notIn: String(req.query.exclude).split(',').filter(Boolean) } });
  const sw = searchWhere(req.query.search || req.query.q);
  if (sw) and.push(sw);
  const where = { AND: and };

  let clients;
  let total;
  if (sort === 'az') {
    // Correct Last, First ordering across pages: sort the (small) key set in
    // JS, then page. A personal book is thousands of rows at most.
    const keys = await prisma.client.findMany({ where, select: { id: true, firstName: true, lastName: true, displayName: true, company: true, email: true, phone: true } });
    keys.sort((a, b) => S.sortKeyOf(a).localeCompare(S.sortKeyOf(b), 'en', { sensitivity: 'base' }));
    total = keys.length;
    const ids = keys.slice(skip, skip + take).map((k) => k.id);
    const rows = await prisma.client.findMany({ where: { id: { in: ids } }, select: S.LIST_SELECT });
    const byId = new Map(rows.map((r) => [r.id, r]));
    clients = ids.map((id) => byId.get(id)).filter(Boolean);
  } else {
    const orderBy = sort === 'newest' ? [{ createdAt: 'desc' }]
      : sort === 'rating' ? [{ isWhale: 'desc' }, { rating: 'desc' }, { lifetimeVolume: 'desc' }]
        : sort === 'volume' ? [{ lifetimeVolume: 'desc' }]
          : [{ lastContactedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }];
    [clients, total] = await Promise.all([
      prisma.client.findMany({ where, select: S.LIST_SELECT, orderBy, take, skip }),
      prisma.client.count({ where }),
    ]);
  }

  const out = { clients: clients.map(S.listRow), total, page, limit };
  if (req.query.withCounts === '1') {
    const [byKind, whales] = await Promise.all([
      prisma.client.groupBy({ by: ['contactKind'], where: { workspaceId: wid, archivedAt: null }, _count: { _all: true } }),
      prisma.client.count({ where: { workspaceId: wid, archivedAt: null, isWhale: true, contactKind: 'client' } }),
    ]);
    const counts = { client: 0, partner: 0, vendor: 0 };
    for (const g of byKind) counts[g.contactKind] = g._count._all;
    out.counts = { ...counts, whales };
  }
  res.json(out);
}));

// ── FACETS (chips / autocomplete) ───────────────────────────────────────
router.get('/facets', ah(async (req, res) => {
  const wid = req.workspaceId;
  const rows = await prisma.client.findMany({
    where: { workspaceId: wid, archivedAt: null },
    select: { leadSource: true, tags: true, neighborhood: true, vendorRole: true, contactKind: true, city: true },
  });
  const tally = (vals) => {
    const m = new Map();
    for (const v of vals) { if (!v) continue; const k = String(v).trim(); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  };
  res.json({
    leadSources: tally(rows.map((r) => r.leadSource)),
    tags: tally(rows.flatMap((r) => r.tags || [])),
    neighborhoods: tally(rows.map((r) => r.neighborhood)),
    cities: tally(rows.map((r) => r.city)),
    vendorRoles: tally(rows.filter((r) => r.contactKind === 'vendor').map((r) => r.vendorRole)),
    partnerRoles: tally(rows.filter((r) => r.contactKind === 'partner').map((r) => r.vendorRole)),
  });
}));

// ── LOOKUP (duplicate detection) ────────────────────────────────────────
router.get('/lookup', ah(async (req, res) => {
  const wid = req.workspaceId;
  const or = [];
  const phone = normalizePhone(req.query.phone || '');
  if (phone && phone.replace(/\D/g, '').length >= 7) or.push({ phone }, { phoneAlt: phone });
  const email = String(req.query.email || '').trim().toLowerCase();
  if (email && email.includes('@')) or.push({ email: { equals: email, mode: 'insensitive' } }, { emailAlt: { equals: email, mode: 'insensitive' } });
  if (!or.length) return res.json({ client: null });
  const where = { workspaceId: wid, archivedAt: null, OR: or };
  if (req.query.excludeId) where.id = { not: String(req.query.excludeId) };
  const c = await prisma.client.findFirst({ where, select: S.LIST_SELECT });
  res.json({ client: c ? S.listRow(c) : null, matchedOn: c ? (phone && (c.phone === phone || c.phoneAlt === phone) ? 'phone' : 'email') : null });
}));

// ── DETAIL ──────────────────────────────────────────────────────────────
const RELATION_INVERSE = {
  spouse: 'spouse', partner: 'partner', sibling: 'sibling', parent: 'child', child: 'parent',
  assistant: 'employer', employer: 'assistant', business_partner: 'business_partner',
  family_office: 'principal', principal: 'family_office', attorney: 'client', other: 'other',
};

function serializeLinks(client) {
  const out = [];
  const seen = new Set();
  for (const l of client.links || []) {
    if (!l.relatedClient || l.relatedClient.archivedAt) continue;
    seen.add(l.relatedClientId);
    out.push({ id: l.id, relation: l.relation, notes: l.notes, direction: 'out', client: S.mini(l.relatedClient), createdAt: l.createdAt });
  }
  for (const l of client.linkedFrom || []) {
    if (!l.client || l.client.archivedAt || seen.has(l.clientId)) continue;
    out.push({ id: l.id, relation: RELATION_INVERSE[l.relation] || l.relation, notes: l.notes, direction: 'in', client: S.mini(l.client), createdAt: l.createdAt });
  }
  return out;
}

async function loadDetail(workspaceId, id) {
  const tz = await S.workspaceTz(workspaceId);
  const linkSel = { select: { ...S.MINI_SELECT, archivedAt: true } };
  const c = await prisma.client.findFirst({
    where: { id, workspaceId },
    include: {
      properties: { orderBy: [{ createdAt: 'asc' }] },
      searches: { orderBy: [{ updatedAt: 'desc' }] },
      links: { include: { relatedClient: linkSel } },
      linkedFrom: { include: { client: linkSel } },
      referredBy: { select: S.MINI_SELECT },
      referrals: { where: { archivedAt: null }, select: { ...S.MINI_SELECT, createdAt: true, lifetimeVolume: true }, orderBy: { createdAt: 'desc' }, take: 25 },
      waitlists: { include: { waitlist: { select: { id: true, name: true, buildingName: true } } } },
    },
  });
  if (!c) throw new HttpError(404, 'Client not found');

  const since90 = new Date(Date.now() - 90 * 864e5);
  const now = new Date();
  const [deals, dealCounts, notesCount, apptCounts, taskCounts, convCount, callCount, touches, lastMsg] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId, clientId: id, archivedAt: null },
      select: { id: true, title: true, side: true, stage: true, track: true, price: true, listPrice: true, contractPrice: true, salePrice: true, estimatedGci: true, closedAt: true, closingDate: true, propertyLabel: true, propertyAddress: true, listingId: true, portfolioPropertyId: true, updatedAt: true, createdAt: true },
      orderBy: [{ updatedAt: 'desc' }], take: 25,
    }),
    prisma.deal.groupBy({ by: ['stage'], where: { workspaceId, clientId: id, archivedAt: null }, _count: { _all: true } }),
    prisma.note.count({ where: { workspaceId, clientId: id } }),
    Promise.all([
      prisma.appointment.count({ where: { workspaceId, clientId: id } }),
      prisma.appointment.count({ where: { workspaceId, clientId: id, startAt: { gte: now }, status: { notIn: ['cancelled'] } } }),
    ]),
    Promise.all([
      prisma.task.count({ where: { workspaceId, clientId: id } }),
      prisma.task.count({ where: { workspaceId, clientId: id, status: 'pending' } }),
    ]),
    prisma.conversation.count({ where: { workspaceId, clientId: id } }),
    prisma.phoneCall.count({ where: { workspaceId, clientId: id } }),
    Promise.all([
      prisma.message.count({ where: { workspaceId, clientId: id, sentAt: { gte: since90 } } }),
      prisma.phoneCall.count({ where: { workspaceId, clientId: id, startedAt: { gte: since90 } } }),
      prisma.appointment.count({ where: { workspaceId, clientId: id, startAt: { gte: since90, lte: now } } }),
      prisma.note.count({ where: { workspaceId, clientId: id, createdAt: { gte: since90 } } }),
    ]),
    prisma.message.findFirst({ where: { workspaceId, clientId: id }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ]);

  const stageCount = Object.fromEntries(dealCounts.map((g) => [g.stage, g._count._all]));
  const totalDeals = dealCounts.reduce((s, g) => s + g._count._all, 0);
  const closedDeals = stageCount.closed || 0;
  const openDeals = totalDeals - closedDeals - (stageCount.lost || 0);
  const pipelineVolume = deals.filter((d) => !['closed', 'lost'].includes(d.stage)).reduce((s, d) => s + (d.contractPrice || d.price || d.listPrice || 0), 0);
  const closings = c.transactionsCount || closedDeals || 0;
  const touchCount = touches.reduce((a, b) => a + b, 0);
  const lastTouchAt = [c.lastContactedAt, c.lastInboundAt, c.lastOutboundAt, lastMsg && lastMsg.sentAt].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;

  const properties = c.properties.map((p) => S.serializeProperty(p, tz));
  const { links, linkedFrom, ...rest } = c;
  return {
    ...rest,
    name: S.displayNameOf(c),
    properties,
    searches: c.searches.map(S.serializeSearch),
    links: serializeLinks(c),
    referredBy: c.referredBy ? S.mini(c.referredBy) : null,
    referrals: c.referrals.map((r) => ({ ...S.mini(r), createdAt: r.createdAt, lifetimeVolume: r.lifetimeVolume })),
    waitlists: c.waitlists.filter((e) => e.status !== 'removed').map((e) => ({ entryId: e.id, waitlistId: e.waitlistId, name: e.waitlist?.name, buildingName: e.waitlist?.buildingName, status: e.status, position: e.position })),
    deals,
    counts: {
      deals: totalDeals, openDeals, closedDeals, notes: notesCount, appointments: apptCounts[0], upcomingAppointments: apptCounts[1],
      tasks: taskCounts[0], openTasks: taskCounts[1], conversations: convCount, calls: callCount,
      properties: properties.length, owned: properties.filter((p) => ['owns', 'leased_out'].includes(p.relationship)).length,
      sold: properties.filter((p) => p.relationship === 'sold').length, searches: c.searches.length, referrals: c.referrals.length,
    },
    stats: {
      lifetimeVolume: c.lifetimeVolume || 0,
      lifetimeGci: c.lifetimeGci || 0,
      closings,
      avgPrice: closings > 0 && c.lifetimeVolume ? Math.round(c.lifetimeVolume / closings) : null,
      lastClosedAt: c.lastClosedAt,
      bought: properties.filter((p) => p.boughtWithMe).length,
      sold: properties.filter((p) => p.soldWithMe).length,
      pipelineVolume,
      clientSince: c.createdAt,
    },
    strength: {
      score: Math.round(100 * (1 - Math.exp(-touchCount / 12))),
      touches90: touchCount,
      lastTouchAt,
      daysSilent: lastTouchAt ? Math.floor((Date.now() - lastTouchAt.getTime()) / 864e5) : null,
    },
  };
}

router.get('/:id', ah(async (req, res) => {
  const client = await loadDetail(req.workspaceId, req.params.id);
  res.json({ client });
}));

// ── CREATE ──────────────────────────────────────────────────────────────
router.post('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const input = parse(clientSchema, req.body || {});
  const data = toData(input, { creating: true });
  if (!data.firstName && !data.lastName && !data.displayName && !data.company) {
    throw new HttpError(400, 'A first or last name is required to save.');
  }
  if (data.phone) {
    const existing = await prisma.client.findFirst({ where: { workspaceId: wid, archivedAt: null, OR: [{ phone: data.phone }, { phoneAlt: data.phone }] }, select: S.LIST_SELECT });
    if (existing && !req.body.force) return res.status(200).json({ client: S.listRow(existing), duplicate: true });
  }
  if (data.referredById) {
    const ref = await prisma.client.findFirst({ where: { id: data.referredById, workspaceId: wid }, select: { id: true } });
    if (!ref) data.referredById = null;
  }
  if (input.personal) data.personal = mergePersonal({}, input.personal);
  const created = await prisma.client.create({ data: { ...data, workspaceId: wid } });

  if (input.notes && input.notes.trim()) {
    const note = await prisma.note.create({ data: { workspaceId: wid, clientId: created.id, body: input.notes.trim(), source: 'agent' } });
    logActivity({ workspaceId: wid, clientId: created.id, type: 'note', title: 'Note added', body: note.body, meta: { noteId: note.id }, actor: 'agent' });
  }
  if (created.referredById) {
    logActivity({ workspaceId: wid, clientId: created.referredById, type: 'referral', title: `Referred ${S.displayNameOf(created)}`, meta: { referralId: created.id }, actor: 'agent' });
  }
  broadcastClient(wid, created);
  res.status(201).json({ client: S.listRow(created) });
}));

// ── UPDATE ──────────────────────────────────────────────────────────────
router.patch('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const before = await getClientOr404(wid, req.params.id);
  const input = parse(clientSchema, req.body || {});
  const data = toData(input);
  if (input.personal !== undefined) data.personal = mergePersonal(before.personal, input.personal);
  if (data.referredById) {
    if (data.referredById === before.id) data.referredById = null;
    else {
      const ref = await prisma.client.findFirst({ where: { id: data.referredById, workspaceId: wid }, select: { id: true } });
      if (!ref) data.referredById = null;
    }
  }
  if (input.notes !== undefined) data.notes = input.notes;
  const nameLeft = (data.firstName ?? before.firstName) || (data.lastName ?? before.lastName) || (data.displayName !== undefined ? data.displayName : before.displayName) || (data.company !== undefined ? data.company : before.company);
  if (!nameLeft) throw new HttpError(400, 'A first or last name is required to save.');

  const updated = await prisma.client.update({ where: { id: before.id }, data });

  if (data.status && data.status !== before.status) {
    const label = { lead: 'Lead', active: 'Active client', past_client: 'Past client', sphere: 'Sphere', inactive: 'Inactive' }[data.status] || data.status;
    logActivity({ workspaceId: wid, clientId: before.id, type: 'status_change', title: `Status → ${label}`, meta: { from: before.status, to: data.status }, actor: 'agent' });
  }
  if (data.referredById && data.referredById !== before.referredById) {
    logActivity({ workspaceId: wid, clientId: data.referredById, type: 'referral', title: `Referred ${S.displayNameOf(updated)}`, meta: { referralId: updated.id }, actor: 'agent' });
  }
  broadcastClient(wid, updated);
  res.json({ client: S.listRow(updated) });
}));

// ── DELETE (soft) / RESTORE ─────────────────────────────────────────────
router.delete('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const c = await getClientOr404(wid, req.params.id);
  const updated = await prisma.client.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
  broadcastClient(wid, updated);
  res.json({ ok: true, client: S.listRow(updated) });
}));

router.post('/:id/restore', ah(async (req, res) => {
  const wid = req.workspaceId;
  const c = await getClientOr404(wid, req.params.id);
  const updated = await prisma.client.update({ where: { id: c.id }, data: { archivedAt: null } });
  broadcastClient(wid, updated);
  res.json({ client: S.listRow(updated) });
}));

// ── BLOCK / UNBLOCK ─────────────────────────────────────────────────────
async function setBlocked(req, res, blocked) {
  const wid = req.workspaceId;
  const c = await getClientOr404(wid, req.params.id);
  const updated = await prisma.client.update({ where: { id: c.id }, data: { blocked } });
  const convs = await prisma.conversation.findMany({ where: { workspaceId: wid, clientId: c.id }, select: { id: true } });
  if (convs.length) {
    await prisma.conversation.updateMany({ where: { id: { in: convs.map((x) => x.id) } }, data: { blocked } });
    for (const cv of convs) {
      const row = await prisma.conversation.findUnique({ where: { id: cv.id } });
      if (row) hub.broadcast(wid, 'conversation_updated', row);
    }
  }
  logActivity({ workspaceId: wid, clientId: c.id, type: 'system', title: blocked ? 'Blocked' : 'Unblocked', actor: 'agent' });
  broadcastClient(wid, updated);
  res.json({ client: S.listRow(updated) });
}
router.post('/:id/block', ah((req, res) => setBlocked(req, res, true)));
router.post('/:id/unblock', ah((req, res) => setBlocked(req, res, false)));

// ── ACTIVITY FEED (merged) ──────────────────────────────────────────────
const MESSAGE_TYPES = new Set(['message_in', 'message_out']);

function callTitle(call) {
  const dur = call.durationSec ? ` · ${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')}` : '';
  if (['missed', 'no_answer', 'busy', 'cancelled'].includes(call.status)) return call.direction === 'inbound' ? 'Missed call' : 'No answer';
  if (call.status === 'voicemail') return call.direction === 'inbound' ? 'Voicemail' : 'Left voicemail';
  return `${call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call${dur}`;
}

function activityKind(type) {
  if (!type) return 'system';
  if (type === 'note') return 'note';
  if (type.startsWith('call') || type === 'voicemail') return 'call';
  if (type.startsWith('deal')) return 'deal';
  if (['appointment', 'showing'].includes(type)) return 'appointment';
  if (['property_added', 'property_removed', 'property_updated', 'property_sold'].includes(type)) return 'property';
  if (['search_updated', 'search_added', 'search_removed'].includes(type)) return 'search';
  if (type === 'match') return 'match';
  if (type.startsWith('task')) return 'task';
  if (type === 'email') return 'email';
  if (type === 'campaign') return 'campaign';
  return 'system';
}

router.get('/:id/activity', ah(async (req, res) => {
  const wid = req.workspaceId;
  const id = req.params.id;
  const client = await getClientOr404(wid, id, { id: true, createdAt: true, firstName: true, lastName: true, displayName: true });
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
  const includeMessages = req.query.includeMessages === '1';
  const now = new Date();
  const [acts, calls, appts, notes, deals, props, searches] = await Promise.all([
    prisma.activity.findMany({ where: { workspaceId: wid, clientId: id }, orderBy: { occurredAt: 'desc' }, take: 400 }),
    prisma.phoneCall.findMany({ where: { workspaceId: wid, clientId: id }, orderBy: { startedAt: 'desc' }, take: 100 }),
    prisma.appointment.findMany({ where: { workspaceId: wid, clientId: id, startAt: { lte: now } }, orderBy: { startAt: 'desc' }, take: 100 }),
    prisma.note.findMany({ where: { workspaceId: wid, clientId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.deal.findMany({ where: { workspaceId: wid, clientId: id }, select: { id: true, title: true, propertyLabel: true, propertyAddress: true, side: true, stage: true, createdAt: true, closedAt: true, salePrice: true, price: true }, take: 50 }),
    prisma.portfolioProperty.findMany({ where: { workspaceId: wid, clientId: id }, select: { id: true, street: true, unit: true, buildingName: true, nickname: true, neighborhood: true, city: true, relationship: true, createdAt: true } }),
    prisma.buyerSearch.findMany({ where: { workspaceId: wid, clientId: id }, select: { id: true, name: true, bucket: true, neighborhoods: true, buildings: true, markets: true, propertyTypes: true, waterfront: true, createdAt: true } }),
  ]);

  const seen = { call: new Set(), appointment: new Set(), note: new Set(), deal: new Set(), property: new Set(), search: new Set() };
  const items = [];
  for (const a of acts) {
    if (!includeMessages && MESSAGE_TYPES.has(a.type)) continue;
    const m = a.meta && typeof a.meta === 'object' ? a.meta : {};
    if (m.callId) seen.call.add(m.callId);
    if (m.appointmentId) seen.appointment.add(m.appointmentId);
    if (m.noteId) seen.note.add(m.noteId);
    if (m.dealId || a.dealId) seen.deal.add(m.dealId || a.dealId);
    if (m.propertyId) seen.property.add(m.propertyId);
    if (m.searchId) seen.search.add(m.searchId);
    items.push({ id: `a:${a.id}`, activityId: a.id, kind: activityKind(a.type), type: a.type, title: a.title, body: a.body, at: a.occurredAt, meta: m, actor: a.actor });
  }
  for (const c of calls) {
    if (seen.call.has(c.id)) continue;
    const missed = ['missed', 'no_answer', 'busy', 'cancelled'].includes(c.status);
    items.push({
      id: `c:${c.id}`, kind: 'call', type: missed ? 'call_missed' : c.status === 'voicemail' ? 'voicemail' : c.direction === 'inbound' ? 'call_in' : 'call_out',
      title: callTitle(c), body: c.summary || c.voicemailTranscript || null, at: c.startedAt,
      meta: { callId: c.id, direction: c.direction, status: c.status, durationSec: c.durationSec, recordingUrl: c.recordingUrl, summaryBullets: c.summaryBullets, transcript: Array.isArray(c.transcript) ? c.transcript.slice(0, 80) : null, sentiment: c.sentiment },
    });
  }
  for (const p of appts) {
    if (seen.appointment.has(p.id)) continue;
    items.push({ id: `p:${p.id}`, kind: 'appointment', type: p.type, title: p.title, body: p.outcome || p.location || null, at: p.startAt, meta: { appointmentId: p.id, status: p.status, location: p.location, endAt: p.endAt, apptType: p.type } });
  }
  for (const n of notes) {
    if (seen.note.has(n.id)) continue;
    items.push({ id: `n:${n.id}`, kind: 'note', type: 'note', title: 'Note added', body: n.body, at: n.createdAt, meta: { noteId: n.id, pinned: n.pinned, source: n.source } });
  }
  for (const d of deals) {
    if (seen.deal.has(d.id)) continue;
    const label = d.propertyLabel || d.propertyAddress || d.title || (d.side === 'listing' ? 'Listing' : 'Purchase');
    items.push({ id: `d:${d.id}`, kind: 'deal', type: 'deal_created', title: `Deal opened · ${label}`, at: d.createdAt, meta: { dealId: d.id, stage: d.stage, side: d.side } });
    if (d.closedAt && d.stage === 'closed') items.push({ id: `dc:${d.id}`, kind: 'deal', type: 'deal_closed', title: `Closed · ${label}`, at: d.closedAt, meta: { dealId: d.id, price: d.salePrice || d.price } });
  }
  for (const p of props) {
    if (seen.property.has(p.id)) continue;
    const t = S.propertyTitle(p);
    const verb = p.relationship === 'sold' ? `Added sale history: ${t}` : p.relationship === 'rents' ? `Added rental: ${t}` : p.relationship === 'watching' ? `Watching ${t}` : `Added ${t} to portfolio`;
    items.push({ id: `pp:${p.id}`, kind: 'property', type: 'property_added', title: verb, at: p.createdAt, meta: { propertyId: p.id } });
  }
  for (const s of searches) {
    if (seen.search.has(s.id)) continue;
    const t = S.searchTitle(s);
    items.push({ id: `bs:${s.id}`, kind: 'search', type: 'search_added', title: s.bucket === 'dream' ? `Added to wishlist: ${t}` : `Started searching: ${t}`, at: s.createdAt, meta: { searchId: s.id } });
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  const total = items.length;
  const out = items.slice(0, limit);
  out.push({ id: 'added', kind: 'added', type: 'client_added', title: 'Added to KeyMatch', at: client.createdAt, pinned: true, meta: {} });
  res.json({ activity: out, total: total + 1 });
}));

// ── NOTES ───────────────────────────────────────────────────────────────
const noteSchema = z.object({ body: z.string().trim().min(1).max(20000), pinned: z.boolean().optional() });
const notePatch = z.object({ body: z.string().trim().min(1).max(20000).optional(), pinned: z.boolean().optional() });

router.get('/:id/notes', ah(async (req, res) => {
  const wid = req.workspaceId;
  await getClientOr404(wid, req.params.id, { id: true });
  const notes = await prisma.note.findMany({ where: { workspaceId: wid, clientId: req.params.id }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 500 });
  res.json({ notes, total: notes.length });
}));

router.post('/:id/notes', ah(async (req, res) => {
  const wid = req.workspaceId;
  const c = await getClientOr404(wid, req.params.id, { id: true });
  const input = parse(noteSchema, req.body || {});
  const note = await prisma.note.create({ data: { workspaceId: wid, clientId: c.id, body: input.body, pinned: !!input.pinned, source: req.body?.source === 'serena' ? 'serena' : 'agent' } });
  await logActivity({ workspaceId: wid, clientId: c.id, type: 'note', title: 'Note added', body: note.body, meta: { noteId: note.id }, actor: 'agent' });
  res.status(201).json({ note });
}));

router.patch('/:id/notes/:noteId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const n = await prisma.note.findFirst({ where: { id: req.params.noteId, workspaceId: wid, clientId: req.params.id } });
  if (!n) throw new HttpError(404, 'Note not found');
  const input = parse(notePatch, req.body || {});
  const note = await prisma.note.update({ where: { id: n.id }, data: input });
  if (input.body !== undefined && input.body !== n.body) {
    await prisma.activity.updateMany({ where: { workspaceId: wid, clientId: n.clientId, type: 'note', meta: { path: ['noteId'], equals: n.id } }, data: { body: input.body } }).catch(() => {});
  }
  res.json({ note });
}));

router.delete('/:id/notes/:noteId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const n = await prisma.note.findFirst({ where: { id: req.params.noteId, workspaceId: wid, clientId: req.params.id } });
  if (!n) throw new HttpError(404, 'Note not found');
  await prisma.note.delete({ where: { id: n.id } });
  await prisma.activity.deleteMany({ where: { workspaceId: wid, clientId: n.clientId, type: 'note', meta: { path: ['noteId'], equals: n.id } } }).catch(() => {});
  res.json({ ok: true });
}));

// ── LINKS (household / relationships) ───────────────────────────────────
const linkSchema = z.object({
  relatedClientId: z.string().min(1),
  relation: z.string().trim().min(1).max(40),
  notes: z.preprocess(blankToNull, z.string().trim().max(500).nullable().optional()),
});

router.get('/:id/links', ah(async (req, res) => {
  const wid = req.workspaceId;
  const linkSel = { select: { ...S.MINI_SELECT, archivedAt: true } };
  const c = await prisma.client.findFirst({
    where: { id: req.params.id, workspaceId: wid },
    include: { links: { include: { relatedClient: linkSel } }, linkedFrom: { include: { client: linkSel } } },
  });
  if (!c) throw new HttpError(404, 'Client not found');
  const links = serializeLinks(c);
  res.json({ links, total: links.length });
}));

router.post('/:id/links', ah(async (req, res) => {
  const wid = req.workspaceId;
  const c = await getClientOr404(wid, req.params.id, { id: true });
  const input = parse(linkSchema, req.body || {});
  if (input.relatedClientId === c.id) throw new HttpError(400, 'A client can’t be linked to themselves.');
  const other = await getClientOr404(wid, input.relatedClientId, { id: true });
  const relation = slug(input.relation);
  // One row per pair: drop a reverse-direction row so the pair never doubles up.
  await prisma.clientLink.deleteMany({ where: { workspaceId: wid, clientId: other.id, relatedClientId: c.id } });
  const link = await prisma.clientLink.upsert({
    where: { clientId_relatedClientId: { clientId: c.id, relatedClientId: other.id } },
    create: { workspaceId: wid, clientId: c.id, relatedClientId: other.id, relation, notes: input.notes ?? null },
    update: { relation, notes: input.notes ?? null },
  });
  const [a, b] = await Promise.all([
    prisma.client.findUnique({ where: { id: c.id } }),
    prisma.client.findUnique({ where: { id: other.id } }),
  ]);
  broadcastClient(wid, a); broadcastClient(wid, b);
  res.status(201).json({ link });
}));

router.delete('/:id/links/:linkId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const l = await prisma.clientLink.findFirst({ where: { id: req.params.linkId, workspaceId: wid, OR: [{ clientId: req.params.id }, { relatedClientId: req.params.id }] } });
  if (!l) throw new HttpError(404, 'Link not found');
  await prisma.clientLink.delete({ where: { id: l.id } });
  const [a, b] = await Promise.all([
    prisma.client.findUnique({ where: { id: l.clientId } }),
    prisma.client.findUnique({ where: { id: l.relatedClientId } }),
  ]);
  if (a) broadcastClient(wid, a);
  if (b) broadcastClient(wid, b);
  res.json({ ok: true });
}));

// ── AI: summary + briefing (deterministic fallbacks) ────────────────────
router.post('/:id/summary', ah(async (req, res) => {
  const { generateSummary } = require('../services/clients/insights');
  const out = await generateSummary({ workspaceId: req.workspaceId, clientId: req.params.id });
  res.json(out);
}));

router.get('/:id/briefing', ah(async (req, res) => {
  const { getBriefing } = require('../services/clients/insights');
  const briefing = await getBriefing({ workspaceId: req.workspaceId, clientId: req.params.id, refresh: req.query.refresh === '1' });
  res.json({ briefing });
}));

module.exports = router;
module.exports.loadDetail = loadDetail;

// /api/waitlists — RevMatch "Allocation Requests", re-geared: buyers queued for
// a building, community, release or off-market request, in priority order.
//
//   GET    /api/waitlists                         → { waitlists, total, totalWaiting }
//   GET    /api/waitlists/client/:clientId        → { entries }  (lists this client is on)
//   GET    /api/waitlists/:id                     → { waitlist }  (+ entries with client + live criteria line)
//   POST   /api/waitlists  { name, kind, buildingName?, neighborhood?, description? } → 201 { waitlist }
//   PATCH  /api/waitlists/:id                     → { waitlist }
//   DELETE /api/waitlists/:id                     → { ok }
//   POST   /api/waitlists/:id/entries { clientId, notes? }      → 201 { entry }   (joins the END of the line)
//   PATCH  /api/waitlists/:id/entries/:entryId { status: waiting|got_one, notes, position } → { entry }
//   PUT    /api/waitlists/:id/order { entryIds:[…] }            → { ok }
//   DELETE /api/waitlists/:id/entries/:entryId                  → { ok }
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, HttpError, parse } = require('../lib/http');
const { logActivity } = require('../lib/activity');
const S = require('../services/clients/serialize');
const { moneyShort } = require('../services/clients/text');

const router = express.Router();
const KINDS = ['building', 'community', 'release', 'off_market'];

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optStr = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const listSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  kind: optStr(30),
  buildingName: optStr(160),
  neighborhood: optStr(160),
  description: optStr(2000),
  position: z.number().int().optional(),
});

function lc(s) { return String(s || '').toLowerCase(); }

// Live criteria line from the client's best-fitting active search:
// "Bay view · 3+ bd · $4M–$6M · +2 must-haves"
function criteriaLine(searches, wl) {
  if (!searches || !searches.length) return null;
  const keys = [wl.buildingName, wl.neighborhood, wl.name].filter(Boolean).map(lc);
  const scored = searches.map((s) => {
    const hay = [...(s.buildings || []), ...(s.neighborhoods || []), s.name].filter(Boolean).map(lc);
    const hit = keys.some((k) => hay.some((h) => h && (h.includes(k) || k.includes(h))));
    return { s, rank: (hit ? 2 : 0) + (s.bucket === 'active' ? 1 : 0) };
  }).sort((a, b) => b.rank - a.rank);
  const s = scored[0].s;
  const parts = [];
  if ((s.views || [])[0]) parts.push(`${s.views[0].replace(/^\w/, (m) => m.toUpperCase())} view`);
  else if ((s.waterfront || [])[0]) parts.push(s.waterfront[0] === 'any' ? 'Waterfront' : s.waterfront[0].replace(/^\w/, (m) => m.toUpperCase()));
  if (s.bedsMin) parts.push(`${s.bedsMin}+ bd`);
  if (s.priceMin && s.priceMax) parts.push(`${moneyShort(s.priceMin)}–${moneyShort(s.priceMax)}`);
  else if (s.priceMax) parts.push(`≤ ${moneyShort(s.priceMax)}`);
  const mh = Array.isArray(s.mustHaves) ? s.mustHaves.length : 0;
  if (mh) parts.push(`+${mh} must-have${mh > 1 ? 's' : ''}`);
  return { text: parts.join(' · ') || S.searchTitle(s), searchId: s.id, title: S.searchTitle(s) };
}

function tier(c) {
  if (c.isWhale || c.rating >= 5) return 'whale';
  if (c.rating >= 4) return 'hot';
  if (c.rating >= 3) return 'warm';
  return null;
}

async function loadWaitlist(workspaceId, id) {
  const wl = await prisma.waitlist.findFirst({
    where: { id, workspaceId },
    include: {
      entries: {
        where: { status: { not: 'removed' }, client: { archivedAt: null } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { client: { select: { ...S.MINI_SELECT, searches: { where: { status: 'active' }, select: { id: true, name: true, bucket: true, neighborhoods: true, buildings: true, markets: true, propertyTypes: true, waterfront: true, views: true, bedsMin: true, priceMin: true, priceMax: true, mustHaves: true } } } } },
      },
    },
  });
  if (!wl) throw new HttpError(404, 'Waitlist not found');
  const entries = wl.entries.map((e, i) => {
    const { searches, ...client } = e.client;
    return {
      id: e.id, waitlistId: e.waitlistId, clientId: e.clientId, rank: i + 1, position: e.position, status: e.status,
      notes: e.notes, doneAt: e.doneAt, createdAt: e.createdAt,
      client: S.mini(client), tier: tier(client), criteria: criteriaLine(searches, wl),
    };
  });
  const waiting = entries.filter((e) => e.status === 'waiting').length;
  return { ...wl, entries, count: entries.length, waitingCount: waiting, gotCount: entries.length - waiting };
}

function emit(workspaceId, waitlistId, clientId) {
  hub.broadcast(workspaceId, 'waitlist_updated', { id: waitlistId, clientId: clientId || null });
  if (clientId) {
    prisma.client.findUnique({ where: { id: clientId } }).then((c) => { if (c) hub.broadcast(workspaceId, 'client_updated', S.listRow(c)); }).catch(() => {});
  }
}

router.get('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const lists = await prisma.waitlist.findMany({
    where: { workspaceId: wid },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    include: { entries: { where: { status: { not: 'removed' }, client: { archivedAt: null } }, select: { status: true, client: { select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true, isWhale: true, rating: true } } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  let totalWaiting = 0;
  const waitlists = lists.map(({ entries, ...wl }) => {
    const waitingCount = entries.filter((e) => e.status === 'waiting').length;
    totalWaiting += waitingCount;
    return {
      ...wl, count: entries.length, waitingCount, gotCount: entries.length - waitingCount,
      faces: entries.slice(0, 4).map((e) => ({ id: e.client.id, name: S.displayNameOf(e.client), avatarUrl: e.client.avatarUrl, isWhale: e.client.isWhale })),
    };
  });
  res.json({ waitlists, total: waitlists.length, totalWaiting });
}));

router.get('/client/:clientId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const entries = await prisma.waitlistEntry.findMany({
    where: { clientId: req.params.clientId, status: { not: 'removed' }, waitlist: { workspaceId: wid } },
    include: { waitlist: { select: { id: true, name: true, kind: true, buildingName: true, neighborhood: true } } },
  });
  const out = [];
  for (const e of entries) {
    const ahead = await prisma.waitlistEntry.count({ where: { waitlistId: e.waitlistId, status: { not: 'removed' }, client: { archivedAt: null }, OR: [{ position: { lt: e.position } }, { position: e.position, createdAt: { lt: e.createdAt } }] } });
    out.push({ id: e.id, status: e.status, rank: ahead + 1, notes: e.notes, waitlist: e.waitlist });
  }
  res.json({ entries: out, total: out.length });
}));

router.get('/:id', ah(async (req, res) => {
  res.json({ waitlist: await loadWaitlist(req.workspaceId, req.params.id) });
}));

router.post('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const input = parse(listSchema, req.body || {});
  if (!input.name) throw new HttpError(400, 'Name the waitlist.');
  const dupe = await prisma.waitlist.findFirst({ where: { workspaceId: wid, name: { equals: input.name, mode: 'insensitive' } } });
  if (dupe) throw new HttpError(409, `“${dupe.name}” already exists.`);
  const max = await prisma.waitlist.aggregate({ where: { workspaceId: wid }, _max: { position: true } });
  const kind = KINDS.includes(input.kind) ? input.kind : 'building';
  const wl = await prisma.waitlist.create({ data: { workspaceId: wid, name: input.name, kind, buildingName: input.buildingName ?? null, neighborhood: input.neighborhood ?? null, description: input.description ?? null, position: (max._max.position || 0) + 1 } });
  emit(wid, wl.id);
  res.status(201).json({ waitlist: { ...wl, entries: [], count: 0, waitingCount: 0, gotCount: 0 } });
}));

router.patch('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const wl = await prisma.waitlist.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!wl) throw new HttpError(404, 'Waitlist not found');
  const input = parse(listSchema, req.body || {});
  if (input.name && input.name.toLowerCase() !== wl.name.toLowerCase()) {
    const dupe = await prisma.waitlist.findFirst({ where: { workspaceId: wid, name: { equals: input.name, mode: 'insensitive' }, id: { not: wl.id } } });
    if (dupe) throw new HttpError(409, `“${dupe.name}” already exists.`);
  }
  const data = {};
  for (const k of ['name', 'buildingName', 'neighborhood', 'description', 'position']) if (input[k] !== undefined) data[k] = input[k];
  if (input.kind !== undefined) data.kind = KINDS.includes(input.kind) ? input.kind : 'building';
  await prisma.waitlist.update({ where: { id: wl.id }, data });
  emit(wid, wl.id);
  res.json({ waitlist: await loadWaitlist(wid, wl.id) });
}));

router.delete('/:id', ah(async (req, res) => {
  const wid = req.workspaceId;
  const wl = await prisma.waitlist.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!wl) throw new HttpError(404, 'Waitlist not found');
  await prisma.waitlist.delete({ where: { id: wl.id } });
  emit(wid, wl.id);
  res.json({ ok: true });
}));

router.post('/:id/entries', ah(async (req, res) => {
  const wid = req.workspaceId;
  const wl = await prisma.waitlist.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!wl) throw new HttpError(404, 'Waitlist not found');
  const input = parse(z.object({ clientId: z.string().min(1), notes: optStr(2000) }), req.body || {});
  const client = await prisma.client.findFirst({ where: { id: input.clientId, workspaceId: wid } });
  if (!client) throw new HttpError(404, 'Client not found');
  const max = await prisma.waitlistEntry.aggregate({ where: { waitlistId: wl.id, status: { not: 'removed' } }, _max: { position: true } });
  const existing = await prisma.waitlistEntry.findUnique({ where: { waitlistId_clientId: { waitlistId: wl.id, clientId: client.id } } });
  let entry;
  if (existing && existing.status !== 'removed') throw new HttpError(409, `${S.displayNameOf(client)} is already on this list.`);
  if (existing) entry = await prisma.waitlistEntry.update({ where: { id: existing.id }, data: { status: 'waiting', position: (max._max.position || 0) + 1, notes: input.notes ?? existing.notes, doneAt: null, createdAt: new Date() } });
  else entry = await prisma.waitlistEntry.create({ data: { waitlistId: wl.id, clientId: client.id, position: (max._max.position || 0) + 1, notes: input.notes ?? null } });
  await logActivity({ workspaceId: wid, clientId: client.id, type: 'system', title: `Joined the ${wl.name} waitlist`, meta: { waitlistId: wl.id, entryId: entry.id }, actor: 'agent' });
  emit(wid, wl.id, client.id);
  res.status(201).json({ entry });
}));

router.patch('/:id/entries/:entryId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const e = await prisma.waitlistEntry.findFirst({ where: { id: req.params.entryId, waitlistId: req.params.id, waitlist: { workspaceId: wid } }, include: { waitlist: true } });
  if (!e) throw new HttpError(404, 'Entry not found');
  const input = parse(z.object({ status: z.enum(['waiting', 'got_one']).optional(), notes: optStr(2000), position: z.number().optional() }), req.body || {});
  const data = {};
  if (input.status !== undefined) { data.status = input.status; data.doneAt = input.status === 'got_one' ? new Date() : null; }
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.position !== undefined) data.position = input.position;
  const entry = await prisma.waitlistEntry.update({ where: { id: e.id }, data });
  if (input.status === 'got_one' && e.status !== 'got_one') {
    await logActivity({ workspaceId: wid, clientId: e.clientId, type: 'system', title: `Got one · ${e.waitlist.name}`, meta: { waitlistId: e.waitlistId, entryId: e.id }, actor: 'agent' });
  }
  emit(wid, e.waitlistId, e.clientId);
  res.json({ entry });
}));

router.put('/:id/order', ah(async (req, res) => {
  const wid = req.workspaceId;
  const wl = await prisma.waitlist.findFirst({ where: { id: req.params.id, workspaceId: wid } });
  if (!wl) throw new HttpError(404, 'Waitlist not found');
  const { entryIds } = parse(z.object({ entryIds: z.array(z.string()).max(2000) }), req.body || {});
  const rows = await prisma.waitlistEntry.findMany({ where: { waitlistId: wl.id, id: { in: entryIds } }, select: { id: true } });
  const valid = new Set(rows.map((r) => r.id));
  await prisma.$transaction(entryIds.filter((id) => valid.has(id)).map((id, i) => prisma.waitlistEntry.update({ where: { id }, data: { position: i + 1 } })));
  emit(wid, wl.id);
  res.json({ ok: true });
}));

router.delete('/:id/entries/:entryId', ah(async (req, res) => {
  const wid = req.workspaceId;
  const e = await prisma.waitlistEntry.findFirst({ where: { id: req.params.entryId, waitlistId: req.params.id, waitlist: { workspaceId: wid } } });
  if (!e) throw new HttpError(404, 'Entry not found');
  await prisma.waitlistEntry.delete({ where: { id: e.id } });
  emit(wid, e.waitlistId, e.clientId);
  res.json({ ok: true });
}));

module.exports = router;

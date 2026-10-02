// Demand pool — every buyer search in the book, ready to score (port of RM
// loadContacts, but ONE ENTRY PER SEARCH: a client with a primary-residence
// search and a vacation-home search is scored against each separately and
// keeps their best, so two unrelated wants never cross-breed).
//
//   const pool = await getDemandPool(workspaceId)   // cached, stale-while-revalidate
//   pool.entries → [{ key, search, client, name, first, whale, bucket, priority, signals, extraMustHaves }]
//   pool.version → changes whenever the underlying rows change
const prisma = require('../../lib/prisma');
const { readiness, isWhale } = require('./readiness');
const distill = require('./distill');
const V = require('./vocab');

const FRESH_MS = 60 * 1000;
const cache = new Map(); // workspaceId -> { at, pool, building }

const CLIENT_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, avatarUrl: true,
  status: true, type: true, contactKind: true, isWhale: true, lifetimeVolume: true, lifetimeGci: true,
  purchasePower: true, financing: true, preApprovalExpires: true, timeline: true, leadSource: true,
  lastContactedAt: true, lastInboundAt: true, lastOutboundAt: true, notes: true, preferredChannel: true,
  deviceMode: true, rating: true, archivedAt: true, blocked: true, updatedAt: true,
};

function clientName(c) {
  if (!c) return 'Client';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || c.phone || 'Client';
}
function firstOf(c) {
  return (c && (c.firstName || String(clientName(c)).split(' ')[0])) || 'there';
}
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

const BUCKET_LABEL = { active: 'Active', dream: 'Dream', inferred: 'Inferred' };

function money(v) {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) return null;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(x >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  return `$${Math.round(x / 1e3)}K`;
}

// "5BR+ · oceanfront · Bal Harbour / Surfside · ≤$12M"
function searchSummary(s) {
  if (!s) return '';
  const parts = [];
  if (s.bedsMin) parts.push(`${s.bedsMin}BR+`);
  const types = (s.propertyTypes || []).map((t) => V.typeLabel(V.canonicalType(t) || t).toLowerCase()).filter(Boolean);
  if (types.length) parts.push(types.slice(0, 2).join('/'));
  const wf = (s.waterfront || []).map(V.canonicalWaterfront).filter((w) => w && w !== 'none');
  if (wf.length) parts.push(wf.includes('any') ? 'waterfront' : V.WATERFRONT_LABEL[wf[0]].toLowerCase());
  const places = [...(s.neighborhoods || []), ...(s.buildings || [])];
  if (places.length) parts.push(places.slice(0, 2).join(' / '));
  else if ((s.markets || []).length) parts.push(s.markets.slice(0, 2).join(' / '));
  const lo = money(s.priceMin); const hi = money(s.priceMax);
  if (lo && hi) parts.push(`${lo}–${hi}`);
  else if (hi) parts.push(`≤${hi}`);
  else if (lo) parts.push(`${lo}+`);
  return parts.join(' · ');
}

async function buildPool(workspaceId) {
  const rows = await prisma.buyerSearch.findMany({
    where: {
      workspaceId,
      status: { notIn: ['paused', 'found', 'archived', 'closed'] },
      client: { archivedAt: null, blocked: false, contactKind: 'client' },
    },
    include: { client: { select: CLIENT_SELECT } },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
  const now = Date.now();
  let sig = `${rows.length}`;
  const entries = rows.map((search) => {
    const client = search.client;
    sig += `|${search.id}:${new Date(search.updatedAt).getTime()}:${new Date(client.updatedAt).getTime()}`;
    const bucket = BUCKET_LABEL[String(search.bucket || 'active').toLowerCase()] || 'Active';
    const r = readiness(client, search, now);
    const signals = [{
      kind: 'search',
      label: bucket === 'Dream' ? 'Dream wishlist' : bucket === 'Inferred' ? 'Inferred from conversations' : 'Active search',
      text: [search.name, searchSummary(search)].filter(Boolean).join(' — '),
    }];
    if (search.notes) signals.push({ kind: 'note', label: 'Search note', text: String(search.notes).slice(0, 220) });
    if (client.notes) signals.push({ kind: 'note', label: 'Client note', text: String(client.notes).slice(0, 220) });
    const d = distill.peek(workspaceId, client.id);
    if (d) {
      for (const sg of (d.signals || []).slice(0, 4)) signals.push(sg);
    }
    return {
      key: search.id,
      search,
      client,
      clientId: client.id,
      name: clientName(client),
      first: firstOf(client),
      normName: normName(clientName(client)),
      whale: isWhale(client),
      bucket,
      priority: r.priority,
      readiness: r,
      signals,
      extraMustHaves: d ? d.mustHaves || [] : [],
      summary: searchSummary(search),
    };
  });
  return { workspaceId, entries, version: hash(sig), builtAt: now };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

async function getDemandPool(workspaceId, { fresh = false } = {}) {
  const slot = cache.get(workspaceId);
  const now = Date.now();
  if (slot && slot.pool && !fresh) {
    if (now - slot.at > FRESH_MS && !slot.building) {
      slot.building = buildPool(workspaceId).then((pool) => { cache.set(workspaceId, { at: Date.now(), pool }); return pool; })
        .catch((err) => { console.error('[matchmaker] pool rebuild failed', err.message); slot.building = null; });
    }
    return slot.pool;
  }
  if (slot && slot.building && !fresh) return slot.building;
  const building = buildPool(workspaceId);
  cache.set(workspaceId, { ...(slot || {}), building });
  try {
    const pool = await building;
    cache.set(workspaceId, { at: Date.now(), pool });
    return pool;
  } catch (err) {
    cache.delete(workspaceId);
    throw err;
  }
}

function bustPool(workspaceId) {
  const slot = cache.get(workspaceId);
  if (slot) slot.at = 0;
}

module.exports = { getDemandPool, bustPool, searchSummary, clientName, firstOf, normName, CLIENT_SELECT, BUCKET_LABEL };

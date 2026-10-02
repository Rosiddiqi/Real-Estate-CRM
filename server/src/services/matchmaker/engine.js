// Matchmaker engine — scores subjects (listings, whispers, owned homes) against
// the demand pool, keeps each client's BEST search, persists Match rows (≥25)
// and emits `match_new` / notifications for hot matches.
//
// Live surfaces score on read (fast: the pool is cached and results are
// memoized per listing version), so tile counts, detail sheets and feeds
// always agree. Persisted rows carry status (sent / dismissed), history for
// getRecentMatches and the notification trail.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { notify } = require('../../lib/notify');
const { scoreListingForSearch, MATCH_CONFIG } = require('./score');
const { getDemandPool, normName, bustPool } = require('./pool');
const shape = require('../listings/shape');

const LISTING_INCLUDE = { source: { select: { id: true, name: true, kind: true, color: true } } };
const KEEP_STATUSES = new Set(['sent', 'interested', 'toured']);

// ── memo ──────────────────────────────────────────────────────────────────
const memo = new Map();
const MEMO_MAX = 4000;
function memoGet(k) {
  const v = memo.get(k);
  if (v) { memo.delete(k); memo.set(k, v); }
  return v;
}
function memoSet(k, v) {
  memo.set(k, v);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
}

// ── owner exclusion (by id AND normalized name, + household links) ────────
function makeExclusion({ ownerClientId, ownerName, linkedIds } = {}) {
  const ids = new Set([ownerClientId, ...(linkedIds || [])].filter(Boolean));
  const nn = ownerName ? normName(ownerName) : '';
  return (entry) => ids.has(entry.clientId) || (nn && nn.length > 3 && entry.normName === nn);
}

// Score one subject against the pool → one row per client (their best search).
function scoreSubject(subject, pool, opts = {}) {
  const key = opts.memoKey !== false && subject.id
    ? `${subject.id}:${new Date(subject.updatedAt || 0).getTime()}:${pool.version}:${opts.ownerClientId || ''}:${opts.includePending ? 1 : 0}:${(opts.linkedIds || []).join(',')}`
    : null;
  if (key) {
    const hit = memoGet(key);
    if (hit) return hit;
  }
  const excluded = makeExclusion(opts);
  const byClient = new Map();
  for (const entry of pool.entries) {
    if (excluded(entry)) continue;
    const result = scoreListingForSearch(subject, entry.search, {
      extraMustHaves: entry.extraMustHaves,
      signals: entry.signals,
      includePending: opts.includePending,
      hardTypes: opts.hardTypes,
      allowOffMarket: opts.allowOffMarket,
    });
    if (result.gated) continue;
    const prev = byClient.get(entry.clientId);
    if (!prev) { byClient.set(entry.clientId, { entry, result, searches: 1 }); continue; }
    prev.searches += 1;
    if (result.score > prev.result.score || (result.score === prev.result.score && entry.priority > prev.entry.priority)) {
      byClient.set(entry.clientId, { entry, result, searches: prev.searches });
    }
  }
  const rows = [...byClient.values()].sort((a, b) => b.result.score - a.result.score || b.entry.priority - a.entry.priority || a.entry.name.localeCompare(b.entry.name));
  if (key) memoSet(key, rows);
  return rows;
}

// Public row shape for one buyer ↔ subject pairing.
function buyerRow(row, extra = {}) {
  const { entry, result } = row;
  const c = entry.client;
  return {
    clientId: entry.clientId,
    name: entry.name,
    first: entry.first,
    avatarUrl: c.avatarUrl || null,
    phone: c.phone || null,
    channel: c.deviceMode === 'sms' || c.preferredChannel === 'sms' ? 'sms' : 'imessage',
    whale: entry.whale,
    bucket: entry.bucket,
    priority: entry.priority,
    searchId: entry.search.id,
    searchName: entry.search.name || null,
    searchSummary: entry.summary,
    score: result.score,
    summary: result.summary,
    confidence: result.confidence,
    verifyHold: result.verifyHold,
    crossedBudget: result.crossedBudget,
    factors: result.factors,
    mustHaves: result.mustHaves,
    signals: entry.signals,
    ...extra,
  };
}

async function listingBuyers(workspaceId, listing, opts = {}) {
  const pool = await getDemandPool(workspaceId);
  const rows = scoreSubject(listing, pool, { ownerClientId: listing.ownerClientId, ...opts });
  return rows;
}

// ── persistence ───────────────────────────────────────────────────────────
function factorsJson(row, extra = {}) {
  return {
    factors: row.result.factors,
    mustHaves: row.result.mustHaves,
    verifyHold: row.result.verifyHold,
    crossedBudget: row.result.crossedBudget,
    bucket: row.entry.bucket,
    searchName: row.entry.search.name || null,
    searchSummary: row.entry.summary,
    whale: row.entry.whale,
    ...extra,
  };
}

async function persistSubject(workspaceId, { subjectKey, kind, listingId = null, propertyId = null, label, rows, notifyHot = false, emit = true, extraFor }) {
  const existing = await prisma.match.findMany({ where: { workspaceId, subjectKey } });
  const byClient = new Map(existing.map((m) => [m.clientId, m]));
  const keep = new Set();
  const creates = [];
  const events = [];
  const now = new Date();
  for (const row of rows) {
    const s = row.result.score;
    if (s < MATCH_CONFIG.storeThreshold) continue;
    keep.add(row.entry.clientId);
    const prev = byClient.get(row.entry.clientId);
    const extra = extraFor ? extraFor(row) : {};
    const data = {
      searchId: row.entry.search.id,
      listingId, propertyId, kind,
      score: s,
      priority: row.entry.priority,
      summary: row.result.summary,
      confidence: row.result.confidence,
      ...(extra.narrative !== undefined ? { narrative: extra.narrative } : {}),
    };
    if (!prev) {
      creates.push({ workspaceId, clientId: row.entry.clientId, subjectKey, status: 'new', ...data, factors: factorsJson(row, { scoredAt: now.toISOString(), raisedAt: now.toISOString(), ...(extra.meta || {}) }) });
      if (s >= MATCH_CONFIG.showThreshold) events.push({ row, isNew: true });
      continue;
    }
    const prevMeta = prev.factors && typeof prev.factors === 'object' ? prev.factors : {};
    const raised = s >= prev.score + 3 || (prev.score < MATCH_CONFIG.showThreshold && s >= MATCH_CONFIG.showThreshold);
    const changed = prev.score !== s || prev.summary !== data.summary || prev.priority !== data.priority || prev.searchId !== data.searchId
      || prev.confidence !== data.confidence || JSON.stringify(prevMeta.factors || []) !== JSON.stringify(row.result.factors)
      || (extra.narrative !== undefined && prev.narrative !== extra.narrative);
    if (!changed) continue;
    const meta = factorsJson(row, { scoredAt: now.toISOString(), raisedAt: raised ? now.toISOString() : (prevMeta.raisedAt || prev.createdAt), prevScore: prev.score, ...(extra.meta || {}) });
    await prisma.match.update({ where: { id: prev.id }, data: { ...data, factors: meta } });
    if (raised && s >= MATCH_CONFIG.showThreshold && prev.status !== 'dismissed') events.push({ row, isNew: false, matchId: prev.id });
  }
  if (creates.length) await prisma.match.createMany({ data: creates, skipDuplicates: true });
  const stale = existing.filter((m) => !keep.has(m.clientId) && !KEEP_STATUSES.has(m.status));
  if (stale.length) await prisma.match.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });

  if (emit && events.length) {
    const fresh = creates.length ? await prisma.match.findMany({ where: { workspaceId, subjectKey, clientId: { in: events.filter((e) => e.isNew).map((e) => e.row.entry.clientId) } }, select: { id: true, clientId: true } }) : [];
    const idFor = new Map(fresh.map((m) => [m.clientId, m.id]));
    let notified = 0;
    for (const ev of events) {
      const matchId = ev.matchId || idFor.get(ev.row.entry.clientId);
      const payload = {
        matchId, kind, subjectKey, listingId, propertyId,
        clientId: ev.row.entry.clientId, clientName: ev.row.entry.name,
        score: ev.row.result.score, summary: ev.row.result.summary, label,
      };
      hub.broadcast(workspaceId, 'match_new', payload);
      if (notifyHot && ev.row.result.score >= MATCH_CONFIG.hotThreshold && notified < 5) {
        notified += 1;
        notify({
          workspaceId, type: 'match',
          title: `${ev.row.entry.name} · ${ev.row.result.score}% match`,
          body: `${label} — ${ev.row.result.summary}`,
          data: { matchId, listingId, propertyId, clientId: ev.row.entry.clientId, kind },
        });
      }
    }
  }
  return { stored: keep.size, created: creates.length, removed: stale.length, events: events.length };
}

function kindForListing(l) {
  return String(l.origin) === 'whisper' ? 'whisper' : 'listing';
}

async function rescoreListing(workspaceId, listingOrId, { notifyHot = true, emit = true } = {}) {
  const listing = typeof listingOrId === 'string'
    ? await prisma.listing.findFirst({ where: { id: listingOrId, workspaceId }, include: LISTING_INCLUDE })
    : listingOrId;
  if (!listing) {
    if (typeof listingOrId === 'string') await prisma.match.deleteMany({ where: { workspaceId, subjectKey: listingOrId, status: { notIn: [...KEEP_STATUSES] } } });
    return null;
  }
  const pool = await getDemandPool(workspaceId);
  const rows = scoreSubject(listing, pool, { ownerClientId: listing.ownerClientId });
  return persistSubject(workspaceId, {
    subjectKey: listing.id, kind: kindForListing(listing), listingId: listing.id,
    label: shape.titleOf(listing), rows, notifyHot, emit,
  });
}

async function rescoreWorkspace(workspaceId, { notifyHot, emit = true } = {}) {
  const t0 = Date.now();
  bustPool(workspaceId);
  const pool = await getDemandPool(workspaceId, { fresh: true });
  const hadAny = (await prisma.match.count({ where: { workspaceId } })) > 0;
  const doNotify = notifyHot == null ? hadAny : notifyHot;
  const listings = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null }, include: LISTING_INCLUDE });
  let stored = 0; let created = 0;
  const liveKeys = new Set();
  for (const l of listings) {
    liveKeys.add(l.id);
    const rows = scoreSubject(l, pool, { ownerClientId: l.ownerClientId });
    const r = await persistSubject(workspaceId, {
      subjectKey: l.id, kind: kindForListing(l), listingId: l.id, label: shape.titleOf(l), rows,
      notifyHot: doNotify, emit: emit && hadAny,
    });
    stored += r.stored; created += r.created;
  }
  // rows for listings that no longer exist / were retired
  await prisma.match.deleteMany({
    where: { workspaceId, kind: { in: ['listing', 'whisper', 'price_drop'] }, NOT: { subjectKey: { in: [...liveKeys] } }, status: { notIn: [...KEEP_STATUSES] } },
  });
  let off = { stored: 0 };
  try {
    off = await require('./offmarket').rescoreOffMarket(workspaceId, { pool, notifyHot: doNotify, emit: emit && hadAny });
  } catch (err) { console.error('[matchmaker] off-market rescore failed', err); }
  return { listings: listings.length, searches: pool.entries.length, stored, created, offMarket: off.stored, ms: Date.now() - t0 };
}

async function rescoreAll(opts = {}) {
  const ws = await prisma.workspace.findMany({ select: { id: true } });
  const out = [];
  for (const w of ws) {
    try { out.push({ workspaceId: w.id, ...(await rescoreWorkspace(w.id, opts)) }); } catch (err) { console.error('[matchmaker] rescore failed', w.id, err); }
  }
  return out;
}

// ── debounced scheduling (listing / search changes) ──────────────────────
const pending = new Map(); // workspaceId -> { timer, listings:Set, all:boolean }
function scheduleRescore(workspaceId, { listingId, all = false, delay = 1500 } = {}) {
  let p = pending.get(workspaceId);
  if (!p) { p = { timer: null, listings: new Set(), all: false }; pending.set(workspaceId, p); }
  if (listingId) p.listings.add(listingId);
  if (all || !listingId) p.all = true;
  clearTimeout(p.timer);
  p.timer = setTimeout(async () => {
    pending.delete(workspaceId);
    try {
      if (p.all) await rescoreWorkspace(workspaceId, {});
      else for (const id of p.listings) await rescoreListing(workspaceId, id, { notifyHot: true });
    } catch (err) { console.error('[matchmaker] scheduled rescore failed', err); }
  }, delay);
  if (p.timer.unref) p.timer.unref();
}

module.exports = {
  LISTING_INCLUDE,
  scoreSubject, buyerRow, listingBuyers, makeExclusion,
  persistSubject, rescoreListing, rescoreWorkspace, rescoreAll, scheduleRescore,
};

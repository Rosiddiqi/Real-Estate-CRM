// Deal store — one in-memory cache of normalized deals shared by the board,
// the Deal sheet and anything else showing a deal, so every surface paints the
// same numbers. Ported from RevMatch's usePipelineDeals, fixed:
//   • optimistic edits ACCUMULATE into one 400 ms debounced PATCH per deal;
//     flushDeal() awaits it (the card's Save button) — failures roll back to the
//     last server copy with an error toast (RevMatch failed silently);
//   • stage moves are optimistic with rollback + toast;
//   • realtime deal_created / deal_updated / deal_deleted repaint a second
//     device; pending local edits stay layered on top of server echoes.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import * as A from '../../api/deals';
import { api } from '../../api/client';
import { toast } from '../ui/toast';
import { useResync, useSocket } from '../../hooks/useSocket';
import { derive, getConfigState, loadPipelineConfig, isNewDevStage, phaseOf, stageForPhase } from './config';

let state = { byId: new Map(), boardIds: new Set(), status: 'idle', error: null, version: 0, loadedAt: 0 };
const subs = new Set();
const server = new Map();   // id → last server copy (rollback target)
const pending = new Map();  // id → { patch, timer, clientPatch }
const inflight = new Map(); // id → Promise of the PATCH in flight

const emit = () => { state = { ...state, version: state.version + 1 }; subs.forEach((f) => f()); };
const onBoard = (d) => d && d.stage !== 'lost' && !d.archivedAt;

function mergePatch(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (['contingencies', 'depositSchedule', 'extras'].includes(k) && v && typeof v === 'object' && !Array.isArray(v) && !Array.isArray(a[k])) out[k] = { ...(a[k] || {}), ...v };
    else out[k] = v;
  }
  return out;
}

// Raw-field patch applied locally (JSON columns merge like the server does).
function applyLocal(deal, patch) {
  if (!patch) return deal;
  const next = { ...deal };
  for (const [k, v] of Object.entries(patch)) {
    if (['contingencies', 'depositSchedule', 'extras'].includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const merged = { ...(Array.isArray(deal[k]) ? {} : (deal[k] || {})) };
      for (const [kk, vv] of Object.entries(v)) { if (vv === null) delete merged[kk]; else merged[kk] = vv; }
      next[k] = merged;
    } else next[k] = v;
    if (k === 'price') next.rawPrice = v;
  }
  return next;
}

function withPending(d) {
  const p = pending.get(d.id);
  return derive(p ? applyLocal(d, p.patch) : d, getConfigState());
}

function put(d) {
  server.set(d.id, d);
  const local = withPending(d);
  const byId = new Map(state.byId); byId.set(d.id, local);
  const boardIds = new Set(state.boardIds);
  if (onBoard(local)) boardIds.add(d.id); else boardIds.delete(d.id);
  state = { ...state, byId, boardIds };
}

export function upsertDeals(list, { replaceBoard = false } = {}) {
  if (replaceBoard) state = { ...state, boardIds: new Set() };
  for (const d of list || []) if (d && d.id) put(d);
  emit();
}

export function getDealSync(id) { return state.byId.get(id) || null; }

// Re-derive everything (the pay plan changed).
export function rederiveAll() {
  const byId = new Map();
  for (const [id, d] of state.byId) byId.set(id, derive(d, getConfigState()));
  state = { ...state, byId };
  emit();
}

let boardLoad = null;
export function loadBoard({ silent = false } = {}) {
  if (boardLoad) return boardLoad;
  if (!silent || !state.loadedAt) { state = { ...state, status: state.loadedAt ? state.status : 'loading', error: null }; emit(); }
  boardLoad = Promise.all([loadPipelineConfig(), A.listDeals({ board: 1, limit: 600 })])
    .then(([, r]) => {
      const ids = new Set();
      for (const d of r.deals || []) { put(d); ids.add(d.id); }
      // anything we thought was on the board but the server didn't return left it
      const boardIds = new Set([...state.boardIds].filter((id) => ids.has(id) || pending.has(id)));
      ids.forEach((id) => boardIds.add(id));
      state = { ...state, boardIds, status: 'ready', error: null, loadedAt: Date.now() };
      emit();
      return r.deals;
    })
    .catch((err) => {
      state = { ...state, status: state.loadedAt ? 'ready' : 'error', error: err };
      emit();
      if (state.loadedAt && !silent) toast.error('Couldn’t refresh the pipeline');
      throw err;
    })
    .finally(() => { boardLoad = null; });
  return boardLoad;
}

export async function loadDeal(id) {
  await loadPipelineConfig().catch(() => {});
  const r = await A.getDeal(id);
  put(r.deal);
  emit();
  return state.byId.get(id);
}

// ── edits ─────────────────────────────────────────────────────────────────
// updateDeal(id, partial) — raw deal fields (price, sideRate, closingDate,
// contingencies:{…}, extras:{…} …) and/or client:{rating,isWhale}.
export function updateDeal(id, partial) {
  const cur = state.byId.get(id);
  if (!cur || !partial) return;
  const { client, ...fields } = partial;
  if (client) updateClient(cur, client);
  if (!Object.keys(fields).length) return;
  const p = pending.get(id) || { patch: {} };
  p.patch = mergePatch(p.patch, fields);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { flushDeal(id).catch(() => {}); }, 400);
  pending.set(id, p);
  const byId = new Map(state.byId);
  byId.set(id, derive(applyLocal(cur, fields), getConfigState()));
  state = { ...state, byId };
  emit();
}

// Await every pending edit for this deal. Resolves true when saved.
export async function flushDeal(id) {
  const p = pending.get(id);
  if (!p) {
    if (inflight.has(id)) { try { await inflight.get(id); return true; } catch { return false; } }
    return true;
  }
  clearTimeout(p.timer);
  pending.delete(id);
  const run = (async () => {
    if (inflight.has(id)) { try { await inflight.get(id); } catch { /* previous failure already rolled back */ } }
    const r = await A.patchDeal(id, p.patch);
    put(r.deal);
    emit();
    return r.deal;
  })();
  inflight.set(id, run);
  try {
    await run;
    return true;
  } catch (err) {
    const base = server.get(id);
    if (base) { put(base); emit(); }
    toast.error(err && err.message ? `Couldn’t save — ${err.message}` : 'Couldn’t save that change');
    return false;
  } finally {
    if (inflight.get(id) === run) inflight.delete(id);
  }
}

// Client rating / whale from a deal card: optimistic on every deal for that
// client; PATCH /clients/:id (clients contract) with a deal-route fallback.
async function updateClient(deal, patch) {
  const clientId = deal.clientId;
  const prev = new Map();
  const byId = new Map(state.byId);
  for (const [id, d] of byId) {
    if (d.clientId !== clientId || !d.client) continue;
    prev.set(id, d.client);
    const c = { ...d.client, ...patch };
    c.whale = !!c.isWhale || (c.lifetimeVolume || 0) >= 10000000;
    byId.set(id, { ...d, client: c });
  }
  state = { ...state, byId };
  emit();
  try {
    await api.patch(`/clients/${clientId}`, patch);
  } catch (err) {
    try {
      if (err && (err.status === 404 || err.status === 503 || err.status === 405)) await A.patchDealClient(deal.id, patch);
      else throw err;
    } catch (e2) {
      const back = new Map(state.byId);
      for (const [id, c] of prev) { const d = back.get(id); if (d) back.set(id, { ...d, client: c }); }
      state = { ...state, byId: back };
      emit();
      toast.error('Couldn’t update the client');
    }
  }
}

// ── stage moves ───────────────────────────────────────────────────────────
// moveDeal(id, stage, { track, closedAt, commission, lostReason, lostNote, quiet })
export async function moveDeal(id, stage, extra = {}) {
  const before = state.byId.get(id);
  if (!before) return null;
  await flushDeal(id);
  const cur = state.byId.get(id) || before;
  const cfg = getConfigState().cfg;
  let track = extra.track || cur.track || 'main';
  if (cfg && isNewDevStage(cfg, stage)) track = 'new_dev';
  else if (stage !== 'lost') track = 'main';
  const optimistic = derive({
    ...cur,
    stage,
    track,
    subStatus: phaseOf(cfg, stage) === phaseOf(cfg, cur.stage) ? cur.subStatus : null,
    stageChangedAt: new Date().toISOString(),
    ...(stage === 'closed' ? { closedAt: cur.closedAt || new Date().toISOString(), archivedAt: null } : {}),
    ...(stage === 'lost' ? { lostReason: extra.lostReason || cur.lostReason, lostAt: new Date().toISOString() } : {}),
    ...(cur.stage === 'closed' && stage !== 'closed' ? { closedAt: null } : {}),
  }, getConfigState());
  const byId = new Map(state.byId); byId.set(id, optimistic);
  const boardIds = new Set(state.boardIds);
  if (onBoard(optimistic)) boardIds.add(id); else boardIds.delete(id);
  state = { ...state, byId, boardIds };
  emit();
  try {
    const body = { stage };
    for (const k of ['track', 'closedAt', 'commission', 'grossCommission', 'lostReason', 'lostNote', 'subStatus']) if (extra[k] !== undefined) body[k] = extra[k];
    if (stage === 'lost') {
      const r = await A.markLost(id, { reason: extra.lostReason, note: extra.lostNote });
      put(r.deal); emit();
      return r.deal;
    }
    const r = await A.moveDeal(id, body);
    put(r.deal); emit();
    return r.deal;
  } catch (err) {
    const base = server.get(id) || before;
    put(base); emit();
    if (!extra.quiet) toast.error(`Couldn’t move ${cur.name || 'the deal'}${err && err.message ? ` — ${err.message}` : ''}`);
    throw err;
  }
}

// Book the money on a closed deal (won-flow prompt) — or close it.
export async function bookClose(id, { commission, closedAt } = {}) {
  const cur = state.byId.get(id);
  if (cur) {
    const byId = new Map(state.byId);
    byId.set(id, derive({ ...cur, ...(commission != null ? { commission } : {}), ...(closedAt ? { closedAt } : {}) }, getConfigState()));
    state = { ...state, byId };
    emit();
  }
  try {
    const r = await A.closeDeal(id, { ...(commission != null ? { commission } : {}), ...(closedAt ? { closedAt } : {}) });
    put(r.deal); emit();
    return r.deal;
  } catch (err) {
    const base = server.get(id);
    if (base) { put(base); emit(); }
    toast.error(err && err.message ? err.message : 'Couldn’t save the closing');
    throw err;
  }
}

export async function reopenDeal(id, stage) {
  try {
    const r = await A.reopenDeal(id, stage ? { stage } : {});
    put(r.deal); emit();
    return r.deal;
  } catch (err) {
    toast.error('Couldn’t reopen the deal');
    throw err;
  }
}

export async function createDeal(body) {
  const r = await A.createDeal(body);
  put(r.deal); emit();
  return r.deal;
}

export async function removeDeal(id) {
  const before = state.byId.get(id);
  const byId = new Map(state.byId); byId.delete(id);
  const boardIds = new Set(state.boardIds); boardIds.delete(id);
  clearTimeout(pending.get(id)?.timer);
  pending.delete(id);
  state = { ...state, byId, boardIds };
  emit();
  try {
    await A.deleteDeal(id);
    server.delete(id);
    return true;
  } catch (err) {
    if (before) { const b2 = new Map(state.byId); b2.set(id, before); const ids = new Set(state.boardIds); if (onBoard(before)) ids.add(id); state = { ...state, byId: b2, boardIds: ids }; emit(); }
    toast.error('Couldn’t delete the deal');
    return false;
  }
}

// Realtime payloads from other devices / other writers.
export function applyRemote(event, payload) {
  if (!payload) return;
  if (event === 'deal_deleted') {
    if (!state.byId.has(payload.id)) return;
    const byId = new Map(state.byId); byId.delete(payload.id);
    const boardIds = new Set(state.boardIds); boardIds.delete(payload.id);
    server.delete(payload.id);
    state = { ...state, byId, boardIds };
    emit();
    return;
  }
  // Only normalized deals (other writers may broadcast raw rows — refetch those).
  if (!payload.id || !payload.stage) return;
  if (!payload.client || payload.phase === undefined) {
    if (state.byId.has(payload.id) || state.loadedAt) A.getDeal(payload.id).then((r) => { put(r.deal); emit(); }).catch(() => {});
    return;
  }
  put(payload);
  emit();
}

export function applyClientUpdate(c) {
  if (!c || !c.id) return;
  let touched = false;
  const byId = new Map(state.byId);
  for (const [id, d] of byId) {
    if (d.clientId !== c.id || !d.client) continue;
    const next = { ...d.client };
    for (const k of ['rating', 'isWhale', 'avatarUrl', 'phone', 'email', 'lifetimeVolume', 'lifetimeGci', 'firstName', 'lastName', 'displayName']) if (c[k] !== undefined) next[k] = c[k];
    if (c.firstName !== undefined || c.lastName !== undefined || c.displayName !== undefined) {
      next.name = c.displayName || [c.firstName ?? next.firstName, c.lastName ?? next.lastName].filter(Boolean).join(' ').trim() || next.name;
    }
    next.whale = !!next.isWhale || (next.lifetimeVolume || 0) >= 10000000;
    byId.set(id, { ...d, client: next, name: next.name });
    touched = true;
  }
  if (touched) { state = { ...state, byId }; emit(); }
}

// ── hooks ──────────────────────────────────────────────────────────────────
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snap = () => state;
export function useDealStore() { return useSyncExternalStore(subscribe, snap, snap); }

export function useBoardDeals() {
  const s = useDealStore();
  const deals = useMemo(() => [...s.boardIds].map((id) => s.byId.get(id)).filter(Boolean), [s.byId, s.boardIds]);
  return { deals, status: s.status, error: s.error, loadedAt: s.loadedAt };
}

export function useDeal(id) {
  const s = useDealStore();
  useEffect(() => { if (id && !state.byId.has(id)) loadDeal(id).catch(() => {}); }, [id]);
  return id ? s.byId.get(id) || null : null;
}

// Mount once per surface that shows deals: realtime + silent resync.
export function useDealRealtime({ board = false } = {}) {
  useSocket(['deal_created', 'deal_updated', 'deal_deleted'], (payload, raw, name) => applyRemote(name, payload));
  useSocket('client_updated', (c) => applyClientUpdate(c));
  useResync(() => { if (board) loadBoard({ silent: true }).catch(() => {}); });
}

export { stageForPhase };

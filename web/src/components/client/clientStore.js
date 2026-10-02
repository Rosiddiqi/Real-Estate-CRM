// clientStore — the clients area's in-memory identity layer (RevMatch
// "contactIdentity" overlay, simplified):
//  • a module cache of the last-fetched client (detail or list row) so the
//    card paints instantly when it opens, then revalidates silently;
//  • an optimistic patch overlay so an edit repaints every list/card in the
//    same frame, with rollback on failure;
//  • live reconciliation from the `client_updated` socket event.
import { useSyncExternalStore } from 'react';
import { ws } from '../../api/ws';

const cache = new Map();      // id -> last known client object (detail ⊇ list row)
const overlay = new Map();    // id -> optimistic patch (applied over cache)
const removed = new Set();    // optimistically deleted ids
const subs = new Set();
let version = 0;

function emit() {
  version += 1;
  for (const fn of subs) { try { fn(); } catch { /* ignore */ } }
}

export const clientStore = {
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  getVersion: () => version,

  get(id) {
    if (!id) return null;
    const base = cache.get(id);
    const o = overlay.get(id);
    if (!base && !o) return null;
    return { ...(base || {}), ...(o || {}) };
  },

  // Remember a row/detail without clobbering richer data we already hold.
  seed(row) {
    if (!row || !row.id) return;
    const prev = cache.get(row.id);
    cache.set(row.id, prev ? { ...prev, ...row } : row);
  },
  seedMany(rows) { for (const r of rows || []) this.seed(r); },

  setDetail(detail) {
    if (!detail || !detail.id) return;
    const prev = cache.get(detail.id);
    cache.set(detail.id, { ...(prev || {}), ...detail, _detail: true });
    emit();
  },

  // Optimistic patch → returns an undo function.
  patch(id, patch) {
    const prev = overlay.get(id);
    overlay.set(id, { ...(prev || {}), ...patch });
    emit();
    return () => {
      if (prev) overlay.set(id, prev); else overlay.delete(id);
      emit();
    };
  },

  // Server copy arrived: fold it into the cache and drop the overlay keys it settles.
  commit(row) {
    if (!row || !row.id) return;
    const prev = cache.get(row.id);
    cache.set(row.id, { ...(prev || {}), ...row });
    const o = overlay.get(row.id);
    if (o) {
      const rest = {};
      for (const [k, v] of Object.entries(o)) if (JSON.stringify(row[k]) !== JSON.stringify(v) && !(k in row)) rest[k] = v;
      if (Object.keys(rest).length) overlay.set(row.id, rest); else overlay.delete(row.id);
    }
    if (row.archivedAt) removed.add(row.id); else removed.delete(row.id);
    emit();
  },

  markRemoved(id) { removed.add(id); emit(); return () => { removed.delete(id); emit(); }; },
  isRemoved: (id) => removed.has(id),

  // Read list rows through the overlay (edits + deletes everywhere at once).
  apply(rows) {
    if (!rows) return rows;
    const out = [];
    for (const r of rows) {
      if (removed.has(r.id)) continue;
      const o = overlay.get(r.id);
      out.push(o ? { ...r, ...o } : r);
    }
    return out;
  },
};

// Live: another device (or Serena, or an import) changed a client.
ws.on('client_updated', (payload) => {
  if (payload && payload.id && (payload.firstName !== undefined || payload.archivedAt !== undefined || payload.name !== undefined)) {
    clientStore.commit(payload);
  }
});

export function useClientStoreVersion() {
  return useSyncExternalStore(clientStore.subscribe, clientStore.getVersion, clientStore.getVersion);
}

export function useClientIdentity(id) {
  useClientStoreVersion();
  return clientStore.get(id);
}

export default clientStore;

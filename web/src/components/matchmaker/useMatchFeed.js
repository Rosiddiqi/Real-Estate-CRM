// Feed hook for the Matchmaker modes: instant paint from a module cache, then
// a silent refetch; live via listing_updated / match_new / resync.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getFeed } from '../../api/matchmaker';
import { useListingsLive } from '../listings/listingKit';

const cache = {};

export function useMatchFeed(mode) {
  const [data, setData] = useState(cache[mode] || null);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => getFeed(mode)
    .then((d) => { cache[mode] = d; if (alive.current) { setData(d); setError(null); } })
    .catch((err) => { if (alive.current) setError(err.message || 'Could not load'); }), [mode]);
  useEffect(() => { load(); }, [load]);
  useListingsLive(load);
  const patch = useCallback((fn) => setData((d) => { const next = fn(d); cache[mode] = next; return next; }), [mode]);
  return { data, error, reload: load, patch };
}

export function invalidateFeeds() {
  for (const k of Object.keys(cache)) delete cache[k];
}

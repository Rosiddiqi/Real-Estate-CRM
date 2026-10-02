// Data hooks for the campaign surfaces — fetch, realtime refetch (debounced
// `campaign_updated`), silent resync on reconnect/foreground.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useResync, useSocket } from '../../hooks/useSocket';
import { listCampaigns, listAutomations, listSuggestions, liveThreads, getCampaign } from '../../api/campaigns';

function useDebounced(fn, ms = 350) {
  const t = useRef(null);
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return useCallback(() => { clearTimeout(t.current); t.current = setTimeout(() => f.current(), ms); }, [ms]);
}

// Generic loader: { data, error, loading, reload, setData }
export function useLoader(fetcher, deps = [], { events = ['campaign_updated'], poll = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const reload = useCallback(() => {
    return fetchRef.current()
      .then((d) => { if (alive.current) { setData(d); setError(null); } return d; })
      .catch((e) => { if (alive.current) setError(e); })
      .finally(() => { if (alive.current) setLoading(false); });
  }, []);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    reload();
    return () => { alive.current = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!poll) return undefined;
    const id = setInterval(reload, poll);
    return () => clearInterval(id);
  }, [poll, reload]);
  const soon = useDebounced(reload, 400);
  useSocket(events, soon);
  useResync(reload);
  return { data, error, loading, reload, setData };
}

export function useCampaignList() {
  return useLoader(() => listCampaigns(), [], { poll: 30000 });
}

export function useAutomations() {
  return useLoader(() => listAutomations(), [], { poll: 60000 });
}

export function useSuggestions(campaignId) {
  return useLoader(() => listSuggestions(campaignId), [campaignId], { poll: 45000 });
}

export function useLiveThreads() {
  return useLoader(() => liveThreads(), [], { events: ['campaign_updated', 'conversation_updated', 'message_received'], poll: 30000 });
}

export function useCampaign(id) {
  return useLoader(() => getCampaign(id), [id], { events: ['campaign_updated', 'message_received'], poll: 20000 });
}

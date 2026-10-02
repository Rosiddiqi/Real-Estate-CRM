// Data hooks for the campaign surfaces — fetch, realtime refetch (debounced
// `campaign_updated`), silent resync on reconnect/foreground.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useResync, useSocket } from '../../hooks/useSocket';
import { toast } from '../ui/toast';
import { listCampaigns, listAutomations, listSuggestions, liveThreads, getCampaign, updateAutomation, getMessagingStatus } from '../../api/campaigns';

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

// Optimistic automation on/off with rollback. Turning one on without a brief
// opens the editor instead (onNeedsBrief) — the brief IS the approval.
export function useAutomationToggle(autos, onNeedsBrief) {
  const [busyId, setBusyId] = useState(null);
  const toggle = async (a, next) => {
    if (next && !String(a.brief || '').trim() && a.trigger !== 'post_closing') { onNeedsBrief && onNeedsBrief(a); return; }
    const prev = autos.data;
    autos.setData((d) => (d ? { ...d, automations: d.automations.map((x) => (x.id === a.id ? { ...x, enabled: next } : x)) } : d));
    setBusyId(a.id);
    try {
      await updateAutomation(a.id, { enabled: next });
      toast.success(next ? `${a.name} is on` : `${a.name} is off`);
    } catch (e) {
      autos.setData(prev);
      toast.error(e.message || 'Could not update');
    } finally {
      setBusyId(null);
    }
  };
  return { busyId, toggle };
}

// The workspace's messaging mode from GET /api/bridge (messaging.mode:
// 'twilio' | 'demo' | 'device'; missing → 'demo'), shared by every campaign
// surface. In 'device' mode nothing automated can send: launch / resume /
// approve-and-send are disabled and a calm banner explains why.
let modeState = { mode: 'demo', at: 0, loading: false };
const modeSubs = new Set();
function refreshMode(force = false) {
  if (modeState.loading || (!force && modeState.at && Date.now() - modeState.at < 60000)) return;
  modeState = { ...modeState, loading: true };
  getMessagingStatus()
    .then((d) => { modeState = { mode: (d && d.messaging && d.messaging.mode) || 'demo', at: Date.now(), loading: false }; })
    .catch(() => { modeState = { ...modeState, at: Date.now(), loading: false }; })
    .finally(() => modeSubs.forEach((fn) => fn(modeState)));
}

export function useMessagingMode() {
  const [st, setSt] = useState(modeState);
  useEffect(() => {
    modeSubs.add(setSt);
    refreshMode(false);
    const id = setInterval(() => refreshMode(false), 60000);
    return () => { modeSubs.delete(setSt); clearInterval(id); };
  }, []);
  useResync(() => refreshMode(true));
  return st.mode;
}

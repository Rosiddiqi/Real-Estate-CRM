// Phone tab (center slot — the easiest thumb tap). RevMatch CallsScreen,
// re-geared: Call now hero (who to call and why) · Recents · Voicemail ·
// Missed, unheard-voicemail bubbles, day-grouped recents with sticky headers,
// keypad + search sheets, save-contact for unknown numbers. Opening the tab
// clears the missed-call badge.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import PillTabs from '../../components/ui/PillTabs';
import Avatar from '../../components/ui/Avatar';
import { EmptyState, SkeletonRows } from '../../components/ui/kit';
import { toast } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { BRAND } from '../../brand';
import { firstName } from '../../lib/format';
import { markSeen, bumpBadges } from '../../api/system';
import { listCalls, markHeard } from '../../api/calls';
import { useResync, useSocket } from '../../hooks/useSocket';
import CallRow from '../../components/calls/CallRow';
import VoicemailCard from '../../components/calls/VoicemailCard';
import KeypadSheet from '../../components/calls/KeypadSheet';
import SaveContactSheet from '../../components/calls/SaveContactSheet';
import CallSearchSheet from '../../components/calls/CallSearchSheet';
import CallNowHero from '../../components/calls/CallNowHero';
import { classify, callName, dayGroup, shortTime } from '../../components/calls/callUtil';
import '../../styles/calls.css';

const TAB_KEY = 'km_calls_tab';
const TABS = ['recents', 'voicemail', 'missed'];

function readTab() {
  try { const v = localStorage.getItem(TAB_KEY); if (TABS.includes(v)) return v; } catch { /* ignore */ }
  return 'recents';
}

function VoicemailBubbles({ calls, onOpen }) {
  if (!calls.length) return null;
  return (
    <section>
      <div className="km-ph-section-head" style={{ paddingBottom: 2 }}>
        <span className="km-eyebrow">New voicemails</span>
        <span className="km-badge">{calls.length}</span>
      </div>
      <div className="km-vm-bubbles km-scroll-x">
        {calls.map((c) => (
          <button key={c.id} type="button" className="km-vm-bubble km-press" onClick={() => onOpen(c)}>
            <span className="km-vm-ring km-mat km-mat--thin">
              <Avatar name={c.client ? callName(c) : null} seed={c.clientId || c.otherNumber} src={c.client?.avatarUrl} size={48} />
              <span className="km-vm-dot" />
            </span>
            <span className="km-vm-bname km-truncate">{c.client ? firstName(c.client) : callName(c)}</span>
            <span className="km-vm-btime">{shortTime(c.startedAt)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function PhonePage() {
  const [tab, setTabState] = useState(readTab);
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);
  const [keypad, setKeypad] = useState(false);
  const [search, setSearch] = useState(false);
  const [saveFor, setSaveFor] = useState(null);
  const timer = useRef(null);
  const scrollRef = useRef(null);

  const setTab = (t) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Deep links (a missed-call / voicemail notification) while this tab is already up.
  useEffect(() => {
    const onTab = (e) => { const t = e && e.detail && e.detail.tab; if (TABS.includes(t)) setTabState(t); };
    window.addEventListener('calls:tab', onTab);
    return () => window.removeEventListener('calls:tab', onTab);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await listCalls({ limit: 200 });
      setCalls(r.calls || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Couldn’t load calls');
      setCalls((c) => c || []);
    }
  }, []);

  useEffect(() => {
    load();
    markSeen('calls').then(bumpBadges).catch(() => {});
  }, [load]);
  useResync(load);
  useSocket(['call_updated'], () => { clearTimeout(timer.current); timer.current = setTimeout(load, 500); });
  useEffect(() => () => clearTimeout(timer.current), []);

  const counts = useMemo(() => {
    const out = { recents: 0, voicemail: 0, missed: 0, unheard: 0 };
    for (const c of calls || []) {
      const k = classify(c);
      out.recents += 1;
      if (k === 'voicemail') { out.voicemail += 1; if (!c.voicemailHeard) out.unheard += 1; }
      if (k === 'missed' || k === 'voicemail') out.missed += 1;
    }
    return out;
  }, [calls]);

  const visible = useMemo(() => (calls || []).filter((c) => {
    const k = classify(c);
    if (tab === 'voicemail') return k === 'voicemail';
    if (tab === 'missed') return k === 'missed' || k === 'voicemail';
    return true;
  }), [calls, tab]);

  const groups = useMemo(() => {
    const out = [];
    for (const c of visible) {
      const label = dayGroup(c.startedAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(c); else out.push({ label, items: [c] });
    }
    return out;
  }, [visible]);

  const callBack = (c) => nav.call({ clientId: c.clientId || undefined, phone: c.otherNumber || c.client?.phone, name: c.client ? c.client.name : undefined });
  const openInfo = (c) => { if (c.clientId) nav.openClient(c.clientId); };
  const textBack = (c) => nav.openThread(c.clientId ? { clientId: c.clientId } : { handle: c.otherNumber });
  const heard = async (c) => {
    setCalls((list) => (list || []).map((x) => (x.id === c.id ? { ...x, voicemailHeard: true } : x)));
    try { await markHeard(c.id); } catch { setCalls((list) => (list || []).map((x) => (x.id === c.id ? { ...x, voicemailHeard: false } : x))); toast.error('Couldn’t update that voicemail'); }
  };
  const openVoicemail = (c) => {
    setTab('voicemail');
    setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${c.id}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('km-focus-flash'); setTimeout(() => el.classList.remove('km-focus-flash'), 2300); }
    }, 260);
  };

  const unheard = (calls || []).filter((c) => classify(c) === 'voicemail' && !c.voicemailHeard);
  const stats = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    let today = 0; let missedToday = 0;
    for (const c of calls || []) {
      if (!c.startedAt || new Date(c.startedAt) < start) continue;
      today += 1;
      const k = classify(c);
      if (k === 'missed' || k === 'voicemail') missedToday += 1;
    }
    return { today, missedToday };
  }, [calls]);

  return (
    <div className="km-screen">
      <header className="km-ph-head">
        <div className="km-ph-head-row">
          <span className="km-ph-eyebrow">{String(BRAND.name || 'KeyMatch').toUpperCase()}</span>
          <GlassButton icon="search" label="Search calls" onClick={() => setSearch(true)} />
        </div>
        <div>
          <h1 className="km-ph-title">Phone</h1>
          <div className="km-ph-stats">
            {calls === null ? null : stats.today ? (
              <>
                <span><b>{stats.today}</b> {stats.today === 1 ? 'call' : 'calls'} today</span>
                {stats.missedToday ? <><span className="km-ph-dotsep">·</span><span><b style={{ color: 'var(--red)' }}>{stats.missedToday}</b> missed</span></> : null}
                {counts.unheard ? <><span className="km-ph-dotsep">·</span><span><b style={{ color: 'var(--violet)' }}>{counts.unheard}</b> new {counts.unheard === 1 ? 'voicemail' : 'voicemails'}</span></> : null}
              </>
            ) : (
              <span>{counts.unheard ? <><b style={{ color: 'var(--violet)' }}>{counts.unheard}</b> new {counts.unheard === 1 ? 'voicemail' : 'voicemails'} · </> : null}No calls yet today</span>
            )}
          </div>
        </div>
      </header>
      <div className="km-scroll km-ph-body" ref={scrollRef}>
        <div className="km-ph-wrap">
          <CallNowHero />
          <div className="km-ph-tabs">
            <PillTabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'recents', label: 'Recents' },
                { id: 'voicemail', label: 'Voicemail', count: counts.unheard || undefined },
                { id: 'missed', label: 'Missed', count: counts.missed || undefined },
              ]}
            />
          </div>

          {tab === 'recents' ? <VoicemailBubbles calls={unheard} onOpen={openVoicemail} /> : null}

          {calls === null ? (
            <div style={{ padding: '4px 16px' }}><SkeletonRows n={7} /></div>
          ) : error && !calls.length ? (
            <EmptyState icon="alert" title="Couldn’t load calls" sub={error} action={<button type="button" className="km-btn km-btn--ghost km-btn--sm" onClick={load}>Try again</button>} />
          ) : !visible.length ? (
            tab === 'voicemail'
              ? <EmptyState icon="voicemail" title="No voicemails" sub="When a client leaves a message, it lands here with a transcript." />
              : tab === 'missed'
                ? <EmptyState icon="phoneMissed" title="No missed calls" sub="You’re all caught up." />
                : <EmptyState icon="phone" title="No calls yet" sub="Tap the keypad to dial, or call someone from Call now." />
          ) : tab === 'voicemail' ? (
            <div style={{ paddingBottom: 8 }}>
              {visible.map((c, i) => <VoicemailCard key={c.id} call={c} index={i} onCall={callBack} onText={textBack} onHeard={heard} onInfo={openInfo} />)}
            </div>
          ) : (
            groups.map((g) => (
              <Fragment key={g.label}>
                <div className="km-ph-day">{g.label}<span style={{ fontWeight: 500, letterSpacing: 0 }}>{g.items.length}</span></div>
                <div>
                  {g.items.map((c, i) => (classify(c) === 'voicemail' && tab === 'missed'
                    ? <VoicemailCard key={c.id} call={c} index={i} onCall={callBack} onText={textBack} onHeard={heard} onInfo={openInfo} />
                    : <CallRow key={c.id} call={c} index={i} onCall={callBack} onInfo={openInfo} onSave={(x) => setSaveFor(x)} />))}
                </div>
              </Fragment>
            ))
          )}
        </div>
      </div>

      <button type="button" className="km-ph-fab" aria-label="Keypad" onClick={() => setKeypad(true)}>
        <Icon name="keypad" size={26} stroke={2} />
      </button>

      <KeypadSheet open={keypad} onClose={() => setKeypad(false)} recents={calls || []}
        onDial={({ phone, clientId, name }) => { setKeypad(false); setTimeout(() => nav.call({ phone, clientId, name }), 260); }} />
      <CallSearchSheet open={search} onClose={() => setSearch(false)} onCall={callBack} onInfo={openInfo} onSave={(x) => setSaveFor(x)} />
      <SaveContactSheet open={!!saveFor} phone={saveFor?.otherNumber} onClose={() => setSaveFor(null)} onSaved={() => load()} />
    </div>
  );
}

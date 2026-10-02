// ClientCard — the heart of KeyMatch (RevMatch ContactCard, re-geared).
// PushPanel z250 that paints instantly from the list row (clientStore) and
// revalidates: Ignition hero → Profile · Notes · Timeline · Appts · Portfolio.
// The hero folds away as you scroll a tab (or focus a composer) and the name
// rides into the bar. Live via client_updated / activity_created / deal_*.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../../styles/clients.css';
import PushPanel, { usePanel } from '../ui/PushPanel';
import PillTabs from '../ui/PillTabs';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { EmptyState, Button } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { formatPhone } from '../../lib/format';
import { haptic } from '../../lib/native';
import { getClient, updateClient, deleteClient, restoreClient, blockClient, unblockClient, clientActivity, clientBriefing } from '../../api/clients';
import { useSocket, useResync } from '../../hooks/useSocket';
import { clientStore, useClientStoreVersion } from './clientStore';
import { ActionSheet, copyText, displayName } from './clientKit';
import CardHero from './card/CardHero';
import TimelineTab from './card/TimelineTab';
import ProfileTab from './card/ProfileTab';
import NotesTab from './card/NotesTab';
import ApptsTab from './card/ApptsTab';
import EditClientSheet from './EditClientSheet';
import LinkSheet from './LinkSheet';
import PortfolioTab from '../portfolio/PortfolioTab';
import PropertyDetail from '../portfolio/PropertyDetail';
import { useAssistant } from '../../hooks/useAssistant';

const TABS = ['Profile', 'Notes', 'Timeline', 'Appts', 'Portfolio'];

function vcard(c) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${displayName(c)}`, `N:${c.lastName || ''};${c.firstName || ''};;;`];
  if (c.company) lines.push(`ORG:${c.company}`);
  if (c.jobTitle) lines.push(`TITLE:${c.jobTitle}`);
  if (c.phone) lines.push(`TEL;TYPE=CELL:${formatPhone(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${c.email}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

function CardBar({ client, collapsed, onExpand, onMore, loading }) {
  const { requestClose } = usePanel();
  const st = nav.getState();
  const backLabel = st.overlays.length <= 1 && st.tab === 'clients' ? 'Clients' : 'Back';
  return (
    <div className="kc-card-top">
      {loading ? <div className="kc-shimmer" /> : null}
      <div className="kc-card-bar">
        <button type="button" className="kc-back km-press" onClick={requestClose} aria-label="Back">
          <Icon name="chevronLeft" size={22} stroke={2.2} /> {backLabel}
        </button>
        <button type="button" className={`kc-bar-title ${collapsed && client ? 'kc-bar-title--on' : ''}`} onClick={onExpand} aria-hidden={!collapsed}>
          {client ? <Avatar name={displayName(client)} seed={client.id} src={client.avatarUrl} size={24} /> : null}
          <span className="km-truncate" style={{ maxWidth: '44vw' }}>{client ? displayName(client) : ''}</span>
        </button>
        <div style={{ justifySelf: 'end' }}>
          <button type="button" className="km-lg km-lg--line km-press" onClick={onMore} aria-label="More" style={{ width: 34, height: 34, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lg-text)' }}>
            <Icon name="more" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientCard({ id, tab: tabProp, onClose }) {
  const { name: assistant } = useAssistant();
  useClientStoreVersion();
  const client = clientStore.get(id);
  const [loaded, setLoaded] = useState(!!(client && client._detail));
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState(TABS.includes(tabProp) ? tabProp : 'Timeline');
  const [pfBucket, setPfBucket] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [activity, setActivity] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openProperty, setOpenProperty] = useState(null);
  const [heroH, setHeroH] = useState(420);
  const heroRef = useRef(null);
  const toggleLock = useRef(0);
  const pollRef = useRef({ n: 0, t: null });
  const busy = useRef(false);
  const threadScroll = useRef(new Map());

  // Re-targeted to another client without unmounting → reset during render.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setActivity(null); setBriefing(null); setBriefingLoading(true); setMissing(false);
    setLoaded(!!(clientStore.get(id) && clientStore.get(id)._detail)); setCollapsed(false); setOpenProperty(null);
  }

  const refresh = useCallback(async () => {
    try {
      const r = await getClient(id);
      clientStore.setDetail(r.client);
      setLoaded(true); setMissing(false);
    } catch (e) {
      if (e.status === 404) setMissing(true);
      else if (!clientStore.get(id)) toast.error(e.message || 'Couldn’t load this client');
    }
  }, [id]);

  const loadActivity = useCallback(() => {
    clientActivity(id, { limit: 250 }).then((r) => setActivity(r.activity || [])).catch(() => setActivity((a) => a || []));
  }, [id]);

  const loadBriefing = useCallback(async (force = false) => {
    clearTimeout(pollRef.current.t);
    if (force) setRefreshing(true);
    try {
      const r = await clientBriefing(id, force);
      setBriefing(r.briefing || null);
      if (r.briefing && r.briefing.pending && pollRef.current.n < 4) {
        pollRef.current.n += 1;
        pollRef.current.t = setTimeout(() => loadBriefing(false), 7000);
      }
    } catch { /* briefing is optional */ }
    setBriefingLoading(false);
    if (force) setRefreshing(false);
  }, [id]);

  useEffect(() => {
    pollRef.current = { n: 0, t: null };
    refresh(); loadActivity(); loadBriefing(false);
    return () => clearTimeout(pollRef.current.t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const soonT = useRef(null);
  const refreshSoon = useCallback(() => { clearTimeout(soonT.current); soonT.current = setTimeout(refresh, 300); }, [refresh]);
  const actT = useRef(null);
  const activitySoon = useCallback(() => { clearTimeout(actT.current); actT.current = setTimeout(loadActivity, 300); }, [loadActivity]);
  // The status line / next move follow the record: anything that lands on the
  // timeline (a call, a property, a deal move) re-reads the briefing — the
  // server answers from cache unless something newer invalidated it.
  const brT = useRef(null);
  const briefingSoon = useCallback(() => {
    clearTimeout(brT.current);
    brT.current = setTimeout(() => { pollRef.current.n = 0; loadBriefing(false); }, 1500);
  }, [loadBriefing]);
  useEffect(() => () => { clearTimeout(soonT.current); clearTimeout(actT.current); clearTimeout(brT.current); }, []);
  useSocket('client_updated', (p) => { if (p && p.id === id) refreshSoon(); });
  useSocket('activity_created', (p) => { if (p && p.clientId === id) { activitySoon(); briefingSoon(); if (/^(deal|property|search)/.test(p.type || '')) refreshSoon(); } });
  useSocket(['deal_created', 'deal_updated', 'deal_deleted'], (p) => { if (p && p.clientId === id) { refreshSoon(); activitySoon(); briefingSoon(); } });
  useResync(() => { refresh(); loadActivity(); });

  useLayoutEffect(() => {
    const el = heroRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setHeroH(el.scrollHeight));
    ro.observe(el);
    setHeroH(el.scrollHeight);
    return () => ro.disconnect();
  }, [loaded, !!client]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCollapsedLocked = (v) => {
    if (Date.now() < toggleLock.current) return;
    setCollapsed((cur) => {
      if (cur === v) return cur;
      toggleLock.current = Date.now() + 380;
      return v;
    });
  };
  const onPaneScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop > 48 && el.scrollHeight - el.clientHeight > 140) setCollapsedLocked(true);
    else if (el.scrollTop <= 2) setCollapsedLocked(false);
  };
  const changeTab = (t) => { setTab(t); setCollapsed(false); toggleLock.current = 0; threadScroll.current = new Map(); };

  // ── optimistic patch ────────────────────────────────────────────────
  const patch = async (p) => {
    const undo = clientStore.patch(id, p);
    try {
      const r = await updateClient(id, p);
      clientStore.commit(r.client);
    } catch (e) {
      undo();
      toast.error(`${e.message || 'Couldn’t save'} — undone`);
    }
  };

  // ── actions ─────────────────────────────────────────────────────────
  const c = client;
  const call = () => { if (!c?.phone) return toast('No phone number on this client'); haptic('light'); return nav.call({ clientId: id, phone: c.phone, name: displayName(c) }); };
  const text = () => nav.openThread({ clientId: id, name: c ? displayName(c) : undefined });
  const email = () => { if (!c?.email) return toast('No email on this client'); window.location.href = `mailto:${c.email}`; return null; };
  const meet = () => nav.newAppointment({ clientId: id, title: c ? `Showing with ${c.firstName || displayName(c)}` : undefined });

  const share = async () => {
    const card = vcard(c);
    try {
      if (navigator.share) await navigator.share({ title: displayName(c), text: card });
      else { await copyText(card); toast.success('Contact card copied'); }
    } catch { /* cancelled */ }
  };
  const toggleBlock = async () => {
    if (busy.current) return;
    if (!c.blocked && !(await confirm({ title: `Block ${displayName(c)}?`, message: 'Their texts and calls stop reaching you. You can unblock anytime.', confirmLabel: 'Block', destructive: true }))) return;
    busy.current = true;
    const undo = clientStore.patch(id, { blocked: !c.blocked });
    try {
      const r = c.blocked ? await unblockClient(id) : await blockClient(id);
      clientStore.commit(r.client);
      toast(r.client.blocked ? 'Blocked' : 'Unblocked');
    } catch (e) { undo(); toast.error(e.message || 'Couldn’t update'); }
    busy.current = false;
  };
  const remove = async () => {
    if (busy.current) return;
    if (!(await confirm({ title: `Delete ${displayName(c)}?`, message: 'The card leaves your book. Messages and deals stay in their threads — you can undo right after.', confirmLabel: 'Delete client', destructive: true }))) return;
    busy.current = true;
    const name = displayName(c);
    try {
      await deleteClient(id);
      clientStore.markRemoved(id);
      onClose?.();
      toast(`${name} deleted`, { action: { label: 'Undo', onClick: async () => { try { const r = await restoreClient(id); clientStore.commit(r.client); nav.openClient(id); } catch { toast.error('Couldn’t restore'); } } } });
    } catch (e) { toast.error(e.message || 'Couldn’t delete'); }
    busy.current = false;
  };

  const menuActions = c ? [
    { label: 'Edit client', icon: 'edit', onClick: () => setEdit('identity') },
    { label: 'Share contact', icon: 'share', onClick: share },
    c.phone ? { label: 'Copy phone number', icon: 'copy', onClick: () => { copyText(formatPhone(c.phone)); toast('Phone copied'); } } : null,
    c.email ? { label: 'Copy email', icon: 'at', onClick: () => { copyText(c.email); toast('Email copied'); } } : null,
    { label: `Ask ${assistant} about them`, icon: 'sparkle', onClick: () => nav.openSerena('chat', `Tell me about ${displayName(c)} and what I should do next.`) },
    { label: c.blocked ? 'Unblock' : 'Block', icon: 'lock', onClick: toggleBlock },
    { label: 'Delete client', icon: 'trash', danger: true, onClick: remove },
  ] : [];

  const slug = c ? `${(c.firstName || 'client').toLowerCase()}-${id.slice(0, 6)}` : '';
  const videoActions = c ? [
    c.phone ? { label: 'FaceTime', icon: 'video', onClick: () => { window.location.href = `facetime:+1${String(c.phone).replace(/\D/g, '').slice(-10)}`; } } : null,
    c.phone ? { label: 'FaceTime Audio', icon: 'phone', onClick: () => { window.location.href = `facetime-audio:+1${String(c.phone).replace(/\D/g, '').slice(-10)}`; } } : null,
    { label: 'Send a video-call link', icon: 'link', onClick: () => nav.openThread({ clientId: id, draft: `Here’s a link for our video call — tap in whenever you’re ready: https://meet.keymatch.app/${slug}` }) },
    { label: 'Schedule a video call', icon: 'calendar', onClick: () => nav.newAppointment({ clientId: id, type: 'video', title: `Video call with ${c.firstName || displayName(c)}` }) },
  ] : [];

  // ── render ──────────────────────────────────────────────────────────
  return (
    <PushPanel onClose={onClose} zIndex={250} header={false} scroll={false} background="var(--kc-card-bg)" className="kc-card">
      <CardBar client={c} collapsed={collapsed} loading={!loaded && !missing} onExpand={() => { setCollapsed(false); toggleLock.current = Date.now() + 380; }} onMore={() => setMenuOpen(true)} />

      {missing && !c ? (
        <EmptyState icon="users" title="Client not found" sub="They may have been deleted on another device." />
      ) : !c ? (
        <div style={{ flex: 1 }} />
      ) : (
        <>
          {c.archivedAt ? (
            <div style={{ margin: '0 16px 6px', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
              <Icon name="trash" size={15} color="var(--red)" />
              <span style={{ flex: 1 }}>This client was deleted.</span>
              <Button size="sm" variant="ghost" onClick={async () => { try { const r = await restoreClient(id); clientStore.commit(r.client); refresh(); } catch (e) { toast.error(e.message); } }}>Restore</Button>
            </div>
          ) : null}
          <div className="kc-hero-collapse" style={{ maxHeight: collapsed ? 0 : heroH + 8, opacity: collapsed ? 0 : 1 }} aria-hidden={collapsed}>
            <div ref={heroRef} style={{ paddingBottom: 4 }}>
              <CardHero
                client={c}
                briefing={briefing}
                onWhale={(v) => { haptic('light'); patch({ isWhale: v }); }}
                onRate={(v) => { haptic('light'); patch({ rating: v }); }}
                onCall={call}
                onText={text}
                onEmail={email}
                onMeet={meet}
                onVideo={() => setVideoOpen(true)}
                onSummary={() => changeTab('Profile')}
                onReferrer={() => c.referredBy && nav.openClient(c.referredBy.id)}
              />
            </div>
          </div>

          <div className="kc-tabs">
            <PillTabs size="sm" items={TABS.map((t) => ({ id: t, label: t }))} value={tab} onChange={changeTab} />
          </div>

          <div
            className="kc-content"
            onFocusCapture={(e) => { if (tab === 'Timeline' && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) setCollapsedLocked(true); }}
            onWheelCapture={() => { threadScroll.current.userAt = Date.now(); }}
            onTouchMoveCapture={() => { threadScroll.current.userAt = Date.now(); }}
            onScrollCapture={(e) => {
              if (tab !== 'Timeline') return;
              // The reader scrolling the thread (either direction, past a small
              // slop) folds the hero away. Programmatic scrolls — the thread
              // pinning itself to the newest message — never count.
              const el = e.target;
              if (!el || typeof el.scrollTop !== 'number') return;
              const prev = threadScroll.current.get(el);
              threadScroll.current.set(el, el.scrollTop);
              if (Date.now() - (threadScroll.current.userAt || 0) > 700) return;
              if (prev != null && Math.abs(el.scrollTop - prev) > 2) {
                threadScroll.current.moved = (threadScroll.current.moved || 0) + Math.abs(el.scrollTop - prev);
                if (threadScroll.current.moved > 36) setCollapsedLocked(true);
              }
            }}
          >
            {tab === 'Timeline' ? (
              <TimelineTab
                client={c}
                activity={activity}
                loading={activity === null}
                onChanged={() => { loadActivity(); }}
                onOpenProperty={(pid) => setOpenProperty({ id: pid })}
                onOpenTab={(t, b) => { if (b) setPfBucket(b); changeTab(t); }}
              />
            ) : tab === 'Profile' ? (
              <ProfileTab
                client={c}
                briefing={briefing}
                briefingLoading={briefingLoading}
                refreshing={refreshing}
                onRefreshBriefing={() => loadBriefing(true)}
                onEdit={(s) => setEdit(s)}
                onAddLink={() => setLinkOpen(true)}
                onChanged={refresh}
                onScroll={onPaneScroll}
              />
            ) : tab === 'Notes' ? (
              <NotesTab client={c} onScroll={onPaneScroll} onFocusChange={(f) => { if (f) setCollapsedLocked(true); }} />
            ) : tab === 'Appts' ? (
              <ApptsTab client={c} onScroll={onPaneScroll} />
            ) : (
              <PortfolioTab
                client={c}
                loaded={loaded}
                bucket={pfBucket}
                onBucket={setPfBucket}
                onOpenProperty={(p) => setOpenProperty({ id: p.id, seed: p })}
                onChanged={refresh}
                onScroll={onPaneScroll}
              />
            )}
          </div>

          <EditClientSheet client={c} section={edit} open={!!edit} onClose={() => setEdit(null)} onSaved={() => { refresh(); loadBriefing(false); }} />
          <LinkSheet client={c} open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={refresh} />
          <ActionSheet open={menuOpen} title={displayName(c)} actions={menuActions} onClose={() => setMenuOpen(false)} />
          <ActionSheet open={videoOpen} title={`Video with ${c.firstName || displayName(c)}`} actions={videoActions} onClose={() => setVideoOpen(false)} />
          {openProperty ? (
            <PropertyDetail
              id={openProperty.id}
              seed={openProperty.seed}
              client={c}
              onClose={() => setOpenProperty(null)}
              onChanged={refresh}
            />
          ) : null}
        </>
      )}
    </PushPanel>
  );
}

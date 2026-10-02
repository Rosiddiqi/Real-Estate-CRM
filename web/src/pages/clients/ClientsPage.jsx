// Clients tab — RevMatch Contacts, re-geared: fluted header → Clients ·
// Partners · Vendors → search + A–Z/Newest → letter (or day) sections with
// sticky headers → rows that swipe left to delete → "+" FAB. Alphabet
// scrubber on the right edge. Everything persists per device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/clients.css';
import { nav } from '../../lib/nav';
import { api } from '../../api/client';
import { listClients, deleteClient, restoreClient } from '../../api/clients';
import { useSocket, useResync } from '../../hooks/useSocket';
import Icon from '../../components/ui/Icon';
import Avatar from '../../components/ui/Avatar';
import GlassButton from '../../components/ui/GlassButton';
import PillTabs from '../../components/ui/PillTabs';
import { EmptyState, Skeleton, Stars, Button } from '../../components/ui/kit';
import { toast, confirm } from '../../components/ui/toast';
import { clientStore, useClientStoreVersion } from '../../components/client/clientStore';
import { KIND_TABS, displayName, subLine, SwipeRow } from '../../components/client/clientKit';

const KIND_KEY = 'km-clients-kind';
const SORT_KEY = 'km-clients-sort';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const cache = new Map(); // `${kind}:${sort}` -> { rows, counts }

const readLS = (k, d, ok) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function sortKey(c) {
  const last = (c.lastName || '').trim();
  const first = (c.firstName || '').trim();
  if (last) return `${last} ${first}`;
  if (first) return first;
  return displayName(c);
}
function letterOf(c) {
  const ch = sortKey(c).trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}
function dayLabel(d) {
  const date = new Date(d);
  const now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(date, now)) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (same(date, y)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function Name({ c, az }) {
  const first = (c.firstName || '').trim();
  const last = (c.lastName || '').trim();
  if (az && first && last && !c.displayName) {
    return <span className="km-truncate"><span className="kc-light">{first} </span><b>{last}</b></span>;
  }
  return <span className="km-truncate">{displayName(c)}</span>;
}

function Row({ c, i, az, animate, withKind }) {
  return (
    <button
      type="button"
      className={`kc-row km-press ${animate && i < 12 ? 'km-row-in' : ''}`}
      style={animate ? { animationDelay: `${Math.min(i, 12) * 22}ms` } : undefined}
      onClick={() => { clientStore.seed(c); nav.openClient(c.id); }}
    >
      <Avatar name={displayName(c)} seed={c.id} src={c.avatarUrl} size={38} channel={c.deviceMode || undefined} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="kc-row-name">
          <Name c={c} az={az} />
          {c.isWhale ? <Icon name="crown" size={13} color="var(--amber)" stroke={2.2} /> : null}
          {c.blocked ? <Icon name="lock" size={12} color="var(--faint)" /> : null}
        </span>
        <span className="kc-row-sub km-truncate" style={{ display: 'block' }}>{subLine(c, { withKind }) || ' '}</span>
        {c.rating > 0 ? <span className="kc-row-stars"><Stars value={c.rating} size={10} gap={1} /></span> : null}
      </span>
      <Icon name="chevronRight" size={14} className="kc-chev" color="var(--faint)" />
    </button>
  );
}

function SkeletonList() {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px' }}>
          <Skeleton w={38} h={38} r={19} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton w={`${46 + ((i * 17) % 32)}%`} h={13} />
            <Skeleton w={`${28 + ((i * 11) % 22)}%`} h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const [kind, setKind] = useState(() => readLS(KIND_KEY, 'client', ['client', 'partner', 'vendor']));
  const [sort, setSort] = useState(() => readLS(SORT_KEY, 'az', ['az', 'newest']));
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const cacheKey = `${kind}:${sort}`;
  const [data, setData] = useState(() => cache.get(cacheKey) || null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [waiting, setWaiting] = useState(0);
  const [scrub, setScrub] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const animateRef = useRef(true);
  useClientStoreVersion();

  const searching = searchOpen || q.trim().length > 0;

  const load = useCallback(async ({ silent = false } = {}) => {
    const key = `${kind}:${sort}`;
    if (!silent && !cache.get(key)) setData(null);
    try {
      const r = await listClients({ kind, sort, limit: 2000, withCounts: 1 });
      const next = { rows: r.clients || [], counts: r.counts || {} };
      clientStore.seedMany(next.rows);
      cache.set(key, next);
      setData((cur) => (key === `${kind}:${sort}` ? next : cur));
      setError(null);
    } catch (e) {
      if (!cache.get(key)) setError(e.message || 'Couldn’t load clients');
    }
  }, [kind, sort]);

  useEffect(() => {
    setData(cache.get(cacheKey) || null);
    animateRef.current = !cache.get(cacheKey);
    setOpenId(null);
    load();
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // server-side search across every kind (250ms debounce)
  useEffect(() => {
    const s = q.trim();
    if (!s) { setResults(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      listClients({ search: s, sort: 'az', limit: 200 })
        .then((r) => { if (alive) { clientStore.seedMany(r.clients || []); setResults(r.clients || []); } })
        .catch(() => { if (alive) setResults([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    let alive = true;
    api.get('/badges').then((b) => { if (alive) setWaiting(b?.waitlistWaiting || 0); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // silent reconcile on live edits (debounced)
  const timer = useRef(null);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { load({ silent: true }); for (const k of cache.keys()) if (k !== `${kind}:${sort}`) cache.delete(k); }, 400);
  }, [load, kind, sort]);
  useSocket('client_updated', soon);
  useResync(() => load({ silent: true }));
  useEffect(() => () => clearTimeout(timer.current), []);

  const rows = useMemo(() => {
    const base = searching && results ? results : data ? data.rows : null;
    if (!base) return null;
    return clientStore.apply(base).filter((c) => !c.archivedAt && (searching || c.contactKind === kind || (!c.contactKind && kind === 'client')));
  }, [data, results, searching, kind, clientStore.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    if (!rows) return null;
    if (sort === 'newest' && !searching) {
      const sorted = [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const out = [];
      for (const c of sorted) {
        const label = c.createdAt ? dayLabel(c.createdAt) : 'Earlier';
        const last = out[out.length - 1];
        if (last && last.key === label) last.rows.push(c); else out.push({ key: label, rows: [c] });
      }
      return out;
    }
    const sorted = [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'en', { sensitivity: 'base' }));
    const map = new Map();
    for (const c of sorted) {
      const L = letterOf(c);
      if (!map.has(L)) map.set(L, []);
      map.get(L).push(c);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0]))).map(([key, list]) => ({ key, rows: list }));
  }, [rows, sort, searching]);

  const present = useMemo(() => new Set((sections || []).map((s) => s.key)), [sections]);

  const doDelete = async (c) => {
    const ok = await confirm({ title: `Delete ${displayName(c)}?`, message: 'They’ll disappear from your book. Messages and deals stay in their threads.', confirmLabel: 'Delete client', destructive: true });
    if (!ok) { setOpenId(null); return; }
    const undo = clientStore.markRemoved(c.id);
    setOpenId(null);
    try {
      await deleteClient(c.id);
      toast(`${displayName(c)} deleted`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await restoreClient(c.id); undo(); load({ silent: true }); } catch { toast.error('Couldn’t restore'); }
          },
        },
      });
      load({ silent: true });
    } catch (e) {
      undo();
      toast.error(e.message || 'Couldn’t delete');
    }
  };

  const setKindP = (k) => { setKind(k); writeLS(KIND_KEY, k); scrollRef.current?.scrollTo({ top: 0 }); };
  const toggleSort = () => { const s = sort === 'az' ? 'newest' : 'az'; setSort(s); writeLS(SORT_KEY, s); scrollRef.current?.scrollTo({ top: 0 }); };

  const jumpTo = (L) => {
    const el = scrollRef.current?.querySelector(`[data-sec="${L}"]`);
    if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop;
  };
  const scrubAt = (e, rect) => {
    const y = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top));
    const L = LETTERS[Math.floor((y / rect.height) * LETTERS.length)];
    if (!L) return;
    let target = L;
    if (!present.has(L)) {
      const idx = LETTERS.indexOf(L);
      target = LETTERS.slice(idx).find((x) => present.has(x)) || [...LETTERS.slice(0, idx)].reverse().find((x) => present.has(x));
    }
    if (target) { jumpTo(target); setScrub({ L: target, y }); }
  };

  const counts = data?.counts || {};
  const count = rows ? rows.length : null;
  const kindLabel = KIND_TABS.find((k) => k.id === kind)?.label.toLowerCase();
  const animate = animateRef.current && !searching;

  return (
    <div className="kc-page">
      <div className="kc-hero-head">
        <div className="kc-hero-row">
          <GlassButton icon="menu" label="Menu" onClick={() => nav.openMenu()} />
          <div style={{ display: 'flex', gap: 8 }}>
            <GlassButton icon="checklist" label="Waitlists" badge={waiting || undefined} onClick={() => nav.openWaitlists()} />
            <GlassButton icon="upload" label="Import clients" onClick={() => nav.openImport()} />
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1, marginTop: 4 }}>
          <div className="kc-eyebrow-brand">KEYMATCH</div>
          <div className="kc-title-xl">{searching ? 'Search' : KIND_TABS.find((k) => k.id === kind)?.label}</div>
          <div className="kc-stats">
            <span><b>{count == null ? '–' : count}</b> {searching ? (q.trim() ? 'matches' : 'in your book') : kindLabel}</span>
            {!searching && kind === 'client' && counts.whales ? <span>· <b className="kc-blue">{counts.whales}</b> whales</span> : null}
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'grid', gridTemplateRows: searching ? '0fr' : '1fr', transition: 'grid-template-rows .28s var(--km-ease)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '2px 14px 10px', opacity: searching ? 0 : 1, transition: 'opacity .2s' }}>
            <PillTabs items={KIND_TABS} value={kind} onChange={setKindP} />
          </div>
        </div>
      </div>

      <div className="kc-searchrow">
        <div className="kc-searchpill km-lg km-lg--line" onClick={() => { setSearchOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}>
          <Icon name="search" size={16} className="kc-glow-ico" stroke={2} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => { if (!q.trim()) setTimeout(() => setSearchOpen(false), 150); }}
            placeholder={`Search ${searching ? 'everyone' : kindLabel}`}
            enterKeyHint="search"
            aria-label="Search clients"
          />
          {searching ? (
            <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setQ(''); setSearchOpen(false); inputRef.current?.blur(); }} style={{ display: 'flex', color: 'var(--faint)' }}>
              <Icon name="x" size={16} stroke={2} />
            </button>
          ) : null}
        </div>
        {!searching ? (
          <button type="button" className="kc-sortbtn km-lg km-lg--line km-press" onClick={toggleSort} aria-label={sort === 'az' ? 'Sorted A to Z — switch to newest' : 'Sorted newest — switch to A to Z'}>
            {sort === 'az' ? <span>A–Z</span> : <Icon name="clock" size={17} stroke={2} />}
          </button>
        ) : null}
      </div>

      <div className="kc-list">
        <div className="kc-list-scroll km-scroll" ref={scrollRef} onScroll={() => openId && setOpenId(null)}>
          <div className="kc-col">
            {error && !rows ? (
              <EmptyState icon="alert" title="Couldn’t load clients" sub={error} action={<Button variant="ghost" size="sm" onClick={() => load()}>Try again</Button>} />
            ) : !sections ? (
              <SkeletonList />
            ) : sections.length === 0 ? (
              searching && q.trim() ? (
                <EmptyState icon="search" title="No matches" sub={`Nobody in your book matches “${q.trim()}”.`} action={<Button size="sm" icon="userPlus" onClick={() => nav.newClient({ name: q.trim() })}>Add “{q.trim()}”</Button>} />
              ) : (
                <EmptyState icon="users" title={`No ${kindLabel} yet`} sub="Tap + to add your first one — or import your book." action={<Button variant="ghost" size="sm" icon="upload" onClick={() => nav.openImport()}>Import</Button>} />
              )
            ) : sections.map((s) => {
              let idx = 0;
              return (
                <section key={s.key} className="kc-section" data-sec={s.key}>
                  <div className="kc-sec-head">{s.key}</div>
                  {s.rows.map((c) => {
                    const i = idx++;
                    return (
                      <SwipeRow
                        key={c.id}
                        id={c.id}
                        openId={openId}
                        setOpenId={setOpenId}
                        actions={[{ label: 'Delete', color: 'var(--red)', bg: 'transparent', onClick: () => doDelete(c) }]}
                        fullSwipe={() => doDelete(c)}
                      >
                        <Row c={c} i={i} az={sort === 'az' && !searching} animate={animate} withKind={searching} />
                      </SwipeRow>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>

        {sort === 'az' && !searching && sections && sections.length > 4 ? (
          <div
            className="kc-scrubber"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); scrubAt(e, e.currentTarget.getBoundingClientRect()); }}
            onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') { if (scrub) scrubAt(e, e.currentTarget.getBoundingClientRect()); } }}
            onPointerUp={() => setScrub(null)}
            onPointerCancel={() => setScrub(null)}
            aria-label="Jump to letter"
          >
            {LETTERS.map((L) => <button key={L} type="button" tabIndex={-1} className={present.has(L) ? '' : 'kc-off'} onClick={() => jumpTo(L)}>{L}</button>)}
            {scrub ? <div className="kc-scrub-bubble" style={{ top: scrub.y - 21 }}>{scrub.L}</div> : null}
          </div>
        ) : null}
      </div>

      <button type="button" className="km-fab" aria-label={`New ${kind}`} onClick={() => nav.newClient({ contactKind: kind })}>
        <Icon name="plus" size={24} stroke={2.4} />
      </button>
    </div>
  );
}

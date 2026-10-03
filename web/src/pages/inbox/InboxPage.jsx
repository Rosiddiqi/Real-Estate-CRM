// Inbox tab (RevMatch inbox-v2 locked layout): Header → Tabs → Search +
// Compose → Content. Clients · Automations · Partners; AI "Needs you first"
// card; iOS pinned grid; Needs Response / Active Today / Quiet buckets of
// swipeable rows; live over the socket; instant from cache. ≥1024px: split
// view (380px list + thread pane).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nav, useNav } from '../../lib/nav';
import PillTabs from '../../components/ui/PillTabs';
import Icon from '../../components/ui/Icon';
import { Button, EmptyState, SkeletonRows } from '../../components/ui/kit';
import ErrorBoundary from '../../components/shell/ErrorBoundary';
import { searchInbox, getInboxAiCard } from '../../api/conversations';
import { ComposeGlyph, BellOff, PinGlyph, UnreadDotGlyph } from '../../components/thread/glyphs';
import useInbox, { inbox } from '../../components/inbox/useInbox';
import InboxHeader, { FILTERS } from '../../components/inbox/InboxHeader';
import SwipeRow, { closeOpenSwipeRow } from '../../components/inbox/SwipeRow';
import ConversationRow from '../../components/inbox/ConversationRow';
import SectionHeader from '../../components/inbox/SectionHeader';
import AIPinnedCard from '../../components/inbox/AIPinnedCard';
import PinnedGrid from '../../components/inbox/PinnedGrid';
import SearchResults from '../../components/inbox/SearchResults';
import ThreadPaneHeader from '../../components/inbox/ThreadPaneHeader';
import { RowActionsSheet, DeleteAlert, ConversationListSheet } from '../../components/inbox/InboxSheets';
import { bucketize, convName, isUnread, isWhaleConv, matchesFilter, tabOf } from '../../components/inbox/inboxUtils';
import '../../styles/inbox.css';

const ThreadView = lazy(() => import('../../components/thread/ThreadView'));
const AutomationsTab = lazy(() => import('../../components/campaigns/AutomationsTab'));

const TAB_KEY = 'km_inbox_tab';
const SEL_KEY = 'km_inbox_sel';
const CARD_HIDE_KEY = 'km_inbox_card_hidden';
const TABS = ['clients', 'automations', 'partners'];

// Session-scoped (survives tab switches, resets on reload — a forgotten filter
// should never hide texts after a relaunch).
let sessionFilter = '';
let cardCache = null;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener ? m.addEventListener('change', fn) : m.addListener(fn);
    return () => { m.removeEventListener ? m.removeEventListener('change', fn) : m.removeListener(fn); };
  }, [query]);
  return on;
}

// "Needs you first" — refetched (debounced) whenever the set of unread threads changes.
function useAiCard(key, enabled) {
  const [card, setCard] = useState(cardCache);
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return undefined;
    if (!key) { setCard(null); cardCache = null; return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      getInboxAiCard()
        .then((r) => { if (!alive) return; cardCache = (r && r.card) || null; setCard(cardCache); })
        .catch(() => {});
    }, first.current ? 0 : 1200);
    first.current = false;
    return () => { alive = false; clearTimeout(t); };
  }, [key, enabled]);
  return card;
}

function useSearch(query) {
  const [state, setState] = useState({ results: null, loading: false });
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q) { seq.current += 1; setState({ results: null, loading: false }); return undefined; }
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      searchInbox(q)
        .then((r) => { if (my === seq.current) setState({ results: r, loading: false }); })
        .catch(() => { if (my === seq.current) setState({ results: { conversations: [], messages: [], contacts: [] }, loading: false }); });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);
  return state;
}

export default function InboxPage() {
  const state = useInbox();
  const { overlays } = useNav();
  const desktop = useMedia('(min-width: 1024px)');
  const [tab, setTabState] = useState(() => { const t = lsGet(TAB_KEY, 'clients'); return TABS.includes(t) ? t : 'clients'; });
  const [filter, setFilterState] = useState(sessionFilter);
  const [query, setQuery] = useState('');
  const [selId, setSelIdState] = useState(() => lsGet(SEL_KEY, null));
  const [rowMenu, setRowMenu] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [listKind, setListKind] = useState(null);
  const [cardHidden, setCardHidden] = useState(() => lsGet(CARD_HIDE_KEY, ''));
  const searchRef = useRef(null);
  const scrollRef = useRef(null);

  const setTab = (t) => { setTabState(t); lsSet(TAB_KEY, t); closeOpenSwipeRow(); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const setFilter = (f) => { sessionFilter = f; setFilterState(f); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const setSelId = (id) => { setSelIdState(id); lsSet(SEL_KEY, id); };

  const search = useSearch(query);
  // The store expires typing entries itself; any key present is live.
  const typing = state.typing || {};

  // ── lists ────────────────────────────────────────────────────────────────
  const byTab = useMemo(() => {
    const out = { clients: [], automations: [], partners: [] };
    for (const c of state.conversations) out[tabOf(c)].push(c);
    return out;
  }, [state.conversations]);

  const unreadByTab = useMemo(() => ({
    clients: byTab.clients.filter(isUnread).length,
    automations: byTab.automations.filter(isUnread).length,
    partners: byTab.partners.filter(isUnread).length,
  }), [byTab]);

  const tabList = byTab[tab] || [];
  const pinned = useMemo(
    () => (filter ? [] : tabList.filter((c) => c.pinned).sort((a, b) => convName(a).localeCompare(convName(b)))),
    [tabList, filter],
  );
  const rest = useMemo(() => tabList.filter((c) => (filter ? matchesFilter(c, filter) : !c.pinned)), [tabList, filter]);
  const buckets = useMemo(() => bucketize(rest), [rest]);
  const ordered = useMemo(() => [...pinned, ...buckets.needs, ...buckets.active, ...buckets.quiet], [pinned, buckets]);
  const filterCounts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) if (f.id) out[f.id] = tabList.filter((c) => matchesFilter(c, f.id)).length;
    return out;
  }, [tabList]);

  const stats = useMemo(() => ({
    unread: unreadByTab.clients + unreadByTab.partners,
    total: state.conversations.length,
    whales: byTab.clients.filter(isWhaleConv).length,
  }), [unreadByTab, state.conversations.length, byTab]);

  // ── AI card ─────────────────────────────────────────────────────────────
  const unreadKey = useMemo(
    () => byTab.clients.filter((c) => isUnread(c) && c.lastMessageFromMe === false).map((c) => `${c.id}:${c.lastMessageAt}`).sort().join('|'),
    [byTab.clients],
  );
  const searching = !!query.trim();
  const card = useAiCard(unreadKey, tab === 'clients' && !filter && !searching);
  const cardKey = card && card.items ? card.items.map((i) => i.conversationId).join(',') : '';
  const showCard = tab === 'clients' && !filter && !searching && !!card && !!cardKey && cardHidden !== cardKey;

  // ── actions ─────────────────────────────────────────────────────────────
  const openConv = useCallback((c) => {
    if (!c || !c.id) return;
    closeOpenSwipeRow();
    if (isUnread(c)) inbox.markRead(c.id);
    if (desktop) { setSelId(c.id); return; }
    nav.openThread({ conversationId: c.id, name: convName(c) });
  }, [desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCard = useCallback((c) => { if (c && c.clientId) nav.openClient(c.clientId); }, []);

  const textClient = useCallback((k) => {
    if (k.conversationId) {
      const conv = state.conversations.find((c) => c.id === k.conversationId);
      return openConv(conv || { id: k.conversationId, name: k.name });
    }
    nav.openThread({ clientId: k.id, name: k.name });
    return undefined;
  }, [state.conversations, openConv]);

  const confirmDelete = useCallback(() => {
    const c = pendingDelete;
    setPendingDelete(null);
    if (!c) return;
    if (selId === c.id) setSelId(null);
    inbox.archive(c);
  }, [pendingDelete, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAllRead = () => {
    const ids = tabList.filter(isUnread).map((c) => c.id);
    ids.forEach((id) => inbox.markRead(id));
  };

  // Desktop: ↑/↓ walk the list, Esc clears search.
  useEffect(() => {
    if (!desktop) return undefined;
    const onKey = (e) => {
      if (overlays.length || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!ordered.length) return;
      e.preventDefault();
      const i = ordered.findIndex((c) => c.id === selId);
      const next = e.key === 'ArrowDown' ? Math.min(ordered.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      const c = ordered[next];
      if (c) {
        openConv(c);
        const el = scrollRef.current && scrollRef.current.querySelector(`[data-conv="${c.id}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, ordered, selId, overlays.length, openConv]);

  // ── rendering helpers ───────────────────────────────────────────────────
  const swipeLeft = (c) => {
    const unread = isUnread(c);
    return [
      {
        id: 'read', label: unread ? 'Read' : 'Unread', color: '#3A3A3A',
        icon: unread ? <Icon name="checkCircle" size={22} stroke={2} color="#fff" /> : <UnreadDotGlyph size={22} />,
        onClick: () => (unread ? inbox.markRead(c.id) : inbox.markUnread(c.id)),
      },
      { id: 'pin', label: c.pinned ? 'Unpin' : 'Pin', color: 'var(--hl)', ink: '#0D0D0D', icon: <PinGlyph size={20} color="#0D0D0D" />, onClick: () => inbox.setPinned(c.id, !c.pinned) },
    ];
  };
  const swipeRight = (c) => [
    {
      id: 'mute', label: c.muted ? 'Show Alerts' : 'Hide Alerts', color: '#6B6B6A',
      icon: c.muted ? <Icon name="bell" size={21} stroke={2} color="#fff" /> : <BellOff size={22} color="#fff" />,
      onClick: () => inbox.setMuted(c.id, !c.muted),
    },
    { id: 'delete', label: 'Delete', color: '#E5484D', icon: <Icon name="trash" size={21} stroke={2} color="#fff" />, onClick: () => setPendingDelete(c) },
  ];

  const renderRows = (rows) => rows.map((c, i) => (
    <div key={c.id} data-conv={c.id} className={i < 12 ? 'km-row-in' : undefined} style={i < 12 ? { animationDelay: `${i * 18}ms` } : undefined}>
      <SwipeRow left={swipeLeft(c)} right={swipeRight(c)} onLongPress={() => setRowMenu(c)} selected={desktop && selId === c.id}>
        <ConversationRow conv={c} typing={!!typing[c.id]} onOpen={openConv} onAvatar={openCard} selected={desktop && selId === c.id} />
      </SwipeRow>
    </div>
  ));

  const section = (label, rows, accent) => (rows.length ? (
    <div key={label} className="km-isec-wrap">
      <SectionHeader label={label} count={rows.length} accent={accent} />
      {renderRows(rows)}
    </div>
  ) : null);

  const bucketsNode = (
    <>
      {section('Needs Response', buckets.needs, true)}
      {section('Active Today', buckets.active)}
      {section('Quiet', buckets.quiet)}
    </>
  );
  const listEmpty = !pinned.length && !rest.length;
  const filterLabel = (FILTERS.find((f) => f.id === filter) || {}).label;

  let body;
  if (!state.loaded && !state.conversations.length) {
    body = state.error ? (
      <EmptyState icon="inbox" title="Couldn’t load your inbox" sub="Check your connection — it refreshes on its own when you’re back online." action={<Button variant="ghost" size="sm" onClick={() => inbox.refresh()}>Try Again</Button>} />
    ) : (
      <div style={{ padding: '6px 16px' }}><SkeletonRows n={8} /></div>
    );
  } else if (filter && listEmpty) {
    body = (
      <EmptyState
        icon="filter"
        title={`No ${filterLabel === 'Has Questions' ? 'open questions' : `${String(filterLabel).toLowerCase()} conversations`}`}
        sub={tab === 'clients' ? 'Nothing here matches this filter right now.' : 'Try another tab, or clear the filter.'}
        action={<Button variant="ghost" size="sm" onClick={() => setFilter('')}>Clear Filter</Button>}
      />
    );
  } else if (tab === 'automations') {
    body = (
      <>
        <ErrorBoundary fallback={null}>
          <Suspense fallback={<div style={{ padding: '6px 16px' }}><SkeletonRows n={3} /></div>}>
            <div className="km-inbox-autos"><AutomationsTab /></div>
          </Suspense>
        </ErrorBoundary>
        {rest.length || pinned.length ? (
          <>
            <PinnedGrid items={pinned} typing={typing} onOpen={openConv} onMenu={setRowMenu} selectedId={desktop ? selId : null} />
            {bucketsNode}
          </>
        ) : null}
      </>
    );
  } else if (listEmpty) {
    body = tab === 'partners' ? (
      <EmptyState icon="handshake" title="No partner conversations" sub="Co-op agents, lenders, attorneys and other partners you text show up here." />
    ) : (
      <EmptyState
        icon="inbox"
        title="No conversations yet"
        sub="Text a client from their card, or start a new message — replies land here instantly."
        action={<Button size="sm" icon="compose" onClick={() => nav.compose()}>New Message</Button>}
      />
    );
  } else {
    body = (
      <>
        {showCard ? (
          <AIPinnedCard
            card={card}
            onOpen={(it) => openConv(state.conversations.find((c) => c.id === it.conversationId) || { id: it.conversationId, name: it.name })}
            onDismiss={() => { setCardHidden(cardKey); lsSet(CARD_HIDE_KEY, cardKey); }}
          />
        ) : null}
        <PinnedGrid items={pinned} typing={typing} onOpen={openConv} onMenu={setRowMenu} selectedId={desktop ? selId : null} />
        {bucketsNode}
      </>
    );
  }

  const selConv = selId ? state.conversations.find((c) => c.id === selId) : null;

  const list = (
    <div className="km-inbox-list">
      <InboxHeader
        unread={stats.unread}
        total={stats.total}
        whales={stats.whales}
        filter={filter}
        counts={filterCounts}
        onFilter={setFilter}
        onMarkAllRead={markAllRead}
        onShowList={setListKind}
      />

      {!searching ? (
        <div className="km-inbox-tabs">
          <PillTabs
            size="sm"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'clients', label: 'Clients', count: unreadByTab.clients },
              { id: 'automations', label: 'Automations', count: unreadByTab.automations },
              { id: 'partners', label: 'Partners', count: unreadByTab.partners },
            ]}
          />
        </div>
      ) : null}

      <div className="km-inbox-search">
        <label className="km-isearch km-lg">
          <Icon name="search" size={15} stroke={2} color="var(--faint)" />
          <input
            ref={searchRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            placeholder="Search inbox"
            aria-label="Search inbox"
          />
          {query ? (
            <button type="button" className="km-isearch-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current && searchRef.current.focus(); }}>
              <Icon name="x" size={12} stroke={3} color="var(--bg)" />
            </button>
          ) : null}
        </label>
        <button type="button" className="km-icompose km-lg km-press" aria-label="New message" onClick={() => nav.compose()}>
          <ComposeGlyph size={20} color="var(--text)" />
        </button>
      </div>

      {filter && !searching ? (
        <div className="km-ifilter">
          <button type="button" className="km-ifilter-chip km-press" onClick={() => setFilter('')}>
            <Icon name="filter" size={12} stroke={2.2} />
            {filterLabel}
            <Icon name="x" size={12} stroke={2.6} />
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="km-inbox-scroll km-scroll" onScroll={closeOpenSwipeRow}>
        {searching ? (
          <SearchResults
            query={query}
            results={search.results}
            loading={search.loading}
            onOpenConversation={(c) => openConv(state.conversations.find((x) => x.id === c.id) || c)}
            onOpenClient={(id) => nav.openClient(id)}
            onTextClient={textClient}
          />
        ) : body}
        <div className="km-inbox-spacer" />
      </div>
    </div>
  );

  return (
    <div className={`km-screen km-inbox ${desktop ? 'km-inbox--split' : ''}`}>
      {list}
      {desktop ? (
        <section className="km-inbox-pane">
          {selId ? (
            <ErrorBoundary key={selId} fallback={<EmptyState icon="message" title="Couldn’t open this conversation" />}>
              <Suspense fallback={null}>
                <ThreadView
                  key={selId}
                  conversationId={selId}
                  name={selConv ? convName(selConv) : undefined}
                  variant="pane"
                  active={!overlays.length}
                  header={({ conversation, defaultService }) => (
                    <ThreadPaneHeader conversation={conversation} fallback={selConv} defaultService={defaultService} onMore={setRowMenu} />
                  )}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="km-inbox-pane-empty">
              <EmptyState icon="message" title="Select a conversation" sub="Pick a thread on the left, or start a new message." action={<Button size="sm" variant="ghost" icon="compose" onClick={() => nav.compose()}>New Message</Button>} />
            </div>
          )}
        </section>
      ) : null}

      <RowActionsSheet
        conv={rowMenu}
        onClose={() => setRowMenu(null)}
        onOpen={openConv}
        onOpenCard={openCard}
        onDelete={(c) => setPendingDelete(c)}
      />
      <DeleteAlert conv={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      <ConversationListSheet kind={listKind} onClose={() => setListKind(null)} onOpen={openConv} />
    </div>
  );
}

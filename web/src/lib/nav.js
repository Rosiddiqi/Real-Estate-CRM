// Navigation store — tabs + a stack of page-like overlays (RevMatch pattern:
// tab roots under the floating tab bar, push panels layered on top).
//
//   import { nav, useNav } from '../lib/nav';
//   nav.go('inbox');                      // switch tab
//   nav.openClient(id);                   // push the client card
//   nav.openThread({ conversationId });   // push a conversation
//   nav.close(overlayId);                 // called by an overlay after its exit animation
//
// Every surface opens other surfaces ONLY through these helpers, so features
// stay decoupled. The overlay type → component registry lives in AppShell.
//
// Deep links: the hash mirrors state — `#/clients?o=client:abc,thread:def`.
// Browser back pops the top overlay; a cold load with a hash restores it.
import { useSyncExternalStore } from 'react';

export const TABS = ['home', 'inbox', 'phone', 'clients', 'matchmaker'];
const TAB_KEY = 'km-active-tab';

let seq = 0;
const nextId = () => `ov${++seq}`;

function readStoredTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.includes(t) ? t : 'home';
  } catch { return 'home'; }
}

let state = { tab: readStoredTab(), overlays: [], menuOpen: false };
const listeners = new Set();
let pushedEntries = 0;     // history entries we pushed (so close can go back)
let ignorePops = 0;
let selfBacks = 0;         // our own history.back() calls — their hashchange is not a deep link

function emit() { for (const fn of listeners) fn(); }
function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

// ── hash <-> state ───────────────────────────────────────────────────────
const SERIALIZABLE = new Set(['client', 'thread', 'deal', 'listing', 'pipeline', 'listings', 'calendar', 'commissions',
  'book', 'campaigns', 'campaign', 'settings', 'waitlists', 'appointment', 'serena', 'import', 'notifications', 'search']);

function hashFor(s) {
  const ovs = s.overlays
    .filter((o) => SERIALIZABLE.has(o.type))
    .map((o) => {
      const key = o.props?.id || o.props?.conversationId || o.props?.clientId || o.props?.focus || o.props?.page || '';
      return key ? `${o.type}:${encodeURIComponent(key)}` : o.type;
    });
  return `#/${s.tab}${ovs.length ? `?o=${ovs.join(',')}` : ''}`;
}

function parseHash(hash) {
  const m = /^#\/([a-z]+)(?:\?o=(.*))?$/.exec(hash || '');
  if (!m) return null;
  const tab = TABS.includes(m[1]) ? m[1] : null;
  const overlays = (m[2] || '').split(',').filter(Boolean).map((part) => {
    const [type, raw] = part.split(':');
    const key = raw ? decodeURIComponent(raw) : undefined;
    const props = {};
    if (key) {
      if (type === 'thread') props.conversationId = key;
      else if (type === 'pipeline') props.focus = key;
      else if (type === 'serena') props.page = key;
      else props.id = key;
    }
    return { id: nextId(), type, props };
  }).filter((o) => SERIALIZABLE.has(o.type));
  return { tab, overlays };
}

function writeHash(push) {
  const h = hashFor(state);
  if (location.hash === h) return;
  try {
    if (push) { history.pushState({ km: true }, '', h); pushedEntries += 1; }
    else history.replaceState(history.state, '', h);
  } catch { /* sandboxed iframes */ }
}

if (typeof window !== 'undefined') {
  const initial = parseHash(location.hash);
  if (initial) {
    state = { ...state, tab: initial.tab || state.tab, overlays: initial.overlays };
  }
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops -= 1; return; }
    const parsed = parseHash(location.hash);
    if (!parsed) return;
    // Back button: drop overlays that are no longer in the hash (top first).
    if (parsed.overlays.length < state.overlays.length) {
      pushedEntries = Math.max(0, pushedEntries - 1);
      setState({ overlays: state.overlays.slice(0, parsed.overlays.length) });
    } else {
      syncFromHash(parsed);
    }
  });
  // A link/deep link that changes the hash while the app is running
  // (e.g. `#/clients?o=client:abc`) opens what it names.
  window.addEventListener('hashchange', () => {
    if (selfBacks > 0) { selfBacks -= 1; return; }
    const parsed = parseHash(location.hash);
    if (parsed) syncFromHash(parsed);
  });
}

// Forward navigation from the hash: keep the overlays that already match,
// open the rest; if the stacks diverge, the hash wins. No-op when in sync.
function overlayKey(o) {
  const p = o.props || {};
  return `${o.type}:${p.id || p.conversationId || p.clientId || p.focus || p.page || ''}`;
}
function syncFromHash(parsed) {
  const open = state.overlays.filter((o) => SERIALIZABLE.has(o.type));
  let same = 0;
  while (same < open.length && same < parsed.overlays.length && overlayKey(open[same]) === overlayKey(parsed.overlays[same])) same += 1;
  const tab = parsed.tab || state.tab;
  if (same === open.length && same === parsed.overlays.length) {
    if (tab !== state.tab) setState({ tab });
    return;
  }
  if (same === open.length) {
    setState({ tab, overlays: [...state.overlays, ...parsed.overlays.slice(same)], menuOpen: false });
  } else {
    setState({ tab, overlays: parsed.overlays, menuOpen: false });
  }
}

// ── public API ───────────────────────────────────────────────────────────
function open(type, props = {}, { replaceTop = false } = {}) {
  // De-dupe: reopening the same entity on top just focuses it.
  const top = state.overlays[state.overlays.length - 1];
  const key = props.id || props.conversationId || props.clientId;
  if (top && top.type === type && key && (top.props.id || top.props.conversationId || top.props.clientId) === key) return top.id;
  const ov = { id: nextId(), type, props };
  const overlays = replaceTop && top ? [...state.overlays.slice(0, -1), ov] : [...state.overlays, ov];
  setState({ overlays, menuOpen: false });
  writeHash(!replaceTop && SERIALIZABLE.has(type));
  return ov.id;
}

function close(overlayId) {
  const idx = overlayId ? state.overlays.findIndex((o) => o.id === overlayId) : state.overlays.length - 1;
  if (idx < 0) return;
  const removed = state.overlays[idx];
  const overlays = state.overlays.filter((_, i) => i !== idx);
  setState({ overlays });
  if (SERIALIZABLE.has(removed.type) && pushedEntries > 0) {
    pushedEntries -= 1;
    ignorePops += 1;
    selfBacks += 1;
    try { history.back(); } catch { ignorePops -= 1; selfBacks -= 1; }
  } else {
    writeHash(false);
  }
}

function closeAll() {
  setState({ overlays: [] });
  writeHash(false);
}

function go(tab) {
  if (!TABS.includes(tab)) return;
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  setState({ tab, overlays: [], menuOpen: false });
  writeHash(false);
}

function updateProps(overlayId, patch) {
  setState({ overlays: state.overlays.map((o) => (o.id === overlayId ? { ...o, props: { ...o.props, ...patch } } : o)) });
}

export const nav = {
  getState: () => state,
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  go,
  open,
  close,
  closeAll,
  updateProps,
  openMenu: () => setState({ menuOpen: true }),
  closeMenu: () => setState({ menuOpen: false }),

  // People
  openClient: (id, opts = {}) => open('client', { id, ...opts }),
  newClient: (prefill = {}) => open('newClient', { prefill }),
  openWaitlists: () => open('waitlists'),
  openImport: () => open('import'),

  // Messaging
  openThread: ({ conversationId, clientId, handle, name, draft } = {}) =>
    open('thread', { conversationId, clientId, handle, name, draft }),
  compose: ({ to, clientId, body, listingId } = {}) => open('compose', { to, clientId, body, listingId }),
  quickText: ({ clientId, body, context } = {}) => open('quickText', { clientId, body, context }),

  // Pipeline + money
  openPipeline: (focus) => open('pipeline', { focus }),
  openDeal: (id) => open('deal', { id }),
  newDeal: (prefill = {}) => open('newDeal', { prefill }),
  openCommissions: () => open('commissions'),
  openBook: () => open('book'),
  openPayPlan: () => open('payPlan'),

  // Listings
  openListings: (filter) => open('listings', { filter }),
  openListing: (id) => open('listing', { id }),
  newListing: (prefill = {}) => open('newListing', { prefill }),

  // Calendar
  openCalendar: (date) => open('calendar', { date }),
  openAppointment: (id) => open('appointment', { id }),
  newAppointment: (prefill = {}) => open('newAppointment', { prefill }),
  openWorkSchedule: () => open('workSchedule'),

  // Campaigns
  openCampaigns: () => open('campaigns'),
  openCampaign: (id) => open('campaign', { id }),
  newCampaign: (prefill = {}) => open('newCampaign', { prefill }),

  // AI + system
  openSerena: (page = 'chat', prompt) => open('serena', { page, prompt }),
  call: ({ clientId, phone, name } = {}) => open('call', { clientId, phone, name }),
  openNotifications: () => open('notifications'),
  openSearch: () => open('search'),
  openSettings: (section) => open('settings', { section }),
};

export function useNav() {
  return useSyncExternalStore(nav.subscribe, nav.getState, nav.getState);
}

export default nav;

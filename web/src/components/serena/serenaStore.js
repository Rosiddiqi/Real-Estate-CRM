// Serena's client-side brain. Lives at module level (not in the popup) so a
// turn keeps streaming after the sheet closes; when it finishes while closed,
// the bubble lights its unread dot. The popup and the bubble both subscribe.
//
//   const s = useSerena();            // { messages, typing, unread, activity, open, … }
//   serena.send(text) · serena.undo(cardId) · serena.decide(proposalId, action, payload)
//   window.dispatchEvent(new CustomEvent('serena:run', { detail: { text } }))  // from any surface
import { useSyncExternalStore } from 'react';
import { fetchThread, fetchUnread, markRead, openTurn, undoCard, decideProposal, aiStatus } from '../../api/serena';
import { ws } from '../../api/ws';
import { nav } from '../../lib/nav';

let state = {
  messages: [],
  hydrated: false,
  loading: false,
  typing: false,
  activity: null,     // live tool line ("Checking your day…")
  unread: 0,
  open: false,
  mode: null,         // 'ai' | 'offline'
  error: null,
  pulse: 0,           // bumps when a reply lands while closed (bubble animation)
};
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; emit(); };

let seq = 0;
const localId = (p) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;
let abort = null;
let recoverTimer = null;

function patchMessage(id, fn) {
  set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)) }));
}

// What's on screen beneath the popup → context for "this client", "her", …
function screenContext() {
  const { tab, overlays } = nav.getState();
  const ctx = { tab };
  for (let i = overlays.length - 1; i >= 0; i -= 1) {
    const o = overlays[i];
    if (o.type === 'serena') continue;
    if (!ctx.screen) ctx.screen = o.type;
    if (o.type === 'client' && o.props?.id && !ctx.clientId) ctx.clientId = o.props.id;
    if (o.type === 'deal' && o.props?.id && !ctx.dealId) ctx.dealId = o.props.id;
    if (o.type === 'listing' && o.props?.id && !ctx.listingId) ctx.listingId = o.props.id;
    if (o.type === 'thread') {
      if (o.props?.conversationId && !ctx.conversationId) ctx.conversationId = o.props.conversationId;
      if (o.props?.clientId && !ctx.clientId) ctx.clientId = o.props.clientId;
    }
    if (o.type === 'call' && o.props?.clientId && !ctx.clientId) ctx.clientId = o.props.clientId;
  }
  if (!ctx.screen) ctx.screen = tab;
  return ctx;
}

async function hydrate({ quiet = false } = {}) {
  if (!quiet) set({ loading: !state.hydrated });
  try {
    const data = await fetchThread();
    const serverMsgs = data.messages || [];
    set((s) => {
      // Keep a locally-streaming turn's bubbles until the server has them.
      const local = s.typing ? s.messages.filter((m) => m.local) : [];
      return { messages: [...serverMsgs, ...local], hydrated: true, loading: false, error: null };
    });
    if (data.running && !state.typing) startRecovery();
    return data;
  } catch (err) {
    set({ loading: false, hydrated: true, error: state.messages.length ? null : 'Couldn’t load your conversation.' });
    return null;
  }
}

async function refreshUnread() {
  if (state.open) return;
  try {
    const { unread } = await fetchUnread();
    set({ unread: unread || 0 });
  } catch { /* offline */ }
}

function setOpen(open) {
  if (open === state.open) return;
  set({ open });
  if (open) {
    set({ unread: 0 });
    markRead().catch(() => {});
    hydrate({ quiet: state.hydrated });
  }
}

// The stream dropped but the server keeps working (detached turns): poll the
// thread until the reply lands.
function startRecovery(sinceId) {
  clearTimeout(recoverTimer);
  set({ typing: true });
  let tries = 0;
  const tick = async () => {
    tries += 1;
    const data = await hydrate({ quiet: true });
    const msgs = data ? data.messages || [] : [];
    const running = data ? data.running : true;
    const last = msgs[msgs.length - 1];
    if (data && !running && (!sinceId || (last && last.role === 'assistant'))) {
      set((s) => ({ typing: false, activity: null, messages: s.messages.filter((m) => !m.local) }));
      if (!state.open) { set((s) => ({ unread: s.unread + 1, pulse: s.pulse + 1 })); } else markRead().catch(() => {});
      return;
    }
    if (tries < 80) recoverTimer = setTimeout(tick, 2500);
    else set({ typing: false, activity: null });
  };
  recoverTimer = setTimeout(tick, 1200);
}

async function send(rawText, extraContext) {
  const text = String(rawText || '').trim();
  if (!text) return false;
  if (state.typing) return false;
  const userId = localId('u');
  const asstId = localId('a');
  const now = new Date().toISOString();
  set((s) => ({
    typing: true,
    activity: null,
    error: null,
    messages: [
      ...s.messages,
      { id: userId, role: 'user', text, createdAt: now, status: 'done', local: true, cards: [], proposals: [], activity: [], suggestions: [], entities: [] },
      { id: asstId, role: 'assistant', text: '', createdAt: now, status: 'running', local: true, cards: [], proposals: [], activity: [], suggestions: [], entities: [] },
    ],
  }));
  let currentAsst = asstId;
  let completed = false;
  abort = new AbortController();
  try {
    await openTurn({
      text,
      context: { ...screenContext(), ...(extraContext || {}) },
      signal: abort.signal,
      onEvent: (event, data) => {
        switch (event) {
          case 'turn.start':
            set((s) => ({
              messages: s.messages.map((m) => {
                if (m.id === userId) return { ...m, id: data.userMessageId || m.id };
                if (m.id === asstId) return { ...m, id: data.messageId || m.id };
                return m;
              }),
            }));
            currentAsst = data.messageId || asstId;
            break;
          case 'assistant.thinking':
            set({ activity: 'Thinking…' });
            break;
          case 'assistant.delta':
            patchMessage(currentAsst, (m) => ({ text: (m.text || '') + (data.text || '') }));
            if (state.activity === 'Thinking…') set({ activity: null });
            break;
          case 'tool.call':
            set({ activity: data.label || 'Working on it…' });
            patchMessage(currentAsst, (m) => ({ activity: [...(m.activity || []), { id: data.id, name: data.name, kind: data.kind, label: data.label, ok: null }] }));
            break;
          case 'tool.result':
            patchMessage(currentAsst, (m) => ({ activity: (m.activity || []).map((a) => (a.id === data.id ? { ...a, ok: data.ok, summary: data.summary } : a)) }));
            break;
          case 'action.card':
            patchMessage(currentAsst, (m) => ({ cards: [...(m.cards || []).filter((c) => c.id !== data.card.id), data.card] }));
            break;
          case 'proposal':
            patchMessage(currentAsst, (m) => ({ proposals: [...(m.proposals || []).filter((p) => p.id !== data.proposal.id), data.proposal] }));
            break;
          case 'turn.complete':
          case 'turn.error': {
            completed = true;
            const msg = data && data.message;
            if (msg) {
              set((s) => ({
                mode: data.mode || s.mode,
                messages: s.messages.map((m) => {
                  if (m.id === currentAsst) return { ...msg };
                  if (m.id === userId || (m.local && m.role === 'user')) return { ...m, local: false };
                  return m;
                }),
              }));
            } else if (event === 'turn.error') {
              patchMessage(currentAsst, (m) => ({ status: 'error', local: false, text: m.text || (data && data.reason === 'busy' ? 'I’m still finishing your last request — one moment.' : 'Something went wrong on my side. Try that again in a moment.') }));
            }
            set({ typing: false, activity: null });
            if (!state.open) set((s) => ({ unread: s.unread + 1, pulse: s.pulse + 1 }));
            else markRead().catch(() => {});
            break;
          }
          default:
            break;
        }
      },
    });
    if (!completed) startRecovery(currentAsst);
  } catch (err) {
    if (err && err.name === 'AbortError') { startRecovery(currentAsst); return true; }
    if (err && err.status === 409) {
      set((s) => ({ messages: s.messages.filter((m) => m.id !== asstId && m.id !== userId), typing: false, activity: null }));
      startRecovery();
      return false;
    }
    if (err && err.status && err.status < 500) {
      patchMessage(currentAsst, () => ({ status: 'error', local: false, text: err.message || 'I couldn’t take that one.' }));
      set({ typing: false, activity: null });
      return false;
    }
    // Network drop: the server finishes detached — go pick it up.
    startRecovery(currentAsst);
  } finally {
    abort = null;
  }
  return true;
}

function updateCard(cardId, patch) {
  set((s) => ({ messages: s.messages.map((m) => (m.cards && m.cards.some((c) => c.id === cardId) ? { ...m, cards: m.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) } : m)) }));
}

async function undo(cardId) {
  updateCard(cardId, { undoing: true, undoError: null });
  try {
    const { card } = await undoCard(cardId);
    updateCard(cardId, { ...card, undoing: false, undone: true, undoable: false });
    return true;
  } catch (err) {
    updateCard(cardId, { undoing: false, undoError: err.message || 'Undo failed' });
    return false;
  }
}

function updateProposal(id, patch) {
  set((s) => ({ messages: s.messages.map((m) => (m.proposals && m.proposals.some((p) => p.id === id) ? { ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : m)) }));
}

async function decide(id, action, payload = {}) {
  const prev = findProposal(id);
  if (action === 'send') updateProposal(id, { sending: true, sendError: null });
  if (action === 'dismiss') updateProposal(id, { status: 'dismissed' });
  if (action === 'edit') updateProposal(id, { ...(payload.body != null ? { body: payload.body } : {}), ...(payload.subject != null ? { subject: payload.subject } : {}), ...(payload.clientId ? { clientId: payload.clientId, clientName: payload.clientName } : {}) });
  try {
    const out = await decideProposal(id, { action, ...payload });
    updateProposal(id, { ...out.proposal, sending: false });
    return out;
  } catch (err) {
    if (prev) updateProposal(id, { status: prev.status, sending: false, sendError: action === 'send' ? (err.message || 'Couldn’t send') : null });
    throw err;
  }
}

function findProposal(id) {
  for (const m of state.messages) for (const p of m.proposals || []) if (p.id === id) return p;
  return null;
}

// ── wiring ─────────────────────────────────────────────────────────────────
let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  // Any surface can hand Serena a task.
  window.addEventListener('serena:run', (e) => {
    const text = String(e?.detail?.text || '').trim();
    if (!text) return;
    const isOpen = nav.getState().overlays.some((o) => o.type === 'serena');
    if (!isOpen) nav.openSerena('chat');
    else window.dispatchEvent(new CustomEvent('serena:page', { detail: { page: 'chat' } }));
    setTimeout(() => send(text), isOpen ? 0 : 260);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshUnread(); });
  ws.on('serena_event', () => {
    if (state.typing) return;
    if (state.open) hydrate({ quiet: true });
    else refreshUnread();
  });
  ws.on('resync', () => { if (state.open && !state.typing) hydrate({ quiet: true }); else refreshUnread(); });
  aiStatus().then((s) => set({ mode: s && s.available ? 'ai' : 'offline' })).catch(() => {});
}

export const serena = {
  getState: () => state,
  subscribe: (fn) => { listeners.add(fn); wire(); return () => listeners.delete(fn); },
  hydrate,
  refreshUnread,
  setOpen,
  send,
  undo,
  decide,
  updateProposal,
  stop: () => { if (abort) abort.abort(); },
};

export function useSerena() {
  return useSyncExternalStore(serena.subscribe, serena.getState, serena.getState);
}

export default serena;

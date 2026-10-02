// Inbox store — ONE list of live conversations for every tab (split
// client-side), painted instantly from a per-workspace cache, kept live by the
// socket, silently refetched on resync / foreground. Module-level, so switching
// tabs (which unmounts the page) never loses state or flashes a spinner.
//
//   const inbox = useInbox();
//   inbox.conversations, inbox.loaded, inbox.typing[convId]
//   inbox.markRead(id) · markUnread(id) · setPinned(id, on) · setMuted(id, on)
//   inbox.archive(c) · block(c) · refresh()
import { useEffect, useSyncExternalStore } from 'react';
import { ws } from '../../api/ws';
import { useAuth } from '../../hooks/useAuth';
import { listConversations, markConversationRead, patchConversation } from '../../api/conversations';
import { isThreadOpen, onActiveThreadsChange } from '../thread/activeThread';
import { toast } from '../ui/toast';
import { haptic } from '../../lib/native';
import { tsOf } from './inboxUtils';

const CACHE_KEY = 'km_inbox_v1';
const TYPING_MS = 9000;
const MAX_PINNED = 9;

let state = { wid: null, conversations: [], loaded: false, loading: false, error: null, typing: {}, fetchedAt: 0 };
const listeners = new Set();
const readGrace = new Map(); // convId -> { until, at }
let wired = false;
let saveTimer = null;
let fetchSeq = 0;
let typingTimer = null;

function emit() { for (const fn of listeners) fn(); }
function set(patch) {
  state = { ...state, ...patch };
  emit();
  if (patch.conversations) scheduleSave();
}
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getState = () => state;

function bumpBadges() {
  try { window.dispatchEvent(new Event('km:badges')); } catch { /* ignore */ }
}

// ── cache ────────────────────────────────────────────────────────────────
function readCache(wid) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && raw.wid === wid && Array.isArray(raw.conversations)) return raw.conversations;
  } catch { /* ignore */ }
  return null;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.wid) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ wid: state.wid, savedAt: Date.now(), conversations: state.conversations.slice(0, 300) }));
    } catch { /* storage full — the live list still works */ }
  }, 700);
}

// ── merge rules ──────────────────────────────────────────────────────────
const LAST_FIELDS = ['lastMessageAt', 'lastMessagePreview', 'lastMessageFromMe', 'lastMessageStatus'];

function mergeConv(prev, incoming) {
  if (!prev) return incoming;
  const out = { ...prev, ...incoming };
  // An older payload (in-flight fetch, out-of-order event) never rolls the preview back.
  if (prev.lastMessageAt && incoming.lastMessageAt && new Date(incoming.lastMessageAt) < new Date(prev.lastMessageAt)) {
    for (const k of LAST_FIELDS) out[k] = prev[k];
    out.unreadCount = prev.unreadCount;
  }
  const g = readGrace.get(out.id);
  if (g && Date.now() < g.until && (!out.lastMessageAt || new Date(out.lastMessageAt).getTime() <= g.at + 1500)) out.unreadCount = 0;
  if (isThreadOpen(out.id)) out.unreadCount = 0;
  return out;
}

function upsert(conv) {
  if (!conv || !conv.id) return;
  const list = state.conversations;
  const i = list.findIndex((c) => c.id === conv.id);
  if (conv.archived || conv.blocked || conv.deleted) {
    if (i >= 0) set({ conversations: list.filter((c) => c.id !== conv.id) });
    return;
  }
  const next = list.slice();
  if (i >= 0) next[i] = mergeConv(list[i], conv);
  else next.unshift(mergeConv(null, conv));
  set({ conversations: next });
}

function patchLocal(id, patch) {
  const list = state.conversations;
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const prev = list[i];
  const next = list.slice();
  next[i] = { ...prev, ...patch };
  set({ conversations: next });
  return prev;
}

// ── realtime wiring (once per app lifetime) ──────────────────────────────
function onConversationUpdated(p) {
  if (!p) return;
  if (p.conversation) return upsert(p.conversation);
  if (p.deleted && p.id) return upsert({ id: p.id, deleted: true });
  if (p.partial && p.id) {
    const patch = { ...p };
    delete patch.partial;
    if (patch.deliveryMode) patch.channel = patch.deliveryMode === 'sms' ? 'sms' : 'imessage';
    patchLocal(p.id, patch);
  }
}

function onMessage(p) {
  if (!p) return;
  if (p.conversation) upsert(p.conversation);
  const id = p.conversationId || (p.conversation && p.conversation.id);
  if (id && state.typing[id] && p.message && !p.message.isFromMe) clearTyping(id);
}

function clearTyping(id) {
  if (!state.typing[id]) return;
  const typing = { ...state.typing };
  delete typing[id];
  set({ typing });
}

function onTyping(p) {
  if (!p || !p.conversationId || p.from !== 'client') return;
  const typing = { ...state.typing };
  if (p.isTyping) typing[p.conversationId] = Date.now() + TYPING_MS;
  else delete typing[p.conversationId];
  set({ typing });
  clearTimeout(typingTimer);
  const next = Object.values(typing);
  if (next.length) {
    typingTimer = setTimeout(() => {
      const now = Date.now();
      const live = Object.fromEntries(Object.entries(state.typing).filter(([, until]) => until > now));
      set({ typing: live });
    }, Math.max(500, Math.min(...next) - Date.now() + 50));
  }
}

function onRead(p) {
  const id = p && p.conversationId;
  if (!id) return;
  const c = state.conversations.find((x) => x.id === id);
  if (c && c.unreadCount) patchLocal(id, { unreadCount: 0 });
}

function onClientUpdated(p) {
  if (!p || !p.id || (!p.name && !p.firstName && p.contactKind === undefined && p.isWhale === undefined)) return;
  let touched = false;
  const next = state.conversations.map((c) => {
    if (c.clientId !== p.id || c.isGroup) return c;
    touched = true;
    const client = { ...(c.client || {}) };
    for (const k of ['firstName', 'lastName', 'displayName', 'phone', 'email', 'avatarUrl', 'isWhale', 'rating', 'type', 'contactKind', 'vendorRole', 'status', 'deviceMode', 'neighborhood']) {
      if (p[k] !== undefined) client[k] = p[k];
    }
    return { ...c, client, name: p.name || c.name };
  });
  if (touched) set({ conversations: next });
}

function wire() {
  if (wired) return;
  wired = true;
  ws.on('conversation_updated', onConversationUpdated);
  ws.on('message_received', onMessage);
  ws.on('message_sent', onMessage);
  ws.on('conversation_read', onRead);
  ws.on('typing', onTyping);
  ws.on('client_updated', onClientUpdated);
  ws.on('resync', () => { if (state.wid) refresh(); });
  // A thread opening clears its row immediately (the thread posts /read).
  onActiveThreadsChange(() => {
    const open = state.conversations.filter((c) => c.unreadCount && isThreadOpen(c.id));
    if (!open.length) return;
    const ids = new Set(open.map((c) => c.id));
    for (const id of ids) readGrace.set(id, { until: Date.now() + 8000, at: Date.now() });
    set({ conversations: state.conversations.map((c) => (ids.has(c.id) ? { ...c, unreadCount: 0 } : c)) });
    bumpBadges();
  });
}

// ── fetch ────────────────────────────────────────────────────────────────
export async function refresh() {
  const seq = ++fetchSeq;
  const startedAt = Date.now();
  if (!state.conversations.length) set({ loading: true });
  try {
    const res = await listConversations({ tab: 'all', limit: 500 });
    if (seq !== fetchSeq) return;
    const fresh = (res && res.conversations) || [];
    const prevById = new Map(state.conversations.map((c) => [c.id, c]));
    const seen = new Set();
    const merged = fresh.map((c) => { seen.add(c.id); return mergeConv(prevById.get(c.id), c); });
    // Keep threads that appeared over the socket while this request was in flight.
    for (const c of state.conversations) {
      if (!seen.has(c.id) && tsOf(c) > startedAt - 5000) merged.unshift(c);
    }
    set({ conversations: merged, loaded: true, loading: false, error: null, fetchedAt: Date.now() });
  } catch (err) {
    if (seq !== fetchSeq) return;
    set({ loading: false, error: err, loaded: state.loaded || !!state.conversations.length });
  }
}

function ensure(wid) {
  wire();
  if (!wid) return;
  if (state.wid !== wid) {
    readGrace.clear();
    const cached = readCache(wid);
    state = { wid, conversations: cached || [], loaded: !!cached, loading: false, error: null, typing: {}, fetchedAt: 0 };
    emit();
  }
  if (Date.now() - state.fetchedAt > 4000) refresh();
}

// ── actions (optimistic, rollback + toast on failure) ────────────────────
export function markRead(id) {
  const c = state.conversations.find((x) => x.id === id);
  readGrace.set(id, { until: Date.now() + 8000, at: Date.now() });
  if (c && c.unreadCount) patchLocal(id, { unreadCount: 0 });
  markConversationRead(id).then(bumpBadges).catch(() => {});
}

export function markUnread(id) {
  readGrace.delete(id);
  const prev = patchLocal(id, { unreadCount: 1 });
  haptic('light');
  patchConversation(id, { unread: true }).then(bumpBadges).catch(() => {
    if (prev) patchLocal(id, { unreadCount: prev.unreadCount });
    toast.error('Couldn’t mark as unread');
  });
}

export function setPinned(id, pinned) {
  if (pinned && state.conversations.filter((c) => c.pinned).length >= MAX_PINNED) {
    toast(`You can pin up to ${MAX_PINNED} conversations`);
    return;
  }
  const prev = patchLocal(id, { pinned });
  haptic('light');
  patchConversation(id, { pinned }).catch(() => {
    if (prev) patchLocal(id, { pinned: prev.pinned });
    toast.error(pinned ? 'Couldn’t pin' : 'Couldn’t unpin');
  });
}

export function setMuted(id, muted) {
  const prev = patchLocal(id, { muted });
  haptic('light');
  patchConversation(id, { muted }).catch(() => {
    if (prev) patchLocal(id, { muted: prev.muted });
    toast.error('Couldn’t update alerts');
  });
}

function removeWithUndo(conv, patch, undoPatch, label) {
  const list = state.conversations;
  set({ conversations: list.filter((c) => c.id !== conv.id) });
  bumpBadges();
  patchConversation(conv.id, patch)
    .then(() => {
      bumpBadges();
      toast(label, {
        action: {
          label: 'Undo',
          onClick: () => {
            upsert({ ...conv, ...undoPatch });
            patchConversation(conv.id, undoPatch).then(bumpBadges).catch(() => toast.error('Couldn’t undo'));
          },
        },
      });
    })
    .catch(() => {
      upsert(conv);
      toast.error('Something went wrong — try again');
    });
}

export function archive(conv) {
  haptic('medium');
  removeWithUndo(conv, { archived: true }, { archived: false }, 'Conversation deleted');
}

export function block(conv) {
  haptic('medium');
  removeWithUndo(conv, { blocked: true }, { blocked: false }, `Blocked ${conv.name || 'this number'}`);
}

// Restore from the Archived / Blocked lists.
export async function restore(conv, patch) {
  const out = await patchConversation(conv.id, patch);
  if (out && out.conversation) upsert(out.conversation);
  bumpBadges();
  return out;
}

export function useInbox() {
  const { workspace, user } = useAuth();
  const wid = (workspace && workspace.id) || (user && user.workspaceId) || 'me';
  useEffect(() => { ensure(wid); }, [wid]);
  const s = useSyncExternalStore(subscribe, getState, getState);
  return s;
}

export const inbox = { refresh, markRead, markUnread, setPinned, setMuted, archive, block, restore, getState };
export default useInbox;

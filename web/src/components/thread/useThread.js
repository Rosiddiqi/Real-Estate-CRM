// useThread — one conversation's live state: resolve → cached paint → fetch
// (merge, never replace) → realtime → optimistic send with clientTempId
// reconciliation, retry, reactions, scheduled messages, typing, read-on-open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket, useResync } from '../../hooks/useSocket';
import { ws } from '../../api/ws';
import { toast } from '../ui/toast';
import {
  getConversation, conversationByClient, resolveConversation, markConversationRead,
} from '../../api/conversations';
import {
  listMessages, sendMessage as apiSend, retryMessage as apiRetry, deleteMessage as apiDelete,
  reactToMessage, listScheduled, updateScheduled as apiUpdateScheduled, cancelScheduled as apiCancelScheduled,
  sendScheduledNow as apiSendNow,
} from '../../api/messages';
import { attachmentKind, tempId } from './threadUtils';
import { isThreadOpen, setThreadOpen } from './activeThread';
import { bumpBadges } from '../../api/system';

const PAGE = 60;
const memCache = new Map(); // conversationId -> { messages, hasMore }
const LS_KEY = (id, tl) => `km_thr_v1:${id}:${tl ? 't' : 'm'}`;

function readCache(id, timeline) {
  if (!id) return null;
  const k = `${id}:${timeline ? 't' : 'm'}`;
  if (memCache.has(k)) return memCache.get(k);
  try {
    const raw = localStorage.getItem(LS_KEY(id, timeline));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d.messages)) return null;
    return { messages: d.messages, hasMore: !!d.hasMore };
  } catch { return null; }
}

function writeCache(id, timeline, messages, hasMore) {
  if (!id) return;
  const k = `${id}:${timeline ? 't' : 'm'}`;
  const real = messages.filter((m) => !m._optimistic && !m._failed);
  memCache.set(k, { messages: real, hasMore });
  try {
    const tail = real.slice(-PAGE);
    localStorage.setItem(LS_KEY(id, timeline), JSON.stringify({ messages: tail, hasMore: hasMore || real.length > PAGE, at: Date.now() }));
  } catch { /* quota — memory cache still works */ }
}

const byTime = (a, b) => {
  const d = new Date(a.sentAt) - new Date(b.sentAt);
  if (d) return d;
  if (a.kind === 'activity' && b.kind !== 'activity') return -1;
  return 0;
};

function upsert(list, msg) {
  const i = list.findIndex((m) => m.id === msg.id || (msg.clientTempId && m.clientTempId === msg.clientTempId && m._optimistic));
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...next[i], ...msg, _optimistic: false, _failed: false, _error: null };
    if (msg.id !== list[i].id) {
      // optimistic → real: drop any duplicate real row that already arrived
      return dedupe(next).sort(byTime);
    }
    return next;
  }
  return [...list, msg].sort(byTime);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.unshift(m);
  }
  return out;
}

// Keep un-acked optimistic bubbles (and failed ones) the server page doesn't confirm.
function mergeFresh(prev, fresh) {
  const ids = new Set(fresh.map((m) => m.id));
  const temps = new Set(fresh.map((m) => m.clientTempId).filter(Boolean));
  const keep = prev.filter((m) => (m._optimistic || m._failed) && !ids.has(m.id) && !(m.clientTempId && temps.has(m.clientTempId)));
  // Older pages already loaded stay put (fresh is the newest page).
  const oldest = fresh.length ? new Date(fresh[0].sentAt) : null;
  const older = oldest ? prev.filter((m) => !m._optimistic && !ids.has(m.id) && new Date(m.sentAt) < oldest && !String(m.id).startsWith('added:')) : [];
  return dedupe([...older, ...fresh, ...keep]).sort(byTime);
}

export function useThread({ conversationId: convProp, clientId, handle, timeline = true, active = true }) {
  const [convId, setConvId] = useState(convProp || null);
  const [conversation, setConversation] = useState(null);
  const [client, setClient] = useState(null);
  const [resolving, setResolving] = useState(!convProp && !!(clientId || handle));
  const initial = readCache(convProp, timeline);
  const [messages, setMessages] = useState(initial ? initial.messages : []);
  const [hasMore, setHasMore] = useState(initial ? initial.hasMore : false);
  const [loading, setLoading] = useState(!initial && !!(convProp || clientId || handle));
  const [error, setError] = useState(null);
  const [scheduled, setScheduled] = useState([]);
  const [typing, setTyping] = useState(false);
  const [didSend, setDidSend] = useState(0);
  const [arrived, setArrived] = useState(0); // inbound arrivals (for "new" pill)
  const typingTimer = useRef(null);
  const idRef = useRef(convId);
  idRef.current = convId;
  const msgsRef = useRef(messages);
  msgsRef.current = messages;

  // ── resolve the conversation id ───────────────────────────────────────
  useEffect(() => {
    let alive = true;
    if (convProp) { setConvId(convProp); setResolving(false); return undefined; }
    if (!clientId && !handle) { setResolving(false); setLoading(false); return undefined; }
    setResolving(true);
    const p = clientId ? conversationByClient(clientId) : resolveConversation({ handle });
    p.then((r) => {
      if (!alive) return;
      if (r.client) setClient(r.client);
      if (r.conversation) {
        setConversation(r.conversation);
        setConvId(r.conversation.id);
        const c = readCache(r.conversation.id, timeline);
        if (c) { setMessages(c.messages); setHasMore(c.hasMore); setLoading(false); }
      } else {
        setConvId(null);
        setMessages([]);
        setLoading(false);
      }
    }).catch((e) => { if (alive) { setError(e); setLoading(false); } })
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [convProp, clientId, handle, timeline]);

  // ── load conversation + latest page ───────────────────────────────────
  const fetchLatest = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    if (!silent && !readCache(id, timeline)) setLoading(true);
    try {
      const [convRes, page, sched] = await Promise.all([
        getConversation(id).catch(() => null),
        listMessages(id, { limit: PAGE, timeline }),
        listScheduled(id).catch(() => ({ scheduled: [] })),
      ]);
      if (idRef.current !== id) return;
      if (convRes && convRes.conversation) setConversation(convRes.conversation);
      setMessages((prev) => {
        const merged = mergeFresh(prev.filter((m) => !m.conversationId || m.conversationId === id || m._optimistic), page.messages || []);
        writeCache(id, timeline, merged, page.hasMore);
        return merged;
      });
      setHasMore(!!page.hasMore);
      setScheduled((sched && sched.scheduled) || []);
      setError(null);
    } catch (e) {
      if (!silent) setError(e);
    } finally {
      if (idRef.current === id) setLoading(false);
    }
  }, [timeline]);

  useEffect(() => {
    if (!convId) return undefined;
    const c = readCache(convId, timeline);
    if (c && !msgsRef.current.length) { setMessages(c.messages); setHasMore(c.hasMore); setLoading(false); }
    fetchLatest(convId);
    return undefined;
  }, [convId, timeline, fetchLatest]);

  // ── read-on-open + "this thread is on screen" ─────────────────────────
  const markRead = useCallback(() => {
    const id = idRef.current;
    if (!id || document.visibilityState !== 'visible') return;
    markConversationRead(id).then(() => bumpBadges()).catch(() => {});
    setConversation((c) => (c && c.unreadCount ? { ...c, unreadCount: 0 } : c));
  }, []);

  useEffect(() => {
    if (!convId || !active) return undefined;
    setThreadOpen(convId, true);
    markRead();
    const onVis = () => { if (document.visibilityState === 'visible') markRead(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      setThreadOpen(convId, false);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [convId, active, markRead]);

  // ── realtime ───────────────────────────────────────────────────────────
  const adopt = useCallback((message) => {
    setMessages((prev) => {
      const next = upsert(prev, message);
      writeCache(idRef.current, timeline, next, hasMore);
      return next;
    });
  }, [timeline, hasMore]);

  useSocket('message_received', (p) => {
    if (!p || !p.message || p.conversationId !== idRef.current) return;
    adopt(p.message);
    setTyping(false);
    setArrived((n) => n + 1);
    if (p.conversation) setConversation((c) => ({ ...(c || {}), ...p.conversation }));
    if (active && isThreadOpen(idRef.current)) markRead();
  });

  useSocket('message_sent', (p) => {
    if (!p || !p.message) return;
    const mine = p.clientTempId && msgsRef.current.some((m) => m.clientTempId === p.clientTempId);
    if (p.conversationId !== idRef.current && !mine) return;
    if (!idRef.current && p.conversationId) setConvId(p.conversationId);
    if (p.message.status !== 'scheduled') {
      adopt(p.message);
      setScheduled((s) => s.filter((x) => x.id !== p.message.id));
    }
    if (p.conversation) setConversation(p.conversation);
  });

  useSocket('message_updated', (p) => {
    if (!p || !p.message || p.conversationId !== idRef.current) return;
    const m = p.message;
    if (p.deleted || m.deleted) {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      setScheduled((s) => s.filter((x) => x.id !== m.id));
      return;
    }
    if (m.status === 'scheduled') {
      setScheduled((s) => {
        const i = s.findIndex((x) => x.id === m.id);
        const next = i >= 0 ? s.map((x) => (x.id === m.id ? m : x)) : [...s, m];
        return next.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
      });
      return;
    }
    if (m.status === 'cancelled') {
      setScheduled((s) => s.filter((x) => x.id !== m.id));
      return;
    }
    setScheduled((s) => s.filter((x) => x.id !== m.id));
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : upsert(prev, m)));
  });

  useSocket('reaction', (p) => {
    if (!p || p.conversationId !== idRef.current) return;
    setMessages((prev) => prev.map((m) => (m.id === p.messageId ? { ...m, reactions: p.reactions } : m)));
  });

  useSocket('typing', (p) => {
    if (!p || p.conversationId !== idRef.current || p.from !== 'client') return;
    clearTimeout(typingTimer.current);
    setTyping(!!p.isTyping);
    if (p.isTyping) typingTimer.current = setTimeout(() => setTyping(false), 9000);
  });

  useSocket('conversation_updated', (p) => {
    if (!p) return;
    const c = p.conversation || p;
    if (!c || c.id !== idRef.current) return;
    if (p.deleted) return;
    setConversation((prev) => ({ ...(prev || {}), ...c }));
  });

  useResync(() => { if (idRef.current) fetchLatest(idRef.current, { silent: true }); });
  useEffect(() => () => clearTimeout(typingTimer.current), []);

  // ── pagination ─────────────────────────────────────────────────────────
  const loadingOlder = useRef(false);
  const loadOlder = useCallback(async () => {
    const id = idRef.current;
    if (!id || !hasMore || loadingOlder.current) return false;
    const oldest = msgsRef.current.find((m) => !m.synthetic && !m._optimistic);
    if (!oldest) return false;
    loadingOlder.current = true;
    try {
      const page = await listMessages(id, { before: oldest.sentAt, limit: PAGE, timeline });
      if (idRef.current !== id) return false;
      setMessages((prev) => dedupe([...(page.messages || []), ...prev.filter((m) => !String(m.id).startsWith('added:'))]).sort(byTime).sort((a, b) => (String(a.id).startsWith('added:') ? -1 : String(b.id).startsWith('added:') ? 1 : 0)));
      setHasMore(!!page.hasMore);
      return true;
    } catch {
      return false;
    } finally {
      loadingOlder.current = false;
    }
  }, [hasMore, timeline]);

  // ── send ───────────────────────────────────────────────────────────────
  const defaultService = useMemo(() => {
    const c = conversation;
    if (c && c.channel) return c.channel === 'sms' ? 'sms' : 'imessage';
    if (client && client.deviceMode) return client.deviceMode;
    return 'imessage';
  }, [conversation, client]);

  const send = useCallback(async ({ body = '', attachments = [], service, explicitService = false, listing = null, replyTo = null, scheduledFor = null } = {}) => {
    const text = String(body || '');
    const atts = (attachments || []).map((a) => ({ url: a.url, mimeType: a.mimeType || a.mimetype || null, fileName: a.fileName || a.name || null, size: a.size || null, durationMs: a.durationMs || null, kind: attachmentKind(a) }));
    if (!text.trim() && !atts.length && !listing) return null;
    const id = idRef.current;
    const tmp = tempId();
    const svc = service || defaultService;
    const payload = {
      conversationId: id || undefined,
      clientId: id ? undefined : (clientId || undefined),
      handle: id || clientId ? undefined : (handle || undefined),
      body: text,
      attachments: atts,
      service: svc,
      explicitService,
      clientTempId: tmp,
      listingId: listing ? listing.id : undefined,
      replyToId: replyTo ? replyTo.id : undefined,
      scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
    };
    if (scheduledFor) {
      const res = await apiSend(payload);
      if (res.conversation && !id) { setConversation(res.conversation); setConvId(res.conversation.id); }
      setScheduled((s) => [...s.filter((x) => x.id !== res.message.id), res.message].sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor)));
      setDidSend((n) => n + 1);
      return res.message;
    }
    const optimistic = {
      id: tmp,
      clientTempId: tmp,
      conversationId: id,
      _optimistic: true,
      isFromMe: true,
      body: listing && !text.trim() ? '' : text,
      kind: listing ? 'listing' : (!text.trim() && atts.length ? 'attachment' : 'text'),
      service: svc,
      status: 'sending',
      sentAt: new Date().toISOString(),
      attachments: atts.map((a, i) => ({ ...a, id: `${tmp}_${i}` })),
      reactions: [],
      meta: listing ? { listing } : (replyTo ? { replyTo: { id: replyTo.id, body: (replyTo.body || '').slice(0, 140), isFromMe: replyTo.isFromMe } } : null),
      _payload: payload,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDidSend((n) => n + 1);
    try {
      const res = await apiSend(payload);
      if (res.conversation && !idRef.current) {
        setConversation(res.conversation);
        setConvId(res.conversation.id);
      } else if (res.conversation) {
        setConversation((c) => ({ ...(c || {}), ...res.conversation }));
      }
      setMessages((prev) => {
        const next = upsert(prev, res.message);
        writeCache(res.conversation ? res.conversation.id : idRef.current, timeline, next, hasMore);
        return next;
      });
      return res.message;
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tmp ? { ...m, _optimistic: false, _failed: true, status: 'failed', _error: err.message } : m)));
      if (err.status && err.status !== 500) toast.error(err.message || 'Couldn’t send');
      return null;
    }
  }, [clientId, handle, defaultService, timeline, hasMore]);

  const retry = useCallback(async (m) => {
    if (!m) return;
    if (m._payload) {
      // Never reached the server: resend as a fresh optimistic bubble.
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      const p = m._payload;
      await send({
        body: p.body,
        attachments: p.attachments,
        service: p.service,
        explicitService: p.explicitService,
        listing: m.meta && m.meta.listing ? m.meta.listing : null,
        replyTo: m.meta && m.meta.replyTo ? m.meta.replyTo : null,
      });
      return;
    }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'sending', _failed: false, error: null } : x)));
    setDidSend((n) => n + 1);
    try {
      const res = await apiRetry(m.id);
      if (res && res.message) adopt(res.message);
    } catch (err) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'failed', error: err.message } : x)));
      toast.error(err.message || 'Couldn’t retry');
    }
  }, [send, adopt]);

  const remove = useCallback(async (m) => {
    if (!m) return;
    const snapshot = msgsRef.current;
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (m._optimistic || m._failed && m._payload) return;
    try {
      await apiDelete(m.id);
      toast('Message deleted');
    } catch (err) {
      setMessages(snapshot);
      toast.error(err.message || 'Couldn’t delete');
    }
  }, []);

  const react = useCallback(async (m, type, emoji) => {
    if (!m || m._optimistic || m.synthetic) return;
    const before = m.reactions || [];
    const mineSame = before.find((r) => r.isFromMe && r.type === type && (type !== 'emoji' || r.emoji === emoji));
    const optimistic = mineSame
      ? before.filter((r) => r !== mineSame)
      : [...before.filter((r) => !r.isFromMe), { id: `tmp_${type}`, type, emoji, isFromMe: true, createdAt: new Date().toISOString() }];
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: optimistic } : x)));
    try {
      const res = await reactToMessage(m.id, type, emoji);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
    } catch (err) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)));
      toast.error('Couldn’t react');
    }
  }, []);

  // ── scheduled ─────────────────────────────────────────────────────────
  const updateScheduled = useCallback(async (id, patch) => {
    const res = await apiUpdateScheduled(id, patch);
    setScheduled((s) => s.map((x) => (x.id === id ? res.message : x)).sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor)));
    setDidSend((n) => n + 1);
    return res.message;
  }, []);
  const cancelScheduled = useCallback(async (id) => {
    const before = scheduled;
    setScheduled((s) => s.filter((x) => x.id !== id));
    setDidSend((n) => n + 1);
    try { await apiCancelScheduled(id); } catch (err) { setScheduled(before); toast.error(err.message || 'Couldn’t cancel'); }
  }, [scheduled]);
  const sendScheduledNow = useCallback(async (id) => {
    setScheduled((s) => s.filter((x) => x.id !== id));
    setDidSend((n) => n + 1);
    try { const res = await apiSendNow(id); if (res && res.message) adopt(res.message); } catch (err) { toast.error(err.message || 'Couldn’t send'); if (idRef.current) fetchLatest(idRef.current, { silent: true }); }
  }, [adopt, fetchLatest]);

  // Agent typing signal → other open devices.
  const typingSent = useRef({ at: 0, on: false });
  const emitTyping = useCallback((on) => {
    const id = idRef.current;
    if (!id) return;
    const now = Date.now();
    if (on && typingSent.current.on && now - typingSent.current.at < 2500) return;
    typingSent.current = { at: now, on };
    ws.send('typing', { conversationId: id, isTyping: on });
  }, []);

  return {
    conversationId: convId,
    conversation,
    client,
    resolving,
    messages,
    loading: loading || resolving,
    error,
    hasMore,
    loadOlder,
    scheduled,
    typing,
    didSend,
    arrived,
    defaultService,
    send,
    retry,
    remove,
    react,
    updateScheduled,
    cancelScheduled,
    sendScheduledNow,
    emitTyping,
    refresh: () => fetchLatest(idRef.current, { silent: true }),
    setConversation,
  };
}

export default useThread;

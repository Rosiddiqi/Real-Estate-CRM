// MessageList — bubble renderer + THE ONE SCROLL OWNER (ported from RevMatch
// MessageThread). Two things decide scrolling:
//   stick    — does the user want to follow the bottom? Only a finger/wheel
//              can clear it; content growth and our own writes can only set it.
//   anchor() — scrollTop = scrollHeight. The composer clearance is LAYOUT
//              (.km-th-inner padding), so no measuring/nudging is ever needed.
// Anchoring happens in layout effects (before paint) whenever content changes,
// on every send, on media load, on composer/keyboard resize — always gated on
// `stick`, so a user reading history is never yanked down.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../../api/client';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { formatTime } from '../../lib/format';
import { haptic } from '../../lib/native';
import { TapbackGlyph } from './glyphs';
import { Linkified, LinkPreviewCard, ListingCard, FileCard, CallCard, Reactions, TypingBubble } from './parts';
import VoiceNote from './VoiceNote';
import ContextMenu from './ContextMenu';
import {
  separatorFor, groupedWith, isBubble, sepLabel, statusLabel, splitBodyLink, emojiCount,
  serviceOf, channelLabel, attachmentKind, scheduledCaption, TAPBACKS, isTouchDevice, msgTime,
} from './threadUtils';

const STICK_PX = 60;

// Tapback bar "+" row (iOS 18 emoji tapbacks) — the reaction is the
// client's own emoji text, never used as a UI icon.
const EMOJI_REACTIONS = ['😍', '🔥', '🙏', '🎉', '👏', '🏡', '🥂', '💯'];

function vibrate(ms = 10) {
  haptic('medium');
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}

export default function MessageList({
  items = [],
  timelineItems,
  topNode,
  scheduled = [],
  typing = false,
  loading = false,
  hasMore = false,
  onLoadOlder,
  didSend = 0,
  arrived = 0,
  conversationKey,
  isGroup = false,
  participants,
  headerSpace = 0,
  emptyNode,
  onRetry,
  onReact,
  onReply,
  onDelete,
  onCopy,
  onSchedule,
  onAskSerena,
  onScheduledAction,
  onOpenMedia,
  onStickChange,
}) {
  const scrollRef = useRef(null);
  const innerRef = useRef(null);
  const stick = useRef(true);
  const [stuck, setStuck] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const touch = useMemo(() => isTouchDevice(), []);

  // ── rows (messages + client-card timeline items), oldest → newest ──────
  const rows = useMemo(() => {
    const extra = Array.isArray(timelineItems)
      ? timelineItems.filter((t) => t && t.id && t.at).map((t) => ({ id: `tl:${t.id}`, kind: 'timeline', sentAt: t.at, node: t.node, isFromMe: null }))
      : [];
    const list = extra.length ? [...items, ...extra].sort((a, b) => new Date(msgTime(a)) - new Date(msgTime(b))) : items.slice();
    // "Added to …" is always first (RevMatch rule), even before backfilled history.
    const addedIdx = list.findIndex((m) => String(m.id).startsWith('added:'));
    if (addedIdx > 0) list.unshift(list.splice(addedIdx, 1)[0]);
    return list;
  }, [items, timelineItems]);

  const lastOutboundId = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const m = rows[i];
      if (isBubble(m) && m.isFromMe && !m.synthetic) return m.id;
    }
    return null;
  }, [rows]);

  // New inbound bubbles animate in — never the backlog present at open.
  const seen = useRef(new Set());
  const arrive = useRef(new Set());
  const settled = useRef(false);
  for (const m of rows) {
    if (seen.current.has(m.id)) continue;
    seen.current.add(m.id);
    if (settled.current && m.isFromMe === false && isBubble(m)) arrive.current.add(m.id);
  }
  useEffect(() => {
    if (settled.current || loading) return undefined;
    const t = setTimeout(() => { settled.current = true; }, 450);
    return () => clearTimeout(t);
  }, [loading]);
  useEffect(() => { seen.current = new Set(rows.map((m) => m.id)); settled.current = false; arrive.current = new Set(); }, [conversationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── scroll engine ─────────────────────────────────────────────────────
  const anchor = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const setStick = useCallback((v) => {
    if (stick.current === v) return;
    stick.current = v;
    setStuck(v);
    if (v) setNewCount(0);
    onStickChange && onStickChange(v);
  }, [onStickChange]);

  const prepend = useRef(null);
  const requestOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || !onLoadOlder || prepend.current) return;
    prepend.current = { h: el.scrollHeight, top: el.scrollTop, pending: true };
    Promise.resolve(onLoadOlder()).then((ok) => {
      if (!ok && prepend.current && prepend.current.pending) prepend.current = null;
    }).catch(() => { prepend.current = null; });
  }, [hasMore, onLoadOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let touching = false;
    let userScroll = false;
    let momentum = null;
    const endSoon = () => { clearTimeout(momentum); momentum = setTimeout(() => { if (!touching) userScroll = false; }, 180); };
    const onTouchStart = () => { touching = true; };
    const onTouchMove = () => { touching = true; userScroll = true; };
    const onTouchEnd = () => { touching = false; endSoon(); };
    const onWheel = () => { userScroll = true; endSoon(); };
    const onKey = () => { userScroll = true; endSoon(); };
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      if (userScroll) { setStick(atBottom); if (!touching) endSoon(); } else if (atBottom) setStick(true);
      if (el.scrollTop < 140) requestOlder();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(momentum);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [setStick, requestOlder]);

  // Conversation switch → pinned, plus a 1.2s belt while media decodes.
  useLayoutEffect(() => {
    stick.current = true;
    setStuck(true);
    setNewCount(0);
    const t0 = performance.now();
    let raf = 0;
    const belt = (now) => {
      if (stick.current) anchor();
      if (now - t0 < 1200) raf = requestAnimationFrame(belt);
    };
    raf = requestAnimationFrame(belt);
    return () => cancelAnimationFrame(raf);
  }, [conversationKey, anchor]);

  // Content changed: restore position after a prepend, else follow the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = prepend.current;
    if (el && p && p.pending) {
      const added = el.scrollHeight - p.h;
      if (added > 0) {
        el.scrollTop = p.top + added;
        prepend.current = null;
        return;
      }
    }
    if (stick.current) anchor();
  }, [rows, scheduled, typing, anchor]);

  // A send ALWAYS returns to the bottom (iMessage + Ro's rule).
  useLayoutEffect(() => {
    if (!didSend) return;
    stick.current = true;
    setStuck(true);
    setNewCount(0);
    anchor();
  }, [didSend, anchor]);

  // Inbound while the user is reading history → "new message" pill.
  const lastArrived = useRef(arrived);
  useEffect(() => {
    if (arrived > lastArrived.current && !stick.current) setNewCount((n) => n + (arrived - lastArrived.current));
    lastArrived.current = arrived;
  }, [arrived]);

  // Layout changes without new messages (images decoding, composer growing,
  // keyboard, rotation) — border-box observers so padding changes count.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return undefined;
    const reanchor = () => { if (stick.current) anchor(); };
    const observe = (o, n) => { try { o.observe(n, { box: 'border-box' }); } catch { o.observe(n); } };
    const ro = new ResizeObserver(reanchor);
    observe(ro, el);
    observe(ro, inner);
    el.addEventListener('load', reanchor, true);
    el.addEventListener('loadedmetadata', reanchor, true);
    let raf = 0;
    let wasOpen = document.body.classList.contains('km-kb-open');
    const tail = () => {
      cancelAnimationFrame(raf);
      const until = performance.now() + 900;
      const tick = (now) => { reanchor(); if (now < until) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    };
    const mo = new MutationObserver(() => {
      const open = document.body.classList.contains('km-kb-open');
      if (open !== wasOpen) { wasOpen = open; tail(); }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const onFocusIn = (e) => { if (e.target && e.target.closest && e.target.closest('.km-composer')) tail(); };
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', reanchor);
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener('load', reanchor, true);
      el.removeEventListener('loadedmetadata', reanchor, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('resize', reanchor);
    };
  }, [anchor]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // ── swipe left to reveal times ────────────────────────────────────────
  const swipe = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return undefined;
    const set = (v) => {
      inner.style.setProperty('--km-swipe', `${v}px`);
      inner.style.setProperty('--km-swipe-o', String(v > 20 ? Math.min((v - 20) / 40, 1) : 0));
    };
    const onStart = (e) => {
      const t = e.touches[0];
      if (!t || t.clientX < 30) return; // leave the edge to swipe-back
      swipe.current = { x: t.clientX, y: t.clientY, on: false, dead: false };
    };
    const onMove = (e) => {
      const s = swipe.current;
      if (!s || s.dead) return;
      const t = e.touches[0];
      const dx = s.x - t.clientX;
      const dy = Math.abs(t.clientY - s.y);
      if (!s.on) {
        if (dy > 10 && dy > Math.abs(dx)) { s.dead = true; return; }
        if (dx > 10 && dx > dy) { s.on = true; inner.classList.add('km-th-inner--swiping'); }
        else return;
      }
      if (e.cancelable) e.preventDefault();
      set(Math.max(0, Math.min(dx * 0.6, 80)));
    };
    const onEnd = () => {
      const s = swipe.current;
      swipe.current = null;
      if (s && s.on) { inner.classList.remove('km-th-inner--swiping'); set(0); }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // ── long-press menu ───────────────────────────────────────────────────
  const [ctx, setCtx] = useState(null); // { kind:'msg'|'sched', item, anchor }
  const [emojiRow, setEmojiRow] = useState(false); // tapback bar "+" → emoji reactions
  useEffect(() => { setEmojiRow(false); }, [ctx]);
  const [dismissing, setDismissing] = useState(false);
  const heldNode = useRef(null);
  const layerRef = useRef(null);
  const press = useRef(null);
  const openedAt = useRef(0);
  const freeze = useRef(null);
  const [selectId, setSelectId] = useState(null);

  const clearPress = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.visual);
    clearTimeout(p.timer);
    if (p.node && p.node.classList.contains('km-bwrap--held')) {
      p.node.classList.add('km-bwrap--settle');
      p.node.classList.remove('km-bwrap--held');
      const n = p.node;
      setTimeout(() => n.classList.remove('km-bwrap--settle'), 260);
    }
    press.current = null;
  };

  const freezeUntilLift = () => {
    if (freeze.current) return;
    const block = (ev) => { if (ev.cancelable) ev.preventDefault(); };
    const clear = () => {
      document.removeEventListener('touchmove', block, true);
      document.removeEventListener('touchend', clear, true);
      document.removeEventListener('touchcancel', clear, true);
      freeze.current = null;
    };
    document.addEventListener('touchmove', block, { passive: false, capture: true });
    document.addEventListener('touchend', clear, true);
    document.addEventListener('touchcancel', clear, true);
    freeze.current = clear;
  };
  useEffect(() => () => { if (freeze.current) freeze.current(); clearPress(); }, []);

  const openMenu = useCallback((kind, item, node, side) => {
    if (!node || !node.isConnected) return;
    const r = node.getBoundingClientRect();
    heldNode.current = node;
    setDismissing(false);
    setCtx({
      kind,
      item,
      anchor: {
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        html: node.outerHTML.replace(/km-bwrap--(held|settle)/g, ''),
        side,
      },
    });
    openedAt.current = Date.now();
    vibrate(10);
  }, []);

  const dismissMenu = useCallback(() => {
    setDismissing(true);
    if (layerRef.current) layerRef.current.style.transform = 'translate3d(0, 0, 0)';
    setTimeout(() => { setCtx(null); setDismissing(false); heldNode.current = null; }, 230);
  }, []);

  // Ghost-tap guard: the lift that follows the long-press must not act.
  const guard = (fn) => (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (Date.now() - openedAt.current < 350) return;
    fn();
  };

  const pressHandlers = (kind, item, side) => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      const node = e.currentTarget;
      clearPress();
      press.current = {
        node, x: e.clientX, y: e.clientY, fired: false,
        visual: setTimeout(() => { try { node.classList.add('km-bwrap--held'); } catch { /* ignore */ } }, 120),
        timer: setTimeout(() => {
          if (!press.current) return;
          press.current.fired = true;
          const n = press.current.node;
          clearTimeout(press.current.visual);
          n.classList.remove('km-bwrap--held');
          openMenu(kind, item, n, side);
          freezeUntilLift();
        }, 420),
      };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p) return;
      if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) clearPress();
    },
    onPointerUp: () => { if (press.current && !press.current.fired) clearPress(); else press.current = null; },
    onPointerCancel: () => clearPress(),
    onContextMenu: (e) => {
      e.preventDefault();
      if (Date.now() - openedAt.current < 600) return;
      openMenu(kind, item, e.currentTarget, side);
    },
    onClickCapture: (e) => {
      if (Date.now() - openedAt.current < 500) { e.stopPropagation(); e.preventDefault(); }
    },
  });

  // ── media list for the viewer (DOM order) ─────────────────────────────
  const mediaItems = useMemo(() => {
    const out = [];
    for (const m of rows) {
      for (const a of m.attachments || []) {
        const k = attachmentKind(a);
        if (k === 'image' || k === 'video') out.push({ ...a, kind: k, messageId: m.id });
      }
    }
    return out;
  }, [rows]);
  const openMedia = (att) => {
    const idx = mediaItems.findIndex((x) => x.url === att.url);
    onOpenMedia && onOpenMedia(mediaItems, Math.max(0, idx));
  };

  // ── row renderers ─────────────────────────────────────────────────────
  const participantName = (handle) => {
    if (!isGroup || !handle) return null;
    const d = String(handle).replace(/\D/g, '').slice(-10);
    const p = (participants || []).find((x) => x && String(x.handle || '').replace(/\D/g, '').slice(-10) === d);
    return (p && p.name) || handle;
  };

  function renderAttachments(m, side, channel) {
    const atts = (m.attachments || []).filter((a) => a && a.url);
    if (!atts.length) return null;
    const media = atts.filter((a) => ['image', 'video'].includes(attachmentKind(a)));
    const others = atts.filter((a) => !['image', 'video'].includes(attachmentKind(a)));
    return (
      <>
        {media.length > 1 && media.every((a) => attachmentKind(a) === 'image') ? (
          <div className="km-media-grid">
            {media.slice(0, 4).map((a, i) => (
              <span key={a.id || a.url} className="km-media" onClick={(e) => { e.stopPropagation(); openMedia(a); }}>
                <img src={mediaUrl(a.url)} alt="" loading="lazy" decoding="async" />
                {i === 3 && media.length > 4 ? <span style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600 }}>+{media.length - 4}</span> : null}
              </span>
            ))}
          </div>
        ) : media.map((a) => (attachmentKind(a) === 'video' ? (
          <span key={a.id || a.url} className="km-media km-media-video" onClick={(e) => { e.stopPropagation(); openMedia(a); }}>
            <video src={`${mediaUrl(a.url)}#t=0.1`} preload="metadata" playsInline muted />
            <span className="km-play"><Icon name="play" size={20} color="#fff" style={{ fill: '#fff', marginLeft: 3 }} /></span>
          </span>
        ) : (
          <span key={a.id || a.url} className="km-media km-media--single" onClick={(e) => { e.stopPropagation(); openMedia(a); }}>
            <img src={mediaUrl(a.url)} alt={a.fileName || 'Photo'} loading="lazy" decoding="async" />
          </span>
        )))}
        {others.map((a) => (attachmentKind(a) === 'audio'
          ? <VoiceNote key={a.id || a.url} att={a} side={side} channel={channel} />
          : <FileCard key={a.id || a.url} att={a} />))}
      </>
    );
  }

  function renderBubble(m) {
    const sent = !!m.isFromMe;
    const side = sent ? 'sent' : 'recv';
    const svc = serviceOf(m);
    const channel = svc === 'sms' ? 'sms' : 'imsg';
    const variant = sent ? `km-bubble--${svc}` : 'km-bubble--recv';
    const failed = m._failed || m.status === 'failed';
    const listing = m.kind === 'listing' && m.meta && m.meta.listing ? m.meta.listing : null;
    const raw = m.body || '';
    const split = splitBodyLink(raw);
    const listingUrl = listing && listing.url;
    let text = listing ? (listingUrl ? raw.replace(listingUrl, '').trim() : raw) : split.text;
    if (listing && !text) text = '';
    const linkUrl = !listing && split.url ? split.url : null;
    const hasAtts = (m.attachments || []).some((a) => a && a.url);
    const emo = !hasAtts && !listing && !m.meta?.replyTo ? emojiCount(text) : 0;
    const quote = m.meta && m.meta.replyTo;
    const selectable = !touch || selectId === m.id;
    const textNode = text && text.trim() ? (
      <div
        data-msg-id={m.id}
        className={`km-bubble ${emo ? `km-bubble--emoji km-bubble--emoji${emo}` : variant} ${failed ? 'km-bubble--failed' : ''} ${(hasAtts || listing) ? 'km-bubble-caption' : ''} ${selectable ? 'km-selectable' : ''}`}
      >
        {quote ? (
          <span className="km-quote"><b>{quote.isFromMe ? 'You' : 'Them'}</b>{String(quote.body || '').slice(0, 120)}</span>
        ) : null}
        <Linkified text={text} />
      </div>
    ) : null;

    return (
      <div
        className="km-bwrap"
        {...pressHandlers('msg', m, side)}
      >
        {listing ? <ListingCard listing={listing} /> : null}
        {renderAttachments(m, side, channel)}
        {failed && sent ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="km-fail-dot" aria-label="Not delivered">!</span>
            {textNode || (!hasAtts && !listing ? <div className={`km-bubble ${variant}`}>{raw || ' '}</div> : null)}
          </div>
        ) : textNode}
        {linkUrl ? <LinkPreviewCard url={linkUrl} /> : null}
        <Reactions reactions={m.reactions} side={side} />
      </div>
    );
  }

  const renderRow = (m, i) => {
    const prev = rows[i - 1];
    const sep = m.kind === 'timeline' && !prev ? 'day' : separatorFor(m, prev);
    const showService = sep === 'day' && isBubble(m) && (!prev || serviceOf(prev) !== serviceOf(m) || !isBubble(prev));
    const lab = sep ? sepLabel(m) : null;
    const sepNode = sep ? (
      <div className={`km-th-sep ${sep === 'time' ? 'km-th-sep--time' : ''}`}>
        <span>
          {showService && serviceOf(m) !== 'email' ? (<>{channelLabel(serviceOf(m))}<br /></>) : null}
          <b>{lab.day}</b>{` ${lab.time}`}
        </span>
      </div>
    ) : null;

    if (m.kind === 'timeline') {
      return (
        <Fragment key={m.id}>
          {sepNode}
          <div className="km-tl-row" style={{ marginTop: sep ? 0 : 12 }}>{m.node}</div>
        </Fragment>
      );
    }
    if (m.kind === 'activity') {
      return (
        <Fragment key={m.id}>
          {sepNode}
          <div className="km-row-msg km-row-msg--sent" style={{ marginTop: sep ? 0 : 12 }}>
            <div className="km-bwrap">
              <ActivityPill item={m} />
            </div>
            <span className="km-time-reveal">{formatTime(m.sentAt)}</span>
          </div>
        </Fragment>
      );
    }
    if (m.kind === 'call') {
      const out = m.meta && m.meta.call && m.meta.call.direction === 'outbound';
      return (
        <Fragment key={m.id}>
          {sepNode}
          <div className={`km-row-msg km-row-msg--${out ? 'sent' : 'recv'}`} style={{ marginTop: sep ? 0 : 12 }}>
            <div className="km-bwrap" style={{ maxWidth: '86%' }}><CallCard call={m.meta && m.meta.call} at={m.sentAt} /></div>
            <span className="km-time-reveal">{formatTime(m.sentAt)}</span>
          </div>
        </Fragment>
      );
    }
    if (m.kind === 'system') {
      return (
        <Fragment key={m.id}>
          {sepNode}
          <div className="km-system-row">{m.body}</div>
        </Fragment>
      );
    }

    const grouped = !sep && groupedWith(m, prev);
    const continuation = !sep && prev && isBubble(prev) && prev.isFromMe === m.isFromMe;
    const senderName = !m.isFromMe && isGroup && (!prev || prev.isFromMe || !isBubble(prev) || String(prev.senderHandle || '') !== String(m.senderHandle || ''))
      ? participantName(m.senderHandle) : null;
    const mt = sep ? 0 : grouped ? 2 : continuation && !senderName ? 4 : senderName ? 6 : 12;
    const isLastOut = m.id === lastOutboundId;
    const failed = m.isFromMe && (m._failed || m.status === 'failed');
    const st = isLastOut && !failed ? statusLabel(m) : null;
    return (
      <Fragment key={m.id}>
        {sepNode}
        {senderName ? <div style={{ margin: '8px 0 2px 16px', fontSize: 12, color: 'var(--dim)', fontWeight: 500 }}>{senderName}</div> : null}
        <div
          className={`km-row-msg km-row-msg--${m.isFromMe ? 'sent' : 'recv'} ${arrive.current.has(m.id) ? 'km-row-msg--arrive' : ''}`}
          style={{ marginTop: mt }}
        >
          {renderBubble(m)}
          <span className="km-time-reveal">{formatTime(m.sentAt)}</span>
        </div>
        {failed ? (
          <div className="km-status km-status--failed">
            <span>Not Delivered</span>
            {onRetry ? <button type="button" onClick={() => onRetry(m)}>Tap to retry</button> : null}
          </div>
        ) : st ? (
          <div className="km-status">{st.strong ? <b>{st.strong} </b> : null}{st.rest}</div>
        ) : null}
      </Fragment>
    );
  };

  // ── context-menu content ──────────────────────────────────────────────
  let ctxNode = null;
  if (ctx) {
    const item = ctx.item;
    if (ctx.kind === 'sched') {
      const pick = (action) => { dismissMenu(); onScheduledAction && onScheduledAction(item, action); };
      ctxNode = (
        <ContextMenu
          anchor={ctx.anchor} dismissing={dismissing} heldNodeRef={heldNode} layerRef={layerRef}
          onBackdrop={guard(dismissMenu)}
          menu={(
            <>
              <MenuItem label="Edit Message" icon="edit" onClick={guard(() => pick('edit'))} />
              <div className="km-ctx-sep" />
              <MenuItem label="Edit Time" icon="clock" onClick={guard(() => pick('retime'))} />
              <div className="km-ctx-sep" />
              <MenuItem label="Send Now" icon="send" onClick={guard(() => pick('send'))} />
              <div className="km-ctx-sep km-ctx-sep--group" />
              <MenuItem label="Delete" icon="trash" danger onClick={guard(() => pick('delete'))} />
            </>
          )}
        />
      );
    } else {
      const mine = new Set((item.reactions || []).filter((r) => r.isFromMe).map((r) => r.type));
      const mineEmoji = new Set((item.reactions || []).filter((r) => r.isFromMe && r.type === 'emoji').map((r) => r.emoji));
      const canReact = !item._optimistic && !item.synthetic && !(item._failed && item._payload);
      const hasText = !!(item.body && item.body.trim());
      const run = (fn) => guard(() => { dismissMenu(); fn(); });
      ctxNode = (
        <ContextMenu
          anchor={ctx.anchor} dismissing={dismissing} heldNodeRef={heldNode} layerRef={layerRef}
          onBackdrop={guard(dismissMenu)}
          tapbacks={canReact ? (emojiRow ? EMOJI_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`React ${e}`}
              className={`km-ctx-tap km-ctx-tap--emoji ${mineEmoji.has(e) ? 'km-ctx-tap--on' : ''}`}
              onClick={run(() => { vibrate(6); onReact && onReact(item, 'emoji', e); })}
            >
              {e}
            </button>
          )) : [
            ...TAPBACKS.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={t}
                className={`km-ctx-tap ${mine.has(t) ? 'km-ctx-tap--on' : ''}`}
                onClick={run(() => { vibrate(6); onReact && onReact(item, t); })}
              >
                <TapbackGlyph type={t} size={22} />
              </button>
            )),
            <button key="more" type="button" aria-label="More reactions" className="km-ctx-tap km-ctx-tap--more" onClick={guard(() => setEmojiRow(true))}>
              <Icon name="plus" size={18} stroke={2.4} />
            </button>,
          ]) : null}
          menu={(
            <>
              {onReply && canReact ? <><MenuItem label="Reply" icon="reply" onClick={run(() => onReply(item))} /><div className="km-ctx-sep" /></> : null}
              {hasText ? <><MenuItem label="Copy" icon="copy" onClick={run(() => onCopy && onCopy(item))} /><div className="km-ctx-sep" /></> : null}
              {touch && hasText ? <><MenuItem label="Select Text" icon="edit" onClick={run(() => setSelectId(item.id))} /><div className="km-ctx-sep" /></> : null}
              {onSchedule ? <><MenuItem label="Schedule" icon="calendar" onClick={run(() => onSchedule(item))} /><div className="km-ctx-sep" /></> : null}
              {onAskSerena && hasText ? <MenuItem label="Ask Serena" icon="sparkle" onClick={run(() => onAskSerena(item))} /> : null}
              <div className="km-ctx-sep km-ctx-sep--group" />
              <MenuItem label="Delete" icon="trash" danger onClick={run(() => onDelete && onDelete(item))} />
            </>
          )}
        />
      );
    }
  }

  const empty = !loading && !rows.length && !scheduled.length && !typing;

  return (
    <>
    <div className="km-th-scroll" ref={scrollRef} tabIndex={-1}>
      <div className="km-th-inner" ref={innerRef} style={headerSpace ? { paddingTop: `calc(var(--km-th-top) + ${headerSpace}px + 10px)` } : undefined}>
        <div className="km-th-center">
          {topNode ? <div className="km-tl-top" style={{ marginBottom: 6 }}>{topNode}</div> : null}
          {hasMore ? (
            <button type="button" className="km-th-load-older" onClick={requestOlder}>
              <Spinner size={14} /> Loading earlier messages
            </button>
          ) : null}
          {loading && !rows.length ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'var(--faint)' }}><Spinner size={22} /></div>
          ) : null}
          {empty ? emptyNode || null : null}
          {rows.map(renderRow)}
          {scheduled.map((s) => {
            const svc = serviceOf(s);
            return (
              <div key={`sched:${s.id}`} className="km-row-msg km-row-msg--sent" style={{ marginTop: 12 }}>
                <div
                  className="km-bwrap"
                  {...pressHandlers('sched', s, 'sent')}
                  onClick={() => onScheduledAction && onScheduledAction(s, 'open')}
                  role="button"
                  tabIndex={0}
                >
                  {s.kind === 'listing' && s.meta && s.meta.listing ? <div style={{ opacity: 0.75 }}><ListingCard listing={s.meta.listing} /></div> : null}
                  <div className={`km-bubble km-bubble--scheduled ${svc === 'sms' ? 'km-sched--sms' : ''} ${s.status === 'failed' ? 'km-sched--failed' : ''}`}>
                    {s.body ? <Linkified text={s.meta && s.meta.listing && s.meta.listing.url ? s.body.replace(s.meta.listing.url, '').trim() : s.body} /> : '(attachment)'}
                  </div>
                  <span className="km-sched-caption"><Icon name="clock" size={11} stroke={2.2} />{scheduledCaption(s.scheduledFor)}</span>
                </div>
              </div>
            );
          })}
          {typing ? <TypingBubble /> : null}
        </div>
      </div>
    </div>
      {/* Outside the scroller: an absolute child of a scroll container would
          scroll away with the content. */}
      {(newCount > 0 || !stuck) && rows.length ? (
        <button type="button" className={`km-jump km-lg km-press ${newCount ? '' : 'km-jump--icon'}`} onClick={jumpToLatest} aria-label="Jump to latest">
          <Icon name="arrowDown" size={16} stroke={2.4} />
          {newCount ? <span>{newCount === 1 ? 'New message' : `${newCount} new messages`}</span> : null}
        </button>
      ) : null}
      {ctxNode}
    </>
  );
}

function MenuItem({ label, icon, onClick, danger }) {
  return (
    <button type="button" className={`km-ctx-item ${danger ? 'km-ctx-item--danger' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <Icon name={icon} size={20} stroke={1.6} color={danger ? '#FF453A' : 'currentColor'} />
    </button>
  );
}

function ActivityPill({ item }) {
  const [open, setOpen] = useState(false);
  const note = item.meta && item.meta.activity && item.meta.activity.note;
  return (
    <div className="km-bubble km-bubble--activity" data-expandable={note ? 'true' : undefined} onClick={note ? () => setOpen((v) => !v) : undefined}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {item.body}
        {note ? <Icon name="chevronDown" size={13} stroke={2.6} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s ease' }} /> : null}
      </span>
      {note && open ? <div className="km-activity-note">{note}</div> : null}
    </div>
  );
}

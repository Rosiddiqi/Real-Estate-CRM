// Composer — the floating liquid-glass pill shared by every thread surface
// (inbox thread, client card Timeline, New Message, Quick Text).
//   + (photos & videos · camera · file · send a listing · send later)
//   channel toggle (iMessage blue / Text Message green)
//   auto-grow textarea (≈6 lines, then scrolls) — Enter = newline on touch,
//     ⌘/Ctrl+Enter sends on desktop
//   ↑ send (channel-colored, 350ms double-tap gate) · mic when empty (voice note)
// Drafts (text + uploaded attachments + staged listing + channel) persist per
// thread and are flushed synchronously on unmount / key change.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { mediaUrl } from '../../api/client';
import { uploadFiles } from '../../api/system';
import { haptic } from '../../lib/native';
import { loadDraft, saveDraft, clearDraft } from './drafts';
import ListingSheet from './ListingSheet';
import ScheduleSheet from './ScheduleSheet';
import { prefetchLinkPreview } from './parts';
import { firstUrl, isTouchDevice, attachmentKind, fmtDuration } from './threadUtils';
import PropertyPhoto from '../ui/PropertyPhoto';
import { moneyCompact } from '../../lib/format';

const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.82;

async function compressImage(file) {
  if (!file.type || !file.type.startsWith('image/') || /heic|heif|gif/.test(file.type)) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    URL.revokeObjectURL(url);
    if (img.width <= MAX_IMAGE_WIDTH && file.size <= 600 * 1024) return file;
    const scale = Math.min(MAX_IMAGE_WIDTH / img.width, 1);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${(file.name || 'photo').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function pickRecorderMime() {
  try {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  } catch { return null; }
}

const Composer = forwardRef(function Composer({
  draftKey,
  initialText,
  initialListing,
  defaultService = 'imessage',
  onSend,
  onTyping,
  replyTo,
  onClearReply,
  autoFocus = false,
  allowSchedule = true,
  allowListing = true,
  allowVoice = true,
  placeholder,
  name,
  onContentChange,
}, ref) {
  const seeded = useRef(null);
  if (seeded.current === null) {
    const d = loadDraft(draftKey);
    seeded.current = {
      text: initialText != null && initialText !== '' ? initialText : d.text,
      attachments: initialText ? [] : d.attachments,
      listing: initialListing || (initialText ? null : d.listing),
      service: d.service,
    };
  }
  const [text, setText] = useState(seeded.current.text);
  const [attachments, setAttachments] = useState(seeded.current.attachments);
  const [listing, setListing] = useState(seeded.current.listing);
  const [service, setService] = useState(seeded.current.service);
  const [uploading, setUploading] = useState(0);
  const [menu, setMenu] = useState(null); // 'attach' | 'channel' | null
  const [listingOpen, setListingOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rec, setRec] = useState(null); // { start, levels }
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const sendGate = useRef(false);
  const typingTimer = useRef(null);
  const touch = useRef(isTouchDevice());

  const effService = service || defaultService || 'imessage';
  const isSms = effService === 'sms';
  const hasContent = !!(text.trim() || attachments.length || listing);
  const contentCb = useRef(onContentChange);
  contentCb.current = onContentChange;
  useEffect(() => { if (contentCb.current) contentCb.current(hasContent); }, [hasContent]);

  // ── drafts ──────────────────────────────────────────────────────────────
  const latest = useRef({ text, attachments, listing, service });
  latest.current = { text, attachments, listing, service };
  useEffect(() => {
    if (!draftKey) return undefined;
    const key = draftKey;
    return () => saveDraft(key, latest.current); // synchronous flush on unmount / key change
  }, [draftKey]);
  const prevKey = useRef(draftKey);
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = draftKey;
    if (prev === draftKey) return;
    const cur = latest.current;
    const hasCur = !!(cur.text.trim() || cur.attachments.length || cur.listing);
    if (prev == null || /^(client:|handle:|new-message)/.test(prev)) {
      // A thread resolved late (or a first send created it) — whatever is in
      // the box (typed, or seeded by QuickText / New Message) belongs to it.
      if (hasCur) { if (prev) clearDraft(prev); return; }
    }
    const d = loadDraft(draftKey);
    setText(d.text); setAttachments(d.attachments); setListing(d.listing); setService(d.service);
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return undefined;
    const t = setTimeout(() => saveDraft(draftKey, latest.current), 250);
    return () => clearTimeout(t);
  }, [draftKey, text, attachments, listing, service]);

  // Warm the preview card while the agent is still typing a link.
  useEffect(() => {
    const t = setTimeout(() => { const u = firstUrl(text); if (u) prefetchLinkPreview(u); }, 500);
    return () => clearTimeout(t);
  }, [text]);

  // ── auto-grow ───────────────────────────────────────────────────────────
  const autoSize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '34px';
    const h = Math.min(152, Math.max(34, el.scrollHeight));
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > 152 ? 'auto' : 'hidden';
  }, []);
  useEffect(() => { autoSize(); }, [text, autoSize]);

  useEffect(() => {
    if (autoFocus && !touch.current) {
      const t = setTimeout(() => { try { taRef.current && taRef.current.focus(); } catch { /* ignore */ } }, 350);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus]);

  useEffect(() => { if (replyTo && taRef.current) taRef.current.focus(); }, [replyTo]);

  useImperativeHandle(ref, () => ({
    focus: () => { try { taRef.current && taRef.current.focus(); } catch { /* ignore */ } },
    setText: (t) => { setText(t || ''); requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ } } }); },
    setListing: (l) => setListing(l),
    get hasContent() { return hasContent; },
  }), [hasContent]);

  // ── typing signal ───────────────────────────────────────────────────────
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    if (!onTyping) return;
    clearTimeout(typingTimer.current);
    if (v.trim()) {
      onTyping(true);
      typingTimer.current = setTimeout(() => onTyping(false), 3000);
    } else onTyping(false);
  };
  useEffect(() => () => clearTimeout(typingTimer.current), []);

  // ── uploads ─────────────────────────────────────────────────────────────
  const upload = useCallback(async (files) => {
    const list = Array.from(files || []).slice(0, 10);
    if (!list.length) return;
    setUploading((n) => n + list.length);
    try {
      const prepared = await Promise.all(list.map(compressImage));
      const out = await uploadFiles(prepared);
      setAttachments((prev) => [...prev, ...out.map((f) => ({ url: f.url, mimeType: f.mimeType, fileName: f.fileName, size: f.size, kind: f.kind }))].slice(0, 10));
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading((n) => Math.max(0, n - list.length));
    }
  }, []);

  const openPicker = (accept, capture) => {
    setMenu(null);
    const el = fileRef.current;
    if (!el) return;
    el.accept = accept;
    if (capture) el.setAttribute('capture', capture); else el.removeAttribute('capture');
    el.click();
  };

  // ── send ────────────────────────────────────────────────────────────────
  const doSend = useCallback((extra = {}) => {
    if (sendGate.current) return;
    const body = text.replace(/\s+$/, '');
    if (!body.trim() && !attachments.length && !listing && !extra.attachments) return;
    sendGate.current = true;
    setTimeout(() => { sendGate.current = false; }, 350);
    clearTimeout(typingTimer.current);
    onTyping && onTyping(false);
    const draft = {
      body,
      attachments: extra.attachments || attachments,
      listing,
      service: effService,
      explicitService: !!service && service !== defaultService,
      replyTo: replyTo || null,
    };
    if (!extra.attachments) {
      setText(''); setAttachments([]); setListing(null);
      latest.current = { text: '', attachments: [], listing: null, service };
      clearDraft(draftKey);
    }
    onClearReply && onClearReply();
    haptic('light');
    const el = taRef.current;
    if (el && !extra.keepFocus) { el.style.height = '34px'; el.focus(); }
    return onSend && onSend(draft);
  }, [text, attachments, listing, effService, service, defaultService, replyTo, onSend, onTyping, onClearReply, draftKey]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSend(); }
  };

  const schedule = async (when) => {
    const draft = {
      body: text.replace(/\s+$/, ''), attachments, listing, service: effService,
      explicitService: !!service && service !== defaultService, replyTo: replyTo || null, scheduledFor: when,
    };
    try {
      await onSend(draft);
      setText(''); setAttachments([]); setListing(null);
      latest.current = { text: '', attachments: [], listing: null, service };
      clearDraft(draftKey);
      onClearReply && onClearReply();
      setScheduleOpen(false);
      toast.success('Message scheduled');
    } catch (err) {
      toast.error(err.message || 'Couldn’t schedule');
    }
  };

  // ── voice notes ─────────────────────────────────────────────────────────
  const recRef = useRef(null);
  const recMime = useRef(undefined);
  if (recMime.current === undefined) recMime.current = pickRecorderMime();
  const canRecord = allowVoice && recMime.current !== null && typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const startRecording = async () => {
    if (!canRecord) { toast('Voice notes need microphone access'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = recMime.current ? new MediaRecorder(stream, { mimeType: recMime.current }) : new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      let analyser = null; let ctx = null; let raf = 0;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
      } catch { /* levels are cosmetic */ }
      const levels = [];
      const start = Date.now();
      const tick = () => {
        if (analyser) {
          const buf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          levels.push(Math.min(1, peak / 64));
          if (levels.length > 48) levels.shift();
        }
        setRec({ start, levels: levels.slice() });
        raf = requestAnimationFrame(tick);
      };
      recRef.current = { mr, stream, chunks, ctx, stop: () => cancelAnimationFrame(raf), start };
      mr.start(250);
      haptic('medium');
      tick();
    } catch {
      toast.error('Microphone unavailable');
      setRec(null);
    }
  };

  const stopRecording = async (send) => {
    const r = recRef.current;
    recRef.current = null;
    setRec(null);
    if (!r) return;
    r.stop();
    const durationMs = Date.now() - r.start;
    await new Promise((resolve) => { r.mr.onstop = resolve; try { r.mr.stop(); } catch { resolve(); } });
    r.stream.getTracks().forEach((t) => t.stop());
    try { r.ctx && r.ctx.close(); } catch { /* ignore */ }
    if (!send || durationMs < 600) return;
    const type = (r.mr.mimeType || recMime.current || 'audio/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File(r.chunks, `Voice note.${ext}`, { type });
    setUploading((n) => n + 1);
    try {
      const [f] = await uploadFiles([file]);
      if (f) doSend({ attachments: [{ url: f.url, mimeType: f.mimeType || type, fileName: f.fileName, size: f.size, kind: 'audio', durationMs }], keepFocus: true });
    } catch (err) {
      toast.error(err.message || 'Couldn’t send voice note');
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  };

  // Swipe down on the pill's top edge dismisses the keyboard.
  const swipe = useRef(null);
  const onPillTouchStart = (e) => {
    const t = e.touches[0];
    const r = e.currentTarget.getBoundingClientRect();
    swipe.current = { y: t.clientY, x: t.clientX, armed: t.clientY - r.top <= 18 };
  };
  const onPillTouchMove = (e) => {
    const s = swipe.current;
    if (!s || !s.armed) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y;
    if (dy > 28 && dy > Math.abs(t.clientX - s.x) * 1.5) { s.armed = false; if (taRef.current) taRef.current.blur(); }
  };

  const ph = placeholder || (isSms ? 'Text Message' : 'iMessage');
  const sendBtn = (
    <button
      type="button"
      className={`km-cmp-send ${isSms ? 'km-cmp-send--sms' : ''}`}
      tabIndex={-1}
      aria-label={rec ? 'Send voice note' : 'Send'}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.preventDefault(); if (rec) stopRecording(true); else doSend(); }}
    >
      ↑
    </button>
  );

  return (
    <>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />

      {replyTo ? (
        <div className="km-cmp-reply km-lg km-lg--menu">
          <span className="km-cmp-reply-bar" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--bright)' }}>Replying to {replyTo.isFromMe ? 'yourself' : (name || 'them')}</span>
            <span className="km-truncate" style={{ display: 'block', fontSize: 13, color: 'var(--dim)' }}>{replyTo.body || 'Attachment'}</span>
          </span>
          <button type="button" className="km-cmp-circle" style={{ width: 24, height: 24 }} onClick={onClearReply} aria-label="Cancel reply">
            <Icon name="x" size={13} stroke={2.4} />
          </button>
        </div>
      ) : null}

      {(attachments.length || listing || uploading) ? (
        <div className="km-cmp-strip">
          {listing ? (
            <div className="km-cmp-att km-cmp-att--wide km-lg km-lg--menu">
              <PropertyPhoto src={listing.heroPhoto} seed={listing.id} height={44} radius={9} style={{ width: 56, flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{listing.address}</span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--dim)' }}>{[listing.price ? moneyCompact(listing.price) : null, listing.neighborhood].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="km-cmp-att-x" onClick={() => setListing(null)} aria-label="Remove listing"><Icon name="x" size={11} stroke={3} /></button>
            </div>
          ) : null}
          {attachments.map((a, i) => {
            const k = attachmentKind(a);
            return (
              <div key={a.url + i} className="km-cmp-att">
                {k === 'image' ? <img src={mediaUrl(a.url)} alt="" />
                  : k === 'video' ? <video src={`${mediaUrl(a.url)}#t=0.1`} muted playsInline preload="metadata" />
                    : (
                      <span style={{ width: 60, height: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'var(--dim)' }}>
                        <Icon name={k === 'audio' ? 'mic' : 'file'} size={20} />
                        <span style={{ fontSize: 8.5, maxWidth: 52 }} className="km-truncate">{a.fileName || 'File'}</span>
                      </span>
                    )}
                <button type="button" className="km-cmp-att-x" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove attachment">
                  <Icon name="x" size={11} stroke={3} />
                </button>
              </div>
            );
          })}
          {uploading ? (
            <div className="km-cmp-att" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={18} /></div>
          ) : null}
        </div>
      ) : null}

      <div style={{ position: 'relative' }}>
        {menu === 'attach' ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 35 }} onPointerDown={() => setMenu(null)} />
            <div className="km-cmp-menu km-lg km-lg--menu" role="menu">
              <button type="button" onClick={() => openPicker('image/*,video/*')}><Icon name="image" size={21} stroke={1.7} />Photos &amp; Videos</button>
              {touch.current ? <button type="button" onClick={() => openPicker('image/*', 'environment')}><Icon name="camera" size={21} stroke={1.7} />Camera</button> : null}
              <button type="button" onClick={() => openPicker('*/*')}><Icon name="file" size={21} stroke={1.7} />File</button>
              {allowListing ? <button type="button" onClick={() => { setMenu(null); setListingOpen(true); }}><Icon name="house" size={21} stroke={1.7} />Send a Listing</button> : null}
              {allowSchedule ? (
                <button type="button" disabled={!hasContent} onClick={() => { setMenu(null); setScheduleOpen(true); }}>
                  <Icon name="clock" size={21} stroke={1.7} />Send Later
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {menu === 'channel' ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 35 }} onPointerDown={() => setMenu(null)} />
            <div className="km-cmp-menu km-lg km-lg--menu" role="menu" style={{ left: 38, minWidth: 210 }}>
              {[['imessage', 'iMessage', 'var(--imsg)'], ['sms', 'Text Message', 'var(--sms)']].map(([id, label, color]) => (
                <button
                  key={id}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => { setService(id === defaultService ? null : id); setMenu(null); haptic('selection'); }}
                >
                  <Icon name="messageSquare" size={20} color={color} stroke={1.8} />
                  {label}
                  {effService === id ? <span className="km-cmp-check"><Icon name="check" size={17} stroke={2.6} /></span> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div
          className="km-composer km-lg km-lg--solid"
          onTouchStart={onPillTouchStart}
          onTouchMove={onPillTouchMove}
        >
          <button
            type="button"
            className="km-cmp-circle"
            aria-label="Add attachment"
            onClick={() => setMenu((m) => (m === 'attach' ? null : 'attach'))}
            disabled={!!rec}
          >
            {uploading ? <Spinner size={16} /> : <Icon name="plus" size={18} stroke={2.2} />}
          </button>
          <button
            type="button"
            className="km-cmp-circle"
            style={{ background: 'transparent', width: 30 }}
            aria-label={`Send as ${isSms ? 'Text Message' : 'iMessage'}`}
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setMenu((m) => (m === 'channel' ? null : 'channel'))}
            disabled={!!rec}
          >
            <Icon name="messageSquare" size={21} stroke={1.7} color={isSms ? 'var(--sms)' : 'var(--imsg)'} />
          </button>
          {rec ? (
            <div className="km-cmp-rec">
              <span className="km-rec-dot" />
              <span style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--lg-text)' }}>{fmtDuration((Date.now() - rec.start) / 1000)}</span>
              <span className="km-rec-bars">
                {(rec.levels.length ? rec.levels : [0.2]).map((l, i) => <i key={i} style={{ height: `${Math.max(3, Math.round(l * 22))}px` }} />)}
              </span>
              <button type="button" className="km-cmp-circle" style={{ width: 28, height: 28 }} onClick={() => stopRecording(false)} aria-label="Discard voice note">
                <Icon name="trash" size={14} stroke={2} />
              </button>
            </div>
          ) : (
            <textarea
              ref={taRef}
              className="km-cmp-input"
              rows={1}
              value={text}
              placeholder={ph}
              onChange={onChange}
              onKeyDown={onKeyDown}
              enterKeyHint="enter"
              autoCapitalize="sentences"
              autoComplete="off"
              aria-label={ph}
            />
          )}
          {rec || hasContent ? sendBtn : canRecord ? (
            <button
              type="button"
              className="km-cmp-send km-cmp-mic"
              aria-label="Record voice note"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onClick={startRecording}
            >
              <Icon name="mic" size={19} stroke={1.9} />
            </button>
          ) : null}
        </div>
      </div>

      {allowListing ? (
        <ListingSheet
          open={listingOpen}
          onClose={() => setListingOpen(false)}
          onPick={(l) => { setListing(l); setListingOpen(false); setTimeout(() => taRef.current && taRef.current.focus(), 260); }}
        />
      ) : null}
      {allowSchedule ? (
        <ScheduleSheet
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          preview={text.trim() || (listing ? listing.address : attachments.length ? 'Attachment' : '')}
          channel={isSms ? 'sms' : 'imsg'}
          onConfirm={schedule}
        />
      ) : null}
    </>
  );
});

export default Composer;

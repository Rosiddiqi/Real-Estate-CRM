// Matchmaker → Whisper (RM Grapevine): "Heard about one quietly coming to
// market?" — drop the note (and/or a brochure / floor plan photo); the server
// reads it, saves it as a private whisper (persisted, unlike RM's device-only
// tips) and scores every buyer search. Results: CALL FIRST, why-this-rating,
// must-haves, signals, Draft text (whisper mode: opener + deterministic
// details, never price / date / owner / address). 80% floor, 70% fallback.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import Sheet from '../ui/Sheet';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { relativeTime, moneyCompact, num } from '../../lib/format';
import { uploadFiles } from '../../api/system';
import { addWhisper, getListingBuyers } from '../../api/matchmaker';
import { deleteListing } from '../../api/listings';
import PropertyPhoto from '../ui/PropertyPhoto';
import { ListingThumb, cap, WhisperConfidence } from '../listings/listingKit';
import { BuyersList, dismissMatch, firstOf } from './MatchUI';
import { useMatchFeed } from './useMatchFeed';

function Composer({ onSubmit, busy }) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null); // { url }
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const can = (note.trim() || photo) && !busy && !uploading;
  const pick = (camera) => {
    const el = fileRef.current;
    if (!el) return;
    if (camera) el.setAttribute('capture', 'environment'); else el.removeAttribute('capture');
    el.click();
  };
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      const [up] = await uploadFiles([f]);
      if (up) setPhoto({ url: up.url });
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };
  const submit = async () => {
    if (!can) return;
    const ok = await onSubmit({ note: note.trim(), photoUrls: photo ? [photo.url] : [] });
    if (ok) { setNote(''); setPhoto(null); }
  };
  return (
    <div className="mm-composer">
      <div className="mm-composer-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="mm-mode-dot" style={{ animation: 'none' }} />
          <span className="mm-eyebrow mm-eyebrow--blue">Heard about one quietly coming to market?</span>
        </div>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder="e.g. “Modern 5BR bayfront on Sunset Islands, ~$13M, quietly after the holidays”"
          aria-label="Whisper"
        />
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        {photo || uploading ? (
          <div className="mm-attached">
            <div style={{ position: 'relative', width: 42, height: 42, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              {uploading ? <div className="km-skel" style={{ position: 'absolute', inset: 0 }} /> : <PropertyPhoto src={photo.url} seed={photo.url} style={{ position: 'absolute', inset: 0, height: '100%' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{uploading ? 'Uploading…' : 'Photo attached'}</div>
              <div className="mm-eyebrow" style={{ fontSize: 8.5, marginTop: 2 }}>Brochure · floor plan · price sheet</div>
            </div>
            {!uploading ? <button type="button" className="mm-icon-btn" style={{ width: 32, height: 32 }} onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="x" size={15} stroke={2.2} /></button> : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button type="button" className="mm-chipbtn" onClick={() => pick(true)} aria-label="Snap a photo"><Icon name="camera" size={18} stroke={1.8} /></button>
          <button type="button" className="mm-chipbtn" onClick={() => pick(false)} aria-label="Upload a photo"><Icon name="image" size={18} stroke={1.8} /></button>
          <span style={{ flex: 1 }} />
          <button type="button" className="mm-cta" disabled={!can} onClick={submit}>
            {busy ? <Spinner size={15} color="currentColor" /> : <Icon name="sparkle" size={15} stroke={2} />} Find who wants it
          </button>
        </div>
      </div>
    </div>
  );
}

const SOURCES = ['clients’ searches', 'texts', 'call notes', 'notes'];
function ScanOverlay({ photo }) {
  const [n, setN] = useState(0);
  const [si, setSi] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setN(100); setSi(SOURCES.length - 1); return undefined; }
    const a = setInterval(() => setN((x) => Math.min(96, x + 4)), 60);
    const b = setInterval(() => setSi((x) => (x + 1) % SOURCES.length), 520);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  return createPortal(
    <div className="mm-scan" role="status" aria-live="polite">
      <div style={{ position: 'relative', width: 150, height: 92, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--lineHi)' }}>
        <PropertyPhoto src={photo} seed="whisper-scan" style={{ position: 'absolute', inset: 0, height: '100%' }} />
      </div>
      <div className="mm-eyebrow mm-eyebrow--blue" style={{ marginTop: 22 }}>Matching every buyer</div>
      <div className="mm-scan-num">{n}<span style={{ fontSize: 24, color: 'var(--dim)' }}>%</span></div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>reading {SOURCES[si]}…</div>
      <div className="mm-scan-bar"><div style={{ width: `${n}%` }} /></div>
      <div className="mm-scan-src">{SOURCES.map((s, i) => <span key={s} className={i <= si ? 'on' : ''}>{s}</span>)}</div>
    </div>,
    document.body,
  );
}

function SpecChips({ l }) {
  const chips = [];
  if (l.beds) chips.push(`${l.beds} bd`);
  if (l.baths) chips.push(`${l.baths} ba`);
  if (l.sqft) chips.push(`${num(l.sqft)} sf`);
  if (l.typeLabel) chips.push(l.typeLabel);
  if (l.waterfrontLabel) chips.push(l.waterfrontLabel);
  for (const v of (l.views || []).slice(0, 2)) chips.push(`${cap(v)} view`);
  if (l.architecturalStyle) chips.push(l.architecturalStyle);
  for (const a of (l.amenities || []).slice(0, 4)) chips.push(a);
  if (l.priceGuide) chips.push(`Guide ~${moneyCompact(l.priceGuide)}`);
  if (l.eta) chips.push(`When: ${l.eta}`);
  if (l.whisperSource) chips.push(`via ${l.whisperSource.replace('_', ' ')}`);
  if (!chips.length) return null;
  return <div className="mm-spec-chips">{chips.map((c) => <span key={c} className="mm-spec">{c}</span>)}</div>;
}

function WhisperSheet({ item, open, onClose }) {
  const [buyers, setBuyers] = useState(item && item.buyers ? item.buyers : null);
  const l = item ? item.listing : null;
  useEffect(() => {
    if (!l) return;
    if (item.buyers) { setBuyers(item.buyers); return; }
    setBuyers(null);
    getListingBuyers(l.id, { fallback: 1 }).then(setBuyers).catch(() => setBuyers({ shown: [], hiddenCount: 0, threshold: 80, error: true }));
  }, [l && l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null;
  const onDismiss = (b) => {
    const before = buyers;
    dismissMatch({ clientId: b.clientId, listingId: l.id, matchId: b.matchId, score: b.score, name: b.name }, {
      onRemove: () => setBuyers((x) => ({ ...x, shown: x.shown.filter((y) => y.clientId !== b.clientId) })),
      onRestore: () => setBuyers(before),
    });
  };
  return (
    <Sheet open={open} onClose={onClose} left={false} maxHeight="90%">
      {({ close }) => {
        const beforeNav = () => { close(); return new Promise((r) => setTimeout(r, 120)); };
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ListingThumb src={l.photos && l.photos[0]} seed={l.id} w={64} h={48} radius={10} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mm-eyebrow" style={{ color: 'var(--green)' }}>Whisper · {relativeTime(l.createdAt) === 'now' ? 'just now' : relativeTime(l.createdAt)}</div>
                <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.015em', marginTop: 3 }} className="km-clamp-2">{l.title}</div>
              </div>
            </div>
            <SpecChips l={l} />
            {l.description || l.note ? <div className="mm-quote km-selectable">“{String(l.description || l.note).slice(0, 360)}”</div> : null}
            <WhisperConfidence confidence={l.confidence} style={{ marginTop: 12 }} />
            <div className="mm-section-row" style={{ marginTop: 18 }}>
              <span className="mm-eyebrow mm-eyebrow--blue">Who wants it</span>
              <span className="mm-eyebrow">· ≥{buyers ? buyers.threshold : 80}%</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="mm-eyebrow" style={{ color: 'var(--bright)' }} onClick={async () => { await beforeNav(); nav.openListing(l.id); }}>Details →</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {!buyers ? (
                <div className="mm-stack">{[0, 1].map((i) => <div key={i} className="km-skel" style={{ height: 64, borderRadius: 14 }} />)}</div>
              ) : (
                <BuyersList
                  buyers={buyers.shown || []}
                  subject={{ listingId: l.id, lane: 'whisper', kind: 'whisper' }}
                  threshold={buyers.threshold}
                  fallback={buyers.fallback}
                  closest={buyers.closest || []}
                  hiddenCount={buyers.hiddenCount}
                  hidden={buyers.hidden || []}
                  onDismiss={onDismiss}
                  beforeNav={beforeNav}
                  emptyTitle="Nobody fits this whisper yet"
                  emptySub="Add what you heard (beds, water, neighborhood) from Details to sharpen it."
                />
              )}
            </div>
          </div>
        );
      }}
    </Sheet>
  );
}

function TipRow({ w, onOpen, onDelete }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const top = w.topMatch;
  const down = (e) => { start.current = { x: e.clientX, y: e.clientY, lock: null, base: dx }; };
  const move = (e) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x; const my = e.clientY - s.y;
    if (!s.lock) { if (Math.abs(mx) < 6 && Math.abs(my) < 6) return; s.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'; }
    if (s.lock === 'x') setDx(Math.max(-96, Math.min(0, s.base + mx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.lock !== 'x') return;
    setDx((d) => (d < -56 ? -80 : 0));
  };
  return (
    <div className="mm-tip">
      <button type="button" className="mm-tip-behind" onClick={() => onDelete(w)} aria-label="Delete whisper"><Icon name="trash" size={18} stroke={1.9} /></button>
      <button
        type="button"
        className="mm-tip-row"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 0.22s var(--km-ease)' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={() => (dx < -10 ? setDx(0) : onOpen(w))}
      >
        <ListingThumb src={w.photos && w.photos[0]} seed={w.id} w={54} h={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mm-tip-title km-truncate">{w.title}</div>
          <div className="mm-tip-meta km-truncate">
            {relativeTime(w.createdAt) === 'now' ? 'Just now' : relativeTime(w.createdAt)} · {w.shownCount} match{w.shownCount === 1 ? '' : 'es'} ≥{w.threshold}{top ? ` · top ${firstOf(top.name)} ${top.score}` : ''}
          </div>
        </div>
        <Icon name="chevronRight" size={16} color="var(--faint)" />
      </button>
    </div>
  );
}

export default function WhisperPanel() {
  const { data, error, reload, patch } = useMatchFeed('whisper');
  const [busy, setBusy] = useState(false);
  const [scanPhoto, setScanPhoto] = useState(undefined);
  const [failure, setFailure] = useState(null);
  const [sheet, setSheet] = useState(null);
  const whispers = data ? data.whispers : [];

  const submit = async ({ note, photoUrls }) => {
    if (busy) return false;
    setBusy(true);
    setFailure(null);
    setScanPhoto(photoUrls[0] || null);
    try {
      const r = await addWhisper({ note, photoUrls });
      haptic('success');
      setScanPhoto(undefined);
      setSheet({ listing: r.listing, buyers: r.buyers });
      reload();
      return true;
    } catch (err) {
      setScanPhoto(undefined);
      setFailure(err.message || "Couldn't read that whisper");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w) => {
    const snapshot = data;
    patch((d) => ({ ...d, whispers: d.whispers.filter((x) => x.id !== w.id) }));
    try {
      await deleteListing(w.id);
      toast('Whisper removed');
    } catch {
      patch(() => snapshot);
      toast.error("Couldn't remove that whisper");
    }
  };

  return (
    <div className="mm-panel-in">
      <div className="mm-eyebrow mm-eyebrow--blue">Whisper</div>
      <h1 className="mm-h1">Heard a whisper?</h1>
      <p className="mm-lede">Drop a home you caught wind of. I check every client's searches, texts, call notes and notes to find who wants it — before it hits the market.</p>
      <Composer onSubmit={submit} busy={busy} />
      {failure ? <div className="mm-error"><Icon name="alert" size={15} stroke={2} />{failure}</div> : null}

      <div style={{ marginTop: 26 }}>
        <div className="mm-section-row" style={{ marginBottom: 10 }}>
          <span className="mm-eyebrow">Recent whispers</span>
          <span style={{ flex: 1 }} />
          {whispers.length ? <span className="mm-eyebrow">{whispers.length}</span> : null}
        </div>
        {error && !data ? <div className="mm-error">Couldn't load whispers.<button type="button" onClick={reload}>Retry</button></div> : null}
        {!data && !error ? <div className="mm-stack">{[0, 1].map((i) => <div key={i} className="km-skel" style={{ height: 66, borderRadius: 14 }} />)}</div> : null}
        {data && !whispers.length ? (
          <div className="mm-empty-inline">
            <Icon name="quote" size={22} color="var(--faint)" />
            <div className="mm-empty-title">No whispers yet</div>
            <div className="mm-empty-sub">Off-market intel from broker opens, developers or owners in your book lands here — saved across devices and scored against every buyer.</div>
          </div>
        ) : null}
        <div className="mm-stack">
          {whispers.map((w) => <TipRow key={w.id} w={w} onOpen={(x) => setSheet({ listing: x })} onDelete={remove} />)}
        </div>
      </div>

      {scanPhoto !== undefined ? <ScanOverlay photo={scanPhoto} /> : null}
      <WhisperSheet item={sheet} open={!!sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

// Shared listing atoms — photo carousel + lightbox, lane dots/badges, the full
// listing tile (Listings page), the compact ranked tile (Matchmaker) and small
// thumbs. Every property image goes through PropertyPhoto (branded fallback).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto, { PhotoFallback } from '../ui/PropertyPhoto';
import { ScoreDial } from '../ui/kit';
import { mediaUrl } from '../../api/client';
import { useSocket, useResync } from '../../hooks/useSocket';
import { moneyCompact, money, num } from '../../lib/format';
import '../../styles/listings.css';

// ── lanes (mirrors server services/listings/shape.js) ───────────────────
export const LANES = [
  { id: 'mine', label: 'My Listings', short: 'Mine', color: '#F2A93B' },
  { id: 'mls', label: 'MLS Feed', short: 'MLS', color: '#2E8BFF' },
  { id: 'pocket', label: 'Pocket & Coming Soon', short: 'Pocket', color: '#9A4DFF' },
  { id: 'whisper', label: 'Whispers', short: 'Whispers', color: '#30D27A' },
  { id: 'newdev', label: 'New Development', short: 'New Dev', color: '#32D4F5' },
];
export const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l]));
export const laneColor = (lane) => (LANE_BY_ID[lane] && LANE_BY_ID[lane].color) || 'var(--blue)';

export const STATUS_OPTIONS = [
  { id: 'coming_soon', label: 'Coming soon' },
  { id: 'active', label: 'Active' },
  { id: 'under_contract', label: 'Under contract' },
  { id: 'pending', label: 'Pending' },
  { id: 'sold', label: 'Sold' },
  { id: 'withdrawn', label: 'Withdrawn' },
  { id: 'expired', label: 'Expired' },
  { id: 'off_market', label: 'Off market' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s.label]));

export const TYPE_OPTIONS = [
  { value: 'single_family', label: 'Single-family' },
  { value: 'estate', label: 'Estate' },
  { value: 'condo', label: 'Condo' },
  { value: 'penthouse', label: 'Penthouse' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'villa', label: 'Villa' },
  { value: 'co_op', label: 'Co-op' },
  { value: 'land', label: 'Land' },
];
export const WATERFRONT_OPTIONS = [
  { value: 'oceanfront', label: 'Oceanfront' },
  { value: 'bayfront', label: 'Bayfront' },
  { value: 'intracoastal', label: 'Intracoastal' },
  { value: 'canal', label: 'Canal' },
  { value: 'lake', label: 'Lake' },
  { value: 'river', label: 'River' },
];
export const VIEW_OPTIONS = ['ocean', 'bay', 'intracoastal', 'city', 'golf', 'park', 'garden', 'lake', 'marina'];
export const AMENITY_OPTIONS = ['Pool', 'Dock', 'Boat lift', 'Gated', 'Private elevator', 'Guest house', 'Wine room', 'Generator', 'Smart home',
  'Home theater', 'Gym', 'Spa', 'Tennis court', 'Beach access', 'Impact windows', 'Summer kitchen', 'Rooftop terrace', 'Concierge', 'Staff quarters', 'Garage'];

// ── formatting ──────────────────────────────────────────────────────────
export function fmtListed(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
export function acresLabel(l) {
  const ac = l.lotAcres || (l.lotSqft ? l.lotSqft / 43560 : null);
  if (!ac) return null;
  return `${ac >= 10 ? Math.round(ac) : ac.toFixed(2).replace(/\.?0+$/, '')} ac`;
}
// "5 bd · 6.5 ba · 7,850 sf · 0.42 ac"
export function statsLine(l, { lot = true } = {}) {
  const parts = [];
  if (l.beds != null) parts.push(`${l.beds} bd`);
  if (l.baths != null) parts.push(`${l.baths} ba`);
  if (l.sqft) parts.push(`${num(l.sqft)} sf`);
  const ac = lot && !['condo', 'penthouse', 'co_op'].includes(l.propertyType) ? acresLabel(l) : null;
  if (ac) parts.push(ac);
  return parts.join(' · ');
}
export function priceLabel(l) {
  if (l.listPrice) return money(l.listPrice);
  if (l.lane === 'whisper' && l.priceGuide) return `Guide ~${moneyCompact(l.priceGuide)}`;
  return 'Price on request';
}
export function listedLine(l, { compact = false } = {}) {
  const parts = [];
  if (l.lane === 'whisper') {
    parts.push(l.eta ? `Heard · ${l.eta}` : 'Heard');
    return parts.join('');
  }
  // compact (a struck "was" price shares the row): DOM alone says enough
  if (compact && l.dom != null && l.status !== 'coming_soon') return `${l.dom} DOM`;
  const listed = fmtListed(l.listedAt || l.createdAt);
  if (listed) parts.push(l.status === 'coming_soon' ? `Added ${listed}` : `Listed ${listed}`);
  if (l.dom != null && l.status !== 'coming_soon') parts.push(`${l.dom} DOM`);
  return parts.join(' · ');
}
export function featureChips(l) {
  const out = [];
  if (l.waterfrontLabel) out.push(l.waterfrontLabel);
  for (const v of (l.views || []).slice(0, 2)) out.push(`${cap(v)} view`);
  if (l.architecturalStyle) out.push(l.architecturalStyle);
  return out;
}

// ── realtime refetch (debounced) ─────────────────────────────────────────
export function useListingsLive(refetch, events = ['listing_updated', 'match_new', 'client_updated', 'deal_updated']) {
  const t = useRef(null);
  const fire = useCallback(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => refetch && refetch(), 450);
  }, [refetch]);
  useEffect(() => () => clearTimeout(t.current), []);
  useSocket(events, fire);
  useResync(fire);
}

// ── lane dot + eyebrow + badges ──────────────────────────────────────────
export function LaneDot({ color, size = 7 }) {
  return <span className="kl-dot" style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${color}` }} />;
}

const BADGE_TONE = {
  POCKET: 'violet', 'COMING SOON': 'violet', 'NEW DEV': 'cyan', WHISPER: 'green', 'OFF-MARKET': 'violet',
};
export function Badge({ children, tone = 'violet', style }) {
  return <span className={`kl-badge kl-badge--${tone}`} style={style}>{children}</span>;
}
export function ListingBadges({ l, drop = true, max = 3 }) {
  const items = (l.badges || []).slice(0, max).map((b) => <Badge key={b} tone={BADGE_TONE[b] || 'violet'}>{b}</Badge>);
  if (drop && l.dropAmount) items.push(<Badge key="drop" tone="drop">↓ {moneyCompact(l.dropAmount)}</Badge>);
  return items.length ? <span className="kl-badges">{items}</span> : null;
}

export function SourceLine({ l, right }) {
  return (
    <div className="kl-source">
      <LaneDot color={l.laneColor || laneColor(l.lane)} />
      <span className="kl-source-name km-truncate">{l.sourceName || l.laneLabel}</span>
      <ListingBadges l={l} />
      {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
    </div>
  );
}

// ── photo carousel (swipe, dots, count, arrows) ──────────────────────────
export function PhotoCarousel({ photos = [], seed, label, ratio = '4 / 3', height, radius = 0, onTap, children, showCount = true, arrows = true, className = '', countPos = 'top' }) {
  const list = photos.length ? photos : [null];
  const n = list.length;
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const moved = useRef(false);
  const idx = Math.min(i, n - 1);

  const go = (e, dir) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (n <= 1) return;
    setI((c) => (c + dir + n) % n);
  };
  const onDown = (e) => {
    if (n <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth, lock: null };
    moved.current = false;
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x; const my = e.clientY - d.y;
    if (!d.lock) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      d.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    }
    if (d.lock !== 'x') return;
    moved.current = true;
    const edge = (idx === 0 && mx > 0) || (idx === n - 1 && mx < 0);
    setDx(edge ? mx * 0.35 : mx);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.lock !== 'x') { setDx(0); return; }
    const threshold = Math.min(60, d.w * 0.18);
    if (dx < -threshold && idx < n - 1) setI(idx + 1);
    else if (dx > threshold && idx > 0) setI(idx - 1);
    setDx(0);
  };
  const onClick = (e) => {
    if (moved.current) { moved.current = false; e.stopPropagation(); return; }
    if (onTap) { e.stopPropagation(); onTap(idx); }
  };

  const MAX = 7;
  const windowed = n > MAX;
  const start = windowed ? Math.min(Math.max(0, idx - Math.floor(MAX / 2)), n - MAX) : 0;
  const count = Math.min(n, MAX);

  return (
    <div
      className={`kl-carousel ${className}`}
      style={{ aspectRatio: height ? undefined : ratio, height, borderRadius: radius }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={onClick}
    >
      <div
        className="kl-carousel-track"
        style={{ transform: `translate3d(calc(${-idx * 100}% + ${dx}px), 0, 0)`, transition: drag.current ? 'none' : 'transform 0.42s var(--km-ease)' }}
      >
        {list.map((p, k) => (
          <div key={k} className="kl-carousel-slide">
            {Math.abs(k - idx) <= 1 ? (
              <PropertyPhoto src={p} seed={`${seed || label || 'listing'}-${k}`} label={k === 0 ? label : null} style={{ position: 'absolute', inset: 0, height: '100%' }} />
            ) : null}
          </div>
        ))}
      </div>
      {children}
      {showCount && n > 1 ? (
        <div className={`kl-count km-mat km-mat--thin ${countPos === 'bottom' ? 'kl-count--bottom' : ''}`}><Icon name="image" size={11} stroke={2} />{idx + 1}/{n}</div>
      ) : null}
      {arrows && n > 1 ? (
        <>
          <button type="button" className="kl-arrow kl-arrow--l km-lg km-lg--clear km-lg--dim" aria-label="Previous photo" onClick={(e) => go(e, -1)} onPointerDown={(e) => e.stopPropagation()}><Icon name="chevronLeft" size={16} stroke={2.2} /></button>
          <button type="button" className="kl-arrow kl-arrow--r km-lg km-lg--clear km-lg--dim" aria-label="Next photo" onClick={(e) => go(e, 1)} onPointerDown={(e) => e.stopPropagation()}><Icon name="chevronRight" size={16} stroke={2.2} /></button>
        </>
      ) : null}
      {n > 1 ? (
        <div className="kl-dots" aria-hidden="true">
          {Array.from({ length: count }, (_, k) => {
            const real = start + k;
            const active = real === idx;
            const edge = windowed && ((k === 0 && start > 0) || (k === count - 1 && start + count < n));
            const s = active ? 7 : edge ? 3.5 : 5;
            return <span key={real} className={active ? 'on' : ''} style={{ width: s, height: s }} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── fullscreen lightbox ──────────────────────────────────────────────────
function LightboxImage({ src, seed }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className="kl-lightbox-fallback"><PhotoFallback seed={seed} label="Photo unavailable" /></div>;
  }
  return <img src={mediaUrl(src)} alt="" onError={() => setFailed(true)} draggable={false} />;
}

export function Lightbox({ photos = [], start = 0, seed, onClose }) {
  const n = photos.length || 1;
  const [i, setI] = useState(start);
  const [leaving, setLeaving] = useState(false);
  const sx = useRef(null);
  const close = useCallback(() => { setLeaving(true); setTimeout(onClose, 200); }, [onClose]);
  const go = useCallback((d) => setI((c) => (c + d + n) % n), [n]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, go]);
  return createPortal(
    <div
      className={`kl-lightbox ${leaving ? 'kl-lightbox--out' : ''}`}
      role="dialog"
      aria-modal="true"
      onPointerDown={(e) => { sx.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const s = sx.current; sx.current = null;
        if (!s) return;
        const dx = e.clientX - s.x; const dy = e.clientY - s.y;
        if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) close();
        else if (Math.abs(dx) > 44) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="kl-lightbox-stage"><LightboxImage src={photos[i]} seed={`${seed}-${i}`} /></div>
      <div className="kl-lightbox-top">
        <span className="kl-lightbox-n">{i + 1} / {n}</span>
        <button type="button" className="km-lg km-lg--clear km-lg--dim kl-lightbox-x" onClick={close} aria-label="Close"><Icon name="x" size={18} stroke={2.2} /></button>
      </div>
      {n > 1 ? (
        <>
          <button type="button" className="kl-arrow kl-arrow--l km-lg km-lg--clear km-lg--dim kl-lightbox-arrow" onClick={() => go(-1)} aria-label="Previous"><Icon name="chevronLeft" size={20} stroke={2.2} /></button>
          <button type="button" className="kl-arrow kl-arrow--r km-lg km-lg--clear km-lg--dim kl-lightbox-arrow" onClick={() => go(1)} aria-label="Next"><Icon name="chevronRight" size={20} stroke={2.2} /></button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

// ── small thumb (rows, digests) ──────────────────────────────────────────
export function ListingThumb({ src, seed, w = 54, h = 40, radius = 9 }) {
  return (
    <div className="kl-thumb" style={{ width: w, height: h, borderRadius: radius }}>
      <PropertyPhoto src={src} seed={seed} style={{ position: 'absolute', inset: 0, height: '100%' }} />
    </div>
  );
}

// ── full tile (Listings page grid) ───────────────────────────────────────
export function ListingTile({ l, onOpen, index = 0 }) {
  const [moreAmen, setMoreAmen] = useState(false);
  const chips = featureChips(l);
  const amen = l.amenities || [];
  const shownAmen = moreAmen ? amen : amen.slice(0, 3);
  const open = () => onOpen && onOpen(l);
  return (
    <article className="kl-tile km-row-in" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }} onClick={open} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <PhotoCarousel photos={l.photos} seed={l.id} label={l.neighborhood || l.city} ratio="4 / 3" onTap={open}>
        {l.hideAddress ? <span className="kl-private km-mat km-mat--thin"><Icon name="lock" size={10} stroke={2.2} />Private</span> : null}
      </PhotoCarousel>
      <div className="kl-tile-body">
        <SourceLine l={l} />
        <div className="kl-tile-title km-truncate">{l.title}</div>
        <div className="kl-tile-sub km-truncate">{l.subtitle}</div>
        <div className="kl-tile-price">
          <span className="km-num">{priceLabel(l)}</span>
          {l.dropAmount && l.previousPrice ? <span className="kl-was">{moneyCompact(l.previousPrice)}</span> : null}
          <span className="kl-listed">{listedLine(l, { compact: !!(l.dropAmount && l.previousPrice) })}</span>
        </div>
        {statsLine(l) ? <div className="kl-stats">{statsLine(l)}</div> : null}
        {chips.length ? (
          <div className="kl-chips">
            {chips.map((c, k) => <span key={c} className="kl-feature">{k === 0 && l.waterfrontLabel ? <Icon name="waves" size={12} stroke={2} /> : null}{c}</span>)}
          </div>
        ) : null}
        {amen.length ? (
          <div className="kl-chips">
            {shownAmen.map((a) => <span key={a} className="kl-amenity">{a}</span>)}
            {amen.length > 3 ? (
              <button type="button" className="kl-amenity kl-amenity--more" onClick={(e) => { e.stopPropagation(); setMoreAmen((v) => !v); }}>
                {moreAmen ? 'Less' : `+${amen.length - 3}`}
              </button>
            ) : null}
          </div>
        ) : null}
        <MatchStrip l={l} />
      </div>
    </article>
  );
}

// "4 buyers ≥80" + top buyer
export function MatchStrip({ l }) {
  const top = l.topMatch;
  if (!top) {
    return (
      <div className="kl-match kl-match--none">
        <Icon name="rings" size={14} stroke={1.8} />
        <span>No buyer at {l.matchThreshold || 80}%+ yet</span>
      </div>
    );
  }
  return (
    <div className="kl-match">
      <Avatar name={top.name} seed={top.clientId} src={top.avatarUrl} size={26} />
      <div className="kl-match-text">
        <div className="km-truncate"><b>{l.matchCount} buyer{l.matchCount === 1 ? '' : 's'} ≥{l.matchThreshold || 80}</b>{l.hotCount ? <span className="kl-hot"> · {l.hotCount} hot</span> : null}</div>
        <div className="kl-match-who km-truncate">Top: {top.name}{top.whale ? ' · Whale' : ''}</div>
      </div>
      <ScoreDial value={top.score} size={36} stroke={3} label={`${top.score}${top.verifyHold ? '*' : ''}`} fontSize={12} />
    </div>
  );
}

// ── compact ranked tile (Matchmaker listings mode) ───────────────────────
export function RankedTile({ l, onOpen, onOpenPerson, index = 0 }) {
  const top = l.topMatch;
  const open = () => onOpen && onOpen(l);
  return (
    <article className="kl-tile kl-tile--ranked km-row-in" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }} onClick={open} role="button" tabIndex={0}>
      <PhotoCarousel photos={l.photos} seed={l.id} label={l.neighborhood || l.city} ratio="4 / 3" onTap={open} />
      <div className="kl-tile-body" style={{ padding: '13px 14px 12px' }}>
        <div className="kl-ranked-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="kl-tile-title km-truncate" style={{ marginTop: 0 }}>{l.title}</div>
            <div className="kl-ranked-sub km-truncate">{l.subtitle}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="km-num" style={{ fontSize: 15.5 }}>{l.listPrice ? moneyCompact(l.listPrice) : l.priceGuide ? `~${moneyCompact(l.priceGuide)}` : '—'}</div>
            <div className="kl-source" style={{ justifyContent: 'flex-end', marginTop: 3 }}><LaneDot color={l.laneColor} size={6} /><span className="kl-source-name">{(LANE_BY_ID[l.lane] || {}).short || l.laneLabel}</span></div>
          </div>
        </div>
        <div className="kl-eyebrow" style={{ marginTop: 6 }}>{listedLine(l)}</div>
        <div className="kl-divider" />
        {top ? (
          <button type="button" className="kl-top" onClick={(e) => { e.stopPropagation(); onOpenPerson ? onOpenPerson(top.clientId) : open(); }}>
            <Avatar name={top.name} seed={top.clientId} src={top.avatarUrl} size={28} />
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div className="kl-eyebrow" style={{ color: 'var(--bright)' }}>Top match · {l.matchCount} client{l.matchCount === 1 ? '' : 's'}</div>
              <div className="km-truncate" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>{top.name}{top.whale ? <span className="kl-whale">WHALE</span> : null}</div>
            </div>
            <ScoreDial value={top.score} size={38} stroke={3} label={`${top.score}${top.verifyHold ? '*' : ''}`} fontSize={12.5} />
          </button>
        ) : (
          <div className="kl-top kl-top--none">No strong match yet</div>
        )}
      </div>
    </article>
  );
}

export function TileSkeletons({ n = 4 }) {
  return (
    <div className="kl-grid">
      {Array.from({ length: n }).map((_, k) => (
        <div key={k} className="kl-tile kl-skel-tile">
          <div className="km-skel" style={{ aspectRatio: '4 / 3', borderRadius: 0 }} />
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div className="km-skel" style={{ width: '40%', height: 9, borderRadius: 5 }} />
            <div className="km-skel" style={{ width: '72%', height: 15, borderRadius: 6 }} />
            <div className="km-skel" style={{ width: '55%', height: 11, borderRadius: 6 }} />
            <div className="km-skel" style={{ width: '38%', height: 17, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// How solid is a whisper? (seeded / agent-entered {price, timing, specs, note}
// confidence, or the parser's per-field confidence → a specs average)
export function WhisperConfidence({ confidence, style }) {
  if (!confidence || typeof confidence !== 'object') return null;
  const c = confidence;
  const rows = [['Price', c.price], ['Timing', c.timing], ['Specs', c.specs]].filter(([, v]) => typeof v === 'number');
  const note = typeof c.note === 'string' ? c.note : null;
  if (!rows.length && !note) return null;
  const tone = (v) => (v >= 0.75 ? 'var(--green)' : v >= 0.5 ? 'var(--amber)' : 'var(--red)');
  return (
    <div className="kl-conf-card" style={style}>
      <div className="kl-eyebrow" style={{ color: 'var(--green)', marginBottom: rows.length ? 8 : 4 }}>How solid is it</div>
      {rows.map(([k, v]) => (
        <div key={k} className="mm-factor" style={{ padding: '4px 0' }}>
          <span className="mm-factor-label" style={{ width: 56 }}>{k}</span>
          <div className="mm-factor-track"><div style={{ width: `${Math.round(v * 100)}%`, background: tone(v) }} /></div>
          <span className="mm-factor-detail" style={{ width: 34 }}>{Math.round(v * 100)}%</span>
        </div>
      ))}
      {note ? <div className="kl-conf-note km-selectable">“{note}”</div> : null}
    </div>
  );
}


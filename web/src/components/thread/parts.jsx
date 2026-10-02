// Bubble building blocks: link previews, listing cards, files, calls,
// reactions, typing dots, linkified text.
import { useEffect, useState } from 'react';
import { mediaUrl } from '../../api/client';
import { getLinkPreview } from '../../api/messages';
import { nav } from '../../lib/nav';
import { money, specLine, formatTime } from '../../lib/format';
import PropertyPhoto from '../ui/PropertyPhoto';
import Icon from '../ui/Icon';
import { TapbackGlyph } from './glyphs';
import { linkifyParts, aggregateReactions, fileSizeLabel, fmtDuration } from './threadUtils';

// ── linkified text ────────────────────────────────────────────────────────
export function Linkified({ text }) {
  const parts = linkifyParts(text);
  return parts.map((p, i) => (p.type === 'link'
    ? <a key={i} className="km-blink" href={p.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{p.value}</a>
    : <span key={i}>{p.value}</span>));
}

// ── link previews (module cache, in-flight dedupe) ───────────────────────
const previewCache = new Map(); // url -> { at, value }
const inflight = new Map();

function fetchPreview(url) {
  const hit = previewCache.get(url);
  if (hit && Date.now() - hit.at < (hit.value ? 10 * 60_000 : 60_000)) return Promise.resolve(hit.value);
  if (inflight.has(url)) return inflight.get(url);
  const p = getLinkPreview(url)
    .then((r) => (r && r.ok ? r.data : null))
    .catch(() => null)
    .then((value) => { previewCache.set(url, { at: Date.now(), value }); inflight.delete(url); return value; });
  inflight.set(url, p);
  return p;
}
export const prefetchLinkPreview = (url) => { if (url) fetchPreview(url); };

export function useLinkPreview(url) {
  const cached = url ? previewCache.get(url) : null;
  const [state, setState] = useState(() => ({ loading: !cached, data: cached ? cached.value : null }));
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    const hit = previewCache.get(url);
    if (hit) setState({ loading: false, data: hit.value });
    else setState({ loading: true, data: null });
    fetchPreview(url).then((data) => { if (alive) setState({ loading: false, data }); });
    return () => { alive = false; };
  }, [url]);
  return state;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function LinkPreviewCard({ url }) {
  const { loading, data } = useLinkPreview(url);
  const host = (data && data.host) || hostOf(url);
  return (
    <a className="km-link-card km-press" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {data && data.image ? <img src={data.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
      <div className="km-link-body">
        {loading ? (
          <>
            <div className="km-link-skel" style={{ width: '72%' }} />
            <div className="km-link-skel" style={{ width: '46%' }} />
          </>
        ) : (
          <div className="km-link-title">{(data && (data.title || data.siteName)) || host}</div>
        )}
        <div className="km-link-host">
          <Icon name="link" size={11} stroke={2.2} />
          <span className="km-truncate">{host}</span>
        </div>
      </div>
    </a>
  );
}

// ── listing card (Message kind 'listing') ─────────────────────────────────
const STATUS_LABEL = {
  active: 'Active', coming_soon: 'Coming Soon', pending: 'Pending', under_contract: 'Under Contract',
  sold: 'Sold', off_market: 'Off-Market', withdrawn: 'Withdrawn', expired: 'Expired',
};

export function ListingCard({ listing }) {
  if (!listing) return null;
  const price = listing.price ? money(listing.price) : (listing.priceLabel || 'Price on request');
  const specs = specLine({ beds: listing.beds, baths: listing.baths, sqft: listing.sqft });
  const place = [listing.neighborhood, listing.city].filter(Boolean).join(', ');
  return (
    <button
      type="button"
      className="km-listing-card km-press"
      onClick={(e) => { e.stopPropagation(); if (listing.id) nav.openListing(listing.id); }}
    >
      <PropertyPhoto src={listing.heroPhoto} seed={listing.id} label={listing.neighborhood || listing.city} ratio="16 / 10">
        {listing.status && STATUS_LABEL[listing.status] ? <span className="km-lc-status">{STATUS_LABEL[listing.status]}</span> : null}
      </PropertyPhoto>
      <div className="km-lc-body">
        <div className="km-lc-price">{price}</div>
        {specs ? <div className="km-lc-specs">{specs}</div> : null}
        <div className="km-lc-addr km-truncate">{listing.address}{place ? <span style={{ opacity: 0.6, fontWeight: 400 }}>{` · ${place}`}</span> : null}</div>
      </div>
      <div className="km-lc-foot">
        <span>View property</span>
        <Icon name="chevronRight" size={15} stroke={2.4} />
      </div>
    </button>
  );
}

// ── files / PDFs ──────────────────────────────────────────────────────────
export function FileCard({ att }) {
  const name = att.fileName || 'Attachment';
  const ext = (name.split('.').pop() || '').slice(0, 4).toUpperCase();
  const isPdf = (att.mimeType || '').includes('pdf') || ext === 'PDF';
  return (
    <a className="km-file-card km-press" href={mediaUrl(att.url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      <span className={`km-file-ico ${isPdf ? '' : 'km-file-ico--gen'}`}>{isPdf ? 'PDF' : (ext || 'FILE')}</span>
      <span style={{ minWidth: 0 }}>
        <span className="km-file-name">{name}</span>
        <span className="km-file-size" style={{ display: 'block' }}>{[fileSizeLabel(att.size), isPdf ? 'PDF Document' : null].filter(Boolean).join(' · ') || 'Tap to open'}</span>
      </span>
    </a>
  );
}

// ── calls merged into the thread ──────────────────────────────────────────
export function CallCard({ call, at }) {
  if (!call) return null;
  const missed = ['missed', 'no_answer', 'busy', 'failed', 'cancelled'].includes(call.status);
  const out = call.direction === 'outbound';
  const label = call.voicemail ? 'Voicemail'
    : missed ? (out ? 'No answer' : 'Missed call')
      : out ? 'Outgoing call' : 'Incoming call';
  return (
    <div className="km-call-card">
      <div className="km-call-head">
        <span className={`km-call-ico ${missed ? 'km-call-ico--missed' : out ? 'km-call-ico--out' : ''}`}>
          <Icon name={missed ? 'phoneMissed' : out ? 'phoneOutgoing' : 'phoneIncoming'} size={15} stroke={2.1} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
            {label}{!missed && call.durationSec ? <span style={{ color: 'var(--dim)', fontWeight: 500 }}>{` · ${fmtDuration(call.durationSec)}`}</span> : null}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--faint)', marginTop: 1 }}>{formatTime(at)}{call.hasRecording ? ' · Recorded' : ''}</span>
        </span>
      </div>
      {Array.isArray(call.bullets) && call.bullets.length ? (
        <ul className="km-call-bullets">
          {call.bullets.slice(0, 3).map((b, i) => <li key={i}>{String(b).replace(/^[-•*]\s*/, '')}</li>)}
        </ul>
      ) : call.summary ? (
        <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.4 }}>{call.summary}</div>
      ) : null}
    </div>
  );
}

// ── tapback badges ────────────────────────────────────────────────────────
export function Reactions({ reactions, side }) {
  const agg = aggregateReactions(reactions);
  if (!agg.length) return null;
  return (
    <div className={`km-reacts km-reacts--${side}`}>
      {agg.slice(0, 3).map((r) => (
        <span key={r.key} className={`km-react km-react-pop ${r.mine ? 'km-react--mine' : ''}`}>
          <TapbackGlyph type={r.type} emoji={r.emoji} size={16} />
          {r.count > 1 ? <small>{r.count}</small> : null}
        </span>
      ))}
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="km-row-msg km-row-msg--recv" style={{ marginTop: 10 }} aria-label="Typing">
      <div className="km-bwrap">
        <div className="km-typing"><i /><i /><i /></div>
      </div>
    </div>
  );
}

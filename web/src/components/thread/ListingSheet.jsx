// "Send a Listing" — the real-estate replacement for RevMatch's Stock # sheet.
// Search own / MLS / pocket listings by address, MLS #, neighborhood or
// building → tap one to stage it in the composer as a listing card (the agent
// can add a note before sending; nothing sends from here).
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { SkeletonRows, EmptyState } from '../ui/kit';
import { api } from '../../api/client';
import { moneyCompact, specLine } from '../../lib/format';

export function listingSnapshot(l) {
  const street = [l.street, l.unitNumber ? `#${l.unitNumber}` : null].filter(Boolean).join(' ');
  return {
    id: l.id,
    title: l.title || null,
    address: l.hideAddress ? (l.buildingName || l.title || 'Private residence') : (street || l.title || 'Listing'),
    neighborhood: l.neighborhood || null,
    city: l.city || null,
    price: l.listPrice || null,
    beds: l.beds ?? null,
    baths: l.baths ?? l.bathsTotal ?? null,
    sqft: l.sqft ?? l.livingAreaSqft ?? null,
    status: l.status || null,
    origin: l.origin || null,
    heroPhoto: (Array.isArray(l.photos) && l.photos[0]) || l.heroPhoto || null,
    url: l.shareUrl || null,
  };
}

export default function ListingSheet({ open, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch { /* ignore */ } }, 120);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const n = ++seq.current;
    const t = setTimeout(() => {
      api.get('/listings', { search: q.trim() || undefined, limit: 30, matches: 0, sort: 'newest' })
        .then((r) => {
          if (n !== seq.current) return;
          setRows((r.listings || []).filter((l) => l.origin !== 'whisper' && l.lane !== 'whisper'));
          setError(null);
        })
        .catch((e) => { if (n === seq.current) { setRows([]); setError(e); } });
    }, q ? 240 : 0);
    return () => clearTimeout(t);
  }, [open, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Send a Listing" maxHeight="82%">
      <div className="km-search km-lg km-lg--line" style={{ marginBottom: 12 }}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Address, MLS #, neighborhood, building"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
        />
        {q ? (
          <button type="button" onClick={() => setQ('')} aria-label="Clear" style={{ color: 'var(--faint)', display: 'flex' }}>
            <Icon name="x" size={16} />
          </button>
        ) : null}
      </div>
      {rows === null ? <SkeletonRows n={5} /> : rows.length === 0 ? (
        <EmptyState
          icon="house"
          title={error ? 'Listings unavailable' : q ? 'No matching listings' : 'No listings yet'}
          sub={error ? 'Check your connection and try again.' : q ? 'Try a street name, MLS number or neighborhood.' : 'Add a listing and it will show up here.'}
        />
      ) : rows.map((l) => {
        const specs = specLine({ beds: l.beds, baths: l.baths, sqft: l.sqft });
        return (
          <button
            key={l.id}
            type="button"
            className="km-row km-press"
            style={{ width: '100%', textAlign: 'left', gap: 12 }}
            onClick={() => { onPick && onPick(listingSnapshot(l)); }}
          >
            <PropertyPhoto src={(l.photos && l.photos[0]) || null} seed={l.id} height={46} radius={10} style={{ width: 62, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="km-truncate" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{l.title || l.street || 'Listing'}</span>
              <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>
                {[l.listPrice ? moneyCompact(l.listPrice) : null, specs, l.neighborhood].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bright)', flexShrink: 0 }}>Add</span>
          </button>
        );
      })}
    </Sheet>
  );
}

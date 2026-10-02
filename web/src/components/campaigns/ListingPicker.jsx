// ListingPicker — attach a listing to a campaign (GET /api/listings).
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { EmptyState, SkeletonRows } from '../ui/kit';
import { moneyCompact } from '../../lib/format';
import { searchListings } from '../../api/campaigns';

function specs(l) {
  return [l.beds != null ? `${l.beds} bd` : null, l.baths != null ? `${l.baths} ba` : null, l.sqft ? `${Number(l.sqft).toLocaleString('en-US')} sq ft` : null].filter(Boolean).join(' · ');
}

export default function ListingPicker({ open, onClose, onPick, includeSold = true }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const t = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      searchListings({ search: q || undefined, status: includeSold ? 'all' : undefined, matches: 0, limit: 60, sort: 'tier' })
        .then((d) => { setRows(d.listings || []); setError(null); })
        .catch((e) => { setError(e); setRows([]); });
    }, q ? 250 : 0);
    return () => clearTimeout(t.current);
  }, [open, q, includeSold]);

  return (
    <Sheet open={open} onClose={onClose} title="Attach a listing" maxHeight="82%">
      {({ close }) => (
        <>
          <div className="km-search km-lg km-lg--line" style={{ marginBottom: 12 }}>
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address, neighborhood, MLS #" aria-label="Search listings" />
          </div>
          {rows == null ? <SkeletonRows n={4} /> : null}
          {rows && !rows.length ? (
            <EmptyState icon="building" title={error ? 'Listings are unavailable' : 'No listings found'} sub={error ? 'Try again in a moment.' : 'Try another address or neighborhood.'} style={{ padding: '28px 12px' }} />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(rows || []).map((l) => (
              <button
                key={l.id}
                type="button"
                className="km-press"
                onClick={() => { onPick(l); close(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px', borderBottom: '1px solid var(--line)', textAlign: 'left' }}
              >
                <PropertyPhoto src={(l.photos || [])[0]} seed={l.id} height={54} radius={12} style={{ width: 72, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{l.title || l.street || l.neighborhood}</span>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{[l.listPrice ? moneyCompact(l.listPrice) : null, specs(l)].filter(Boolean).join(' · ')}</span>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{[l.neighborhood, l.statusLabel || l.status, l.laneLabel].filter(Boolean).join(' · ')}</span>
                </span>
                <Icon name="chevronRight" size={15} color="var(--faint)" />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

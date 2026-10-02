// "Set the property" — RevMatch's SetCarSheet re-geared: tap a property to
// make it THE one, or keep a shortlist of the ones they're weighing. Sources:
// the deal's shortlist, the client's portfolio (watching / owned), a listings
// search (listings builder; guarded if absent) and a typed address. Every
// toggle saves immediately through the deal store.
import { useEffect, useMemo, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Spinner } from '../ui/kit';
import { api } from '../../api/client';
import { moneyCompact } from '../../lib/format';

export function listingRow(l) {
  if (!l) return null;
  const street = l.street ? `${l.street}${l.unitNumber ? ` #${l.unitNumber}` : ''}` : null;
  const address = l.address || street || l.buildingName || l.developmentName || l.title || 'Listing';
  return {
    key: `l:${l.id}`,
    listingId: l.id,
    label: address,
    address,
    sub: [l.buildingName && l.buildingName !== address ? l.buildingName : null, l.neighborhood || l.city].filter(Boolean).join(' · '),
    price: l.listPrice ?? l.price ?? null,
    photo: l.heroPhoto || (l.photoUrls || l.photos || [])[0] || null,
    mlsNumber: l.mlsNumber || null,
  };
}
function propertyRow(p) {
  const street = p.street ? `${p.street}${p.unit ? ` #${p.unit}` : ''}` : null;
  const address = street || p.buildingName || p.nickname || 'Property';
  return {
    key: `p:${p.id}`,
    portfolioPropertyId: p.id,
    listingId: p.listingId || null,
    label: address,
    address,
    sub: [p.relationship, p.neighborhood || p.city].filter(Boolean).join(' · '),
    price: p.estValue ?? p.purchasePrice ?? null,
    photo: p.heroPhoto || (p.photos || [])[0] || null,
    relationship: p.relationship,
  };
}

// Search listings (listings builder's GET /api/listings?search=). Resolves
// { rows, unavailable } — never throws.
export async function searchListings(q, limit = 8) {
  try {
    const r = await api.get('/listings', { search: q || undefined, limit });
    const list = r.listings || r.items || r.results || [];
    return { rows: list.map(listingRow).filter(Boolean), unavailable: false };
  } catch (err) {
    return { rows: [], unavailable: err && (err.status === 404 || err.status === 503) };
  }
}

export default function ShortlistSheet({ deal, open, onClose, onUpdate }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [props, setProps] = useState([]);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open || !deal || !deal.clientId) return undefined;
    let alive = true;
    api.get(`/clients/${deal.clientId}`).then((r) => {
      const ps = (r.client && (r.client.properties || r.client.portfolio)) || [];
      if (alive) setProps(ps.filter((p) => p.relationship !== 'sold').map(propertyRow));
    }).catch(() => {});
    return () => { alive = false; };
  }, [open, deal && deal.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setHits(null);
      searchListings(q, 8).then((r) => { if (alive) { setHits(r.rows); setUnavailable(r.unavailable); } });
    }, q ? 260 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q]);

  const shortlist = useMemo(() => (deal && Array.isArray(deal.shortlist) ? deal.shortlist : []), [deal]);
  if (!deal) return null;
  const isTheOne = (r) => (r.listingId && r.listingId === deal.listingId)
    || (r.portfolioPropertyId && r.portfolioPropertyId === deal.portfolioPropertyId)
    || (!r.listingId && !r.portfolioPropertyId && r.address && r.address === deal.propertyAddress);
  const inList = (r) => shortlist.some((s) => s.key === r.key);

  const toggle = (r) => {
    const next = inList(r) ? shortlist.filter((s) => s.key !== r.key) : [...shortlist, slim(r)];
    onUpdate({ shortlist: next });
  };
  const makeOne = (r) => {
    const patch = {};
    if (r.listingId) { patch.listingId = r.listingId; patch.propertyAddress = null; }
    else patch.listingId = null;
    if (r.portfolioPropertyId) patch.portfolioPropertyId = r.portfolioPropertyId;
    if (!r.listingId) patch.propertyAddress = r.address;
    patch.propertyLabel = r.label !== r.address ? r.label : null;
    if (r.price && !deal.price) patch[deal.priceField || 'price'] = r.price;
    if (!inList(r)) patch.shortlist = [...shortlist, slim(r)];
    onUpdate(patch);
  };

  const row = (r, showToggle = true) => {
    const one = isTheOne(r);
    return (
      <div className="km-pl-short" key={r.key}>
        <PropertyPhoto src={r.photo} seed={r.key} className="km-pl-short-thumb" radius={6} height={26} style={{ width: 34 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="km-truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{r.label}</div>
          <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            {[r.price ? moneyCompact(r.price) : null, r.sub, r.mlsNumber ? `MLS ${r.mlsNumber}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {one ? <span className="km-pl-theone">✓ THE ONE</span> : (
          <button type="button" className="km-pl-mini km-press" onClick={() => makeOne(r)}>Make it the one</button>
        )}
        {showToggle ? (
          <button type="button" className="km-icon-btn km-icon-btn--sm" aria-label={inList(r) ? 'Remove from shortlist' : 'Add to shortlist'} onClick={() => toggle(r)}>
            <Icon name={inList(r) ? 'x' : 'plus'} size={15} color={inList(r) ? 'var(--faint)' : 'var(--blue)'} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title="Set the property" subtitle={deal.name} left={false} right={{ label: 'Done', onClick: onClose }} zIndex={520} maxHeight="86%">
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 12, lineHeight: 1.45 }}>
        Tap a property to make it <b style={{ color: 'var(--text)' }}>the one</b>, or add the ones they’re weighing.
      </div>
      {shortlist.length ? (
        <>
          <div className="km-pl-label">Shortlisted · {shortlist.length}</div>
          <div className="km-pl-optlist" style={{ padding: '2px 12px' }}>
            {shortlist.map((x) => row(x))}
          </div>
        </>
      ) : null}
      {props.length ? (
        <>
          <div className="km-pl-label">From their portfolio</div>
          <div className="km-pl-optlist" style={{ padding: '2px 12px' }}>
            {props.map((x) => row(x))}
          </div>
        </>
      ) : null}
      <div className="km-pl-label">Search listings</div>
      <div className="km-search km-lg km-lg--line" style={{ marginBottom: 8 }}>
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address, building, MLS #" />
      </div>
      {unavailable ? (
        <div className="km-pl-dashed">Listing search isn’t available right now — type the address below.</div>
      ) : hits === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}><Spinner /></div>
      ) : hits.length ? (
        <div className="km-pl-optlist" style={{ padding: '2px 12px' }}>
          {hits.map((x) => row(x))}
        </div>
      ) : (
        <div className="km-pl-dashed">{q ? 'No listings match that.' : 'No listings yet.'}</div>
      )}
      <div className="km-pl-label">Or type an address</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="km-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 1 Hotel Residences #1602" />
        <button
          type="button"
          className="km-btn km-btn--sm"
          disabled={!typed.trim()}
          onClick={() => {
            const a = typed.trim();
            makeOne({ key: `a:${a.toLowerCase()}`, label: a, address: a });
            setTyped('');
          }}
        >
          Set
        </button>
      </div>
    </Sheet>
  );
}

function slim(r) {
  return {
    key: r.key,
    listingId: r.listingId || null,
    portfolioPropertyId: r.portfolioPropertyId || null,
    label: r.label,
    address: r.address || r.label,
    price: r.price || null,
    photo: r.photo || null,
    mlsNumber: r.mlsNumber || null,
  };
}

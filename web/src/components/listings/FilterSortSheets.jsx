// Listings filter + sort sheets (port of RM FilterSortSheets, re-geared):
// draft-then-apply filters with live "Show N homes" count; sections only render
// when the data has ≥2 distinct values; groups AND, choices within a group OR;
// a listing missing a field fails an active filter.
import { useMemo, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { LANES, LANE_BY_ID, LaneDot, cap } from './listingKit';

export const EMPTY_FILTERS = {
  status: [], type: [], priceMin: null, priceMax: null, beds: null, baths: null, sqftMin: null, lotMin: null, yearMin: null,
  waterfront: [], view: [], style: [], neighborhood: [], lanes: [],
};

export const SORT_OPTIONS = [
  { id: 'tier', label: 'Default order', short: 'Default', sub: 'Price tier, waterfront, newest — best match breaks ties' },
  { id: 'newest', label: 'Newest listed', short: 'Newest' },
  { id: 'price_asc', label: 'Price: low to high', short: 'Price ↑' },
  { id: 'price_desc', label: 'Price: high to low', short: 'Price ↓' },
  { id: 'ppsf', label: 'Price per sq ft', short: '$/sq ft', sub: 'Highest first' },
  { id: 'sqft', label: 'Largest interior', short: 'Sq ft' },
  { id: 'reduced', label: 'Recently reduced', short: 'Reduced' },
  { id: 'dom', label: 'Days on market', short: 'DOM', sub: 'Freshest first' },
];

const STYLE_LABEL = { modern: 'Modern', mediterranean: 'Mediterranean', traditional: 'Traditional', coastal: 'Coastal', rustic: 'Farmhouse', art_deco: 'Art Deco' };
const PRICE_STEPS = [1e6, 2e6, 3e6, 5e6, 7.5e6, 10e6, 15e6, 20e6, 30e6];
const SQFT_STEPS = [2000, 3000, 4000, 5000, 6000, 8000, 10000];
const LOT_STEPS = [[10890, '¼ ac'], [21780, '½ ac'], [43560, '1 ac'], [87120, '2 ac'], [217800, '5 ac']];
const YEAR_STEPS = [1990, 2000, 2010, 2015, 2020, 2024];
const fmtM = (v) => (v >= 1e6 ? `$${(v / 1e6).toString().replace(/\.0$/, '')}M` : `$${Math.round(v / 1e3)}K`);

const tokenize = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
function hay(l) {
  return [l.title, l.subtitle, l.street, l.neighborhood, l.buildingName, l.city, l.market, l.mlsNumber, l.architecturalStyle, l.typeLabel,
    l.developmentName, (l.amenities || []).join(' '), (l.views || []).join(' '), l.waterfrontLabel, l.postalCode, l.laneLabel].filter(Boolean).join(' ').toLowerCase();
}

export function passesFilters(l, f, { lane, search } = {}) {
  if (lane && lane !== 'all' && l.lane !== lane) return false;
  const toks = tokenize(search);
  if (toks.length) { const h = hay(l); if (!toks.every((t) => h.includes(t))) return false; }
  if (f.lanes.length && !f.lanes.includes(l.lane)) return false;
  if (f.status.length && !f.status.includes(l.status)) return false;
  if (f.type.length && !f.type.includes(l.propertyType)) return false;
  const price = l.listPrice || l.priceGuide || null;
  if (f.priceMin != null && (price == null || price < f.priceMin)) return false;
  if (f.priceMax != null && (price == null || price > f.priceMax)) return false;
  if (f.beds != null && (l.beds == null || l.beds < f.beds)) return false;
  if (f.baths != null && (l.baths == null || l.baths < f.baths)) return false;
  if (f.sqftMin != null && (l.sqft == null || l.sqft < f.sqftMin)) return false;
  if (f.lotMin != null && (l.lotSqft == null || l.lotSqft < f.lotMin)) return false;
  if (f.yearMin != null && (l.yearBuilt == null || Math.max(l.yearBuilt, l.yearRenovated || 0) < f.yearMin)) return false;
  if (f.waterfront.length) {
    const w = l.waterfront && l.waterfront !== 'none' ? l.waterfront : null;
    if (!w) return false;
    if (!f.waterfront.includes('any') && !f.waterfront.includes(w)) return false;
  }
  if (f.view.length && !(l.views || []).some((v) => f.view.includes(v))) return false;
  if (f.style.length && !f.style.includes(l.styleFamily)) return false;
  if (f.neighborhood.length && !f.neighborhood.includes(l.neighborhood || l.city)) return false;
  return true;
}

export function activeCount(f) {
  let n = 0;
  for (const k of ['status', 'type', 'waterfront', 'view', 'style', 'neighborhood', 'lanes']) if (f[k].length) n += 1;
  if (f.priceMin != null || f.priceMax != null) n += 1;
  for (const k of ['beds', 'baths', 'sqftMin', 'lotMin', 'yearMin']) if (f[k] != null) n += 1;
  return n;
}

const DAY = 864e5;
export function sortListings(list, sort) {
  const by = {
    tier: (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (b.bestScore || 0) - (a.bestScore || 0),
    newest: (a, b) => new Date(b.listedAt || b.createdAt) - new Date(a.listedAt || a.createdAt),
    price_asc: (a, b) => (a.listPrice ?? a.priceGuide ?? Infinity) - (b.listPrice ?? b.priceGuide ?? Infinity),
    price_desc: (a, b) => (b.listPrice ?? b.priceGuide ?? -1) - (a.listPrice ?? a.priceGuide ?? -1),
    ppsf: (a, b) => (b.pricePerSqft ?? -1) - (a.pricePerSqft ?? -1),
    sqft: (a, b) => (b.sqft ?? -1) - (a.sqft ?? -1),
    reduced: (a, b) => (b.priceDroppedAt ? new Date(b.priceDroppedAt).getTime() : -Infinity) - (a.priceDroppedAt ? new Date(a.priceDroppedAt).getTime() : -Infinity),
    dom: (a, b) => (a.dom ?? Infinity) - (b.dom ?? Infinity),
  }[sort] || ((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
  return [...list].sort(by);
}
void DAY;

function Chip({ on, onClick, children, count, dot, disabled }) {
  return (
    <button type="button" className={`kl-fchip ${on ? 'kl-fchip--on' : ''}`} onClick={onClick} disabled={disabled}>
      {dot ? <LaneDot color={dot} size={7} /> : null}
      {children}
      {count != null ? <span className="n">{count}</span> : null}
    </button>
  );
}

function Group({ title, right, children }) {
  return (
    <div className="kl-fgroup">
      <div className="kl-fgroup-title"><span>{title}</span>{right || null}</div>
      {children}
    </div>
  );
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function FilterSheet({ open, onClose, listings, value, onApply, lane, search }) {
  const [draft, setDraft] = useState(value);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) { setLastOpen(open); if (open) setDraft(value); }
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const facets = useMemo(() => {
    const count = (key) => {
      const m = new Map();
      for (const l of listings) {
        const vals = [].concat(key(l)).filter(Boolean);
        for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      status: count((l) => l.status),
      type: count((l) => l.propertyType),
      waterfront: count((l) => (l.waterfront && l.waterfront !== 'none' ? l.waterfront : null)),
      view: count((l) => l.views || []),
      style: count((l) => l.styleFamily),
      neighborhood: count((l) => l.neighborhood || l.city).slice(0, 24),
      lanes: count((l) => l.lane),
      prices: listings.map((l) => l.listPrice || l.priceGuide).filter(Boolean),
      beds: listings.some((l) => l.beds != null),
      baths: listings.some((l) => l.baths != null),
      sqft: listings.filter((l) => l.sqft).length >= 2,
      lot: listings.filter((l) => l.lotSqft).length >= 2,
      year: listings.filter((l) => l.yearBuilt).length >= 2,
    };
  }, [listings]);

  const matchCount = useMemo(() => listings.filter((l) => passesFilters(l, draft, { lane, search })).length, [listings, draft, lane, search]);
  const any = activeCount(draft) > 0;
  const statusLabel = { active: 'Active', coming_soon: 'Coming soon', pending: 'Pending', under_contract: 'Under contract', off_market: 'Off market', sold: 'Sold' };
  const typeLabel = { single_family: 'Single-family', estate: 'Estate', condo: 'Condo', penthouse: 'Penthouse', townhouse: 'Townhouse', villa: 'Villa', co_op: 'Co-op', land: 'Land' };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      left={any ? { label: 'Reset', onClick: () => setDraft(EMPTY_FILTERS) } : { label: 'Cancel' }}
      footer={({ close }) => (
        <button type="button" className="km-btn km-btn--block km-btn--lg" disabled={!matchCount} onClick={() => { onApply(draft); close(); }}>
          {matchCount ? `Show ${matchCount} home${matchCount === 1 ? '' : 's'}` : 'No homes match'}
        </button>
      )}
    >
      {facets.lanes.length >= 2 ? (
        <Group title="Source">
          <div className="kl-fchips">
            {LANES.filter((ln) => facets.lanes.some(([v]) => v === ln.id)).map((ln) => (
              <Chip key={ln.id} on={draft.lanes.includes(ln.id)} dot={ln.color} count={(facets.lanes.find(([v]) => v === ln.id) || [])[1]} onClick={() => set({ lanes: toggle(draft.lanes, ln.id) })}>{ln.label}</Chip>
            ))}
          </div>
        </Group>
      ) : null}
      {facets.status.length >= 2 ? (
        <Group title="Status">
          <div className="kl-fchips">{facets.status.map(([v, n]) => <Chip key={v} on={draft.status.includes(v)} count={n} onClick={() => set({ status: toggle(draft.status, v) })}>{statusLabel[v] || cap(v)}</Chip>)}</div>
        </Group>
      ) : null}
      {facets.type.length >= 2 ? (
        <Group title="Property type">
          <div className="kl-fchips">{facets.type.map(([v, n]) => <Chip key={v} on={draft.type.includes(v)} count={n} onClick={() => set({ type: toggle(draft.type, v) })}>{typeLabel[v] || cap(v)}</Chip>)}</div>
        </Group>
      ) : null}
      {facets.prices.length >= 2 ? (
        <Group title="Price" right={<span className="kl-range-label">{draft.priceMin || draft.priceMax ? `${draft.priceMin ? fmtM(draft.priceMin) : 'Any'} – ${draft.priceMax ? fmtM(draft.priceMax) : 'Any'}` : 'Any price'}</span>}>
          <div className="kl-range-label">From</div>
          <div className="kl-fchips">
            <Chip on={draft.priceMin == null} onClick={() => set({ priceMin: null })}>Any</Chip>
            {PRICE_STEPS.map((v) => <Chip key={v} on={draft.priceMin === v} disabled={draft.priceMax != null && v >= draft.priceMax} onClick={() => set({ priceMin: v })}>{fmtM(v)}</Chip>)}
          </div>
          <div className="kl-range-label">Up to</div>
          <div className="kl-fchips">
            <Chip on={draft.priceMax == null} onClick={() => set({ priceMax: null })}>Any</Chip>
            {PRICE_STEPS.map((v) => <Chip key={v} on={draft.priceMax === v} disabled={draft.priceMin != null && v <= draft.priceMin} onClick={() => set({ priceMax: v })}>{fmtM(v)}</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.beds ? (
        <Group title="Bedrooms">
          <div className="kl-fchips">
            <Chip on={draft.beds == null} onClick={() => set({ beds: null })}>Any</Chip>
            {[1, 2, 3, 4, 5, 6].map((v) => <Chip key={v} on={draft.beds === v} onClick={() => set({ beds: v })}>{v}+</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.baths ? (
        <Group title="Bathrooms">
          <div className="kl-fchips">
            <Chip on={draft.baths == null} onClick={() => set({ baths: null })}>Any</Chip>
            {[1, 2, 3, 4, 5, 6].map((v) => <Chip key={v} on={draft.baths === v} onClick={() => set({ baths: v })}>{v}+</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.sqft ? (
        <Group title="Interior">
          <div className="kl-fchips">
            <Chip on={draft.sqftMin == null} onClick={() => set({ sqftMin: null })}>Any</Chip>
            {SQFT_STEPS.map((v) => <Chip key={v} on={draft.sqftMin === v} onClick={() => set({ sqftMin: v })}>{`${v / 1000}K+ sf`}</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.lot ? (
        <Group title="Lot">
          <div className="kl-fchips">
            <Chip on={draft.lotMin == null} onClick={() => set({ lotMin: null })}>Any</Chip>
            {LOT_STEPS.map(([v, label]) => <Chip key={v} on={draft.lotMin === v} onClick={() => set({ lotMin: v })}>{label}+</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.year ? (
        <Group title="Year built">
          <div className="kl-fchips">
            <Chip on={draft.yearMin == null} onClick={() => set({ yearMin: null })}>Any</Chip>
            {YEAR_STEPS.map((v) => <Chip key={v} on={draft.yearMin === v} onClick={() => set({ yearMin: v })}>{v}+</Chip>)}
          </div>
        </Group>
      ) : null}
      {facets.waterfront.length ? (
        <Group title="Waterfront">
          <div className="kl-fchips">
            <Chip on={draft.waterfront.includes('any')} onClick={() => set({ waterfront: draft.waterfront.includes('any') ? [] : ['any'] })}><Icon name="waves" size={13} stroke={2} />Any waterfront</Chip>
            {facets.waterfront.length >= 2 ? facets.waterfront.map(([v, n]) => <Chip key={v} on={draft.waterfront.includes(v)} count={n} onClick={() => set({ waterfront: toggle(draft.waterfront.filter((x) => x !== 'any'), v) })}>{cap(v)}</Chip>) : null}
          </div>
        </Group>
      ) : null}
      {facets.view.length >= 2 ? (
        <Group title="View">
          <div className="kl-fchips">{facets.view.map(([v, n]) => <Chip key={v} on={draft.view.includes(v)} count={n} onClick={() => set({ view: toggle(draft.view, v) })}>{cap(v)}</Chip>)}</div>
        </Group>
      ) : null}
      {facets.style.length >= 2 ? (
        <Group title="Style">
          <div className="kl-fchips">{facets.style.map(([v, n]) => <Chip key={v} on={draft.style.includes(v)} count={n} onClick={() => set({ style: toggle(draft.style, v) })}>{STYLE_LABEL[v] || cap(v)}</Chip>)}</div>
        </Group>
      ) : null}
      {facets.neighborhood.length >= 2 ? (
        <Group title="Neighborhood">
          <div className="kl-fchips">{facets.neighborhood.map(([v, n]) => <Chip key={v} on={draft.neighborhood.includes(v)} count={n} onClick={() => set({ neighborhood: toggle(draft.neighborhood, v) })}>{v}</Chip>)}</div>
        </Group>
      ) : null}
    </Sheet>
  );
}

export function SortSheet({ open, onClose, value, onChange }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sort" left={false}>
      {({ close }) => (
        <div>
          {SORT_OPTIONS.map((o) => (
            <button key={o.id} type="button" className="kl-sort-row km-press" onClick={() => { onChange(o.id); close(); }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: value === o.id ? 500 : 400, color: value === o.id ? 'var(--bright)' : 'var(--text)' }}>{o.label}</span>
                {o.sub ? <span className="s">{o.sub}</span> : null}
              </span>
              {value === o.id ? <Icon name="check" size={18} color="var(--bright)" stroke={2.4} /> : null}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function filterChipsSummary(f) {
  const out = [];
  if (f.lanes.length) out.push(['lanes', f.lanes.map((l) => (LANE_BY_ID[l] || {}).short || l).join(', ')]);
  if (f.priceMin != null || f.priceMax != null) out.push(['price', `${f.priceMin ? fmtM(f.priceMin) : 'Any'}–${f.priceMax ? fmtM(f.priceMax) : 'Any'}`]);
  if (f.beds != null) out.push(['beds', `${f.beds}+ bd`]);
  if (f.baths != null) out.push(['baths', `${f.baths}+ ba`]);
  if (f.waterfront.length) out.push(['waterfront', f.waterfront.includes('any') ? 'Waterfront' : f.waterfront.map(cap).join(', ')]);
  if (f.type.length) out.push(['type', `${f.type.length} type${f.type.length === 1 ? '' : 's'}`]);
  if (f.status.length) out.push(['status', f.status.map((s) => cap(s.replace('_', ' '))).join(', ')]);
  if (f.sqftMin != null) out.push(['sqftMin', `${f.sqftMin / 1000}K+ sf`]);
  if (f.lotMin != null) out.push(['lotMin', 'Lot']);
  if (f.yearMin != null) out.push(['yearMin', `${f.yearMin}+`]);
  if (f.view.length) out.push(['view', f.view.map(cap).join(', ')]);
  if (f.style.length) out.push(['style', f.style.map((s) => STYLE_LABEL[s] || s).join(', ')]);
  if (f.neighborhood.length) out.push(['neighborhood', f.neighborhood.length === 1 ? f.neighborhood[0] : `${f.neighborhood.length} areas`]);
  return out;
}

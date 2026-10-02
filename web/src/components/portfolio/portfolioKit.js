// Portfolio vocab + formatters (RevMatch garageSpec.js, re-geared).
import { moneyCompact } from '../../lib/format';

export const REL = {
  owns: { label: 'Owned', dot: 'var(--green)' },
  leased_out: { label: 'Rental property', dot: 'var(--green)' },
  rents: { label: 'Rents', dot: 'var(--cyan)' },
  watching: { label: 'Watching', dot: 'var(--violet)' },
  sold: { label: 'Sold', dot: 'rgba(255,255,255,0.56)' },
};
export const REL_OPTS = [
  { value: 'owns', label: 'Owned' }, { value: 'rents', label: 'Rents' }, { value: 'sold', label: 'Sold' }, { value: 'watching', label: 'Watching' },
];
export const OCC = { primary: 'Primary', second_home: 'Second home', investment: 'Investment', vacation: 'Vacation', rental: 'Rental' };
export const OCC_OPTS = Object.entries(OCC).map(([value, label]) => ({ value, label }));

export const TYPES = [
  { value: 'single_family', label: 'Single-family' }, { value: 'estate', label: 'Estate' }, { value: 'condo', label: 'Condo' },
  { value: 'penthouse', label: 'Penthouse' }, { value: 'townhouse', label: 'Townhouse' }, { value: 'villa', label: 'Villa' },
  { value: 'co_op', label: 'Co-op' }, { value: 'land', label: 'Land' },
];
export const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

export const WATERFRONT = [
  { value: 'oceanfront', label: 'Oceanfront' }, { value: 'bayfront', label: 'Bayfront' }, { value: 'intracoastal', label: 'Intracoastal' },
  { value: 'canal', label: 'Canal' }, { value: 'lake', label: 'Lake' }, { value: 'river', label: 'River' }, { value: 'any', label: 'Any water' },
];
export const WATER_LABEL = { ...Object.fromEntries(WATERFRONT.map((w) => [w.value, w.label])), any: 'Waterfront', none: 'Not waterfront' };
export const VIEWS = ['ocean', 'bay', 'intracoastal', 'city', 'golf', 'park', 'garden', 'water', 'sunset'].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
export const STYLES = ['Modern', 'Contemporary', 'Mediterranean', 'Transitional', 'British West Indies', 'Spanish', 'Colonial', 'Traditional', 'Coastal', 'Art Deco', 'Farmhouse', 'Tropical Modern'];
export const FEATURE_SUGS = ['Pool', 'Dock', 'Boat lift', 'Wine cellar', 'Guest house', 'Elevator', 'Gated', 'Generator', 'Smart home', 'Home theater', 'Gym', 'Staff quarters', 'Summer kitchen', 'Rooftop terrace', 'Impact windows', 'Beach access', 'Tennis court', 'Spa', 'Private elevator', 'Concierge'];
export const DEALBREAKER_SUGS = ['HOA', 'Flood zone', 'Busy road', 'West-facing', 'Needs renovation', 'Ground floor', 'Shared walls', 'Short-term rental ban'];
export const AREA_SUGS = ['Coral Gables', 'Gables Estates', 'Cocoplum', 'Coconut Grove', 'Key Biscayne', 'Miami Beach', 'South of Fifth', 'Bal Harbour', 'Surfside', 'Sunny Isles Beach', 'Golden Beach', 'Fisher Island', 'Star Island', 'Indian Creek', 'La Gorce', 'Venetian Islands', 'Brickell', 'Edgewater', 'Pinecrest', 'Bay Harbor Islands', 'Aventura', 'Fort Lauderdale', 'Palm Beach'];
export const LOAN_TYPES = [{ value: 'fixed', label: 'Fixed' }, { value: 'arm', label: 'ARM' }, { value: 'interest_only', label: 'Interest-only' }, { value: 'balloon', label: 'Balloon' }];
export const VALUE_SOURCES = [{ value: 'manual', label: 'My estimate' }, { value: 'cma', label: 'CMA' }, { value: 'appraisal', label: 'Appraisal' }, { value: 'avm', label: 'AVM' }, { value: 'listing', label: 'List price' }];
export const TITLE_HOLDING = [{ value: 'individual', label: 'Individual' }, { value: 'joint', label: 'Joint' }, { value: 'trust', label: 'Trust' }, { value: 'llc', label: 'LLC' }];
export const SOURCE_LABEL = { listing_link: 'Listing link', document: 'Document', mls: 'MLS pull', public_record: 'Public record', described: 'Described', manual: 'Entered by hand' };

export const money = (n) => (n ? moneyCompact(n) : '—');

// Rates are stored as fractions (0.0325) — tolerate percent values (3.25).
export const ratePct = (r) => (r == null ? null : r > 1 ? r : r * 100);
export const fmtRate = (r) => (r == null ? null : `${ratePct(r).toFixed(3).replace(/\.?0+$/, '')}%`);

const humanKey = (k) => String(k || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, (m) => m.toUpperCase());
const MIN_UNIT = { dock: ' ft', frontage: ' ft', frontage_ft: ' ft', ceiling_height: ' ft', water_depth_low_tide: ' ft', high_floor: 'th floor', cap_rate: '%', terrace_sqft: ' sf', gallery_wall: ' ft', home_office: '' };
// Must-have label: "dock" + min 90 → "Dock ≥ 90 ft"; "high_floor" + 26 → "High floor ≥ 26th floor".
export function featureLabel(m) {
  if (!m) return '';
  const f = typeof m === 'string' ? m : m.feature;
  const base = humanKey(f);
  if (typeof m === 'object' && m.min != null && m.min !== '' && !/[≥>]/.test(base)) {
    const key = String(f).toLowerCase();
    const unit = MIN_UNIT[key] ?? (/dock|frontage|ceiling|depth|wall/.test(key) ? ' ft' : '');
    if (key === 'high_floor') return `Floor ${m.min}+`;
    if (key === 'home_office' && Number(m.min) > 1) return `${m.min} home offices`;
    return `${base} ≥ ${m.min}${unit}`;
  }
  return base;
}

// Features for display: structured features (confirmed / described) + MLS-style amenity keys (confirmed).
export function featureList(p) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(p.features) ? p.features : []) {
    const name = humanKey(f.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, confirmed: !!f.confirmed, raw: f });
  }
  for (const a of p.amenities || []) {
    const name = humanKey(a);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, confirmed: true, amenity: a });
  }
  return out;
}

export function propTitle(p) {
  if (!p) return '';
  if (p.title) return p.title;
  const unit = p.unit ? ` #${String(p.unit).replace(/^#/, '')}` : '';
  if (p.street) return `${p.street}${unit}`;
  if (p.buildingName) return `${p.buildingName}${unit}`;
  return p.nickname || p.neighborhood || p.city || 'Untitled property';
}

export function propSub(p) {
  const parts = [];
  if (p.street && p.buildingName) parts.push(p.buildingName);
  if (p.neighborhood) parts.push(p.neighborhood);
  if (p.city && p.city !== p.neighborhood) parts.push(p.city);
  return parts.join(' · ');
}

export function specLineP(p) {
  const out = [];
  if (p.beds != null) out.push(`${p.beds} bd`);
  if (p.baths != null) out.push(`${p.baths} ba`);
  if (p.sqft) out.push(`${Number(p.sqft).toLocaleString('en-US')} sf`);
  if (p.lotAcres) out.push(`${Number(p.lotAcres).toFixed(p.lotAcres < 1 ? 2 : 1).replace(/\.?0+$/, '')} ac`);
  else if (p.lotSqft && p.propertyType !== 'condo' && p.propertyType !== 'penthouse') out.push(`${(p.lotSqft / 43560).toFixed(2).replace(/\.?0+$/, '')} ac`);
  if (p.yearBuilt) out.push(String(p.yearBuilt));
  return out.join(' · ');
}

export function waterLine(p) {
  if (!p.waterfront || p.waterfront === 'none') return null;
  return [WATER_LABEL[p.waterfront] || p.waterfront, p.waterFrontageFt ? `${p.waterFrontageFt} ft frontage` : null, p.dockLengthFt ? `${p.dockLengthFt} ft dock` : null].filter(Boolean).join(' · ');
}

export function relLabel(p) {
  const r = REL[p.relationship] || REL.owns;
  if (p.relationship === 'owns' && p.occupancy && OCC[p.occupancy]) return `Owned · ${OCC[p.occupancy]}`;
  if (p.relationship === 'sold' && p.soldAt) return `Sold · ${new Date(p.soldAt).getFullYear()}`;
  return r.label;
}

export function valuePill(p) {
  if (p.relationship === 'sold') return p.soldPrice ? `Sold ${money(p.soldPrice)}` : null;
  if (p.relationship === 'rents') return p.rentAmount ? `${money(p.rentAmount)}/mo` : null;
  if (p.relationship === 'watching') return p.estValue ? `${money(p.estValue)}` : null;
  return p.estValue ? `${money(p.estValue)} est.` : null;
}

export const TONE_CLASS = { blue: 'kc-tag--blue', caution: 'kc-tag--amber', success: 'kc-tag--green', danger: 'kc-tag--red', neutral: '' };

// "HOA" → "No HOA" · "Busy road" → "No busy road" · "No pool" stays.
export function noLabel(d) {
  const t = String(d || '').trim();
  if (/^no\b/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  const keepCase = /^[A-Z]{2,}/.test(t);
  return `No ${keepCase ? t : t.charAt(0).toLowerCase() + t.slice(1)}`;
}

export function searchBudget(s) {
  if (s.priceMin && s.priceMax) return `${money(s.priceMin)}–${money(s.priceMax)}`;
  if (s.priceMax) return `Up to ${money(s.priceMax)}`;
  if (s.priceMin) return `${money(s.priceMin)}+`;
  return 'Budget open';
}

export function searchChips(s) {
  const chips = [];
  for (const a of (s.neighborhoods || []).slice(0, 3)) chips.push({ label: a, tone: (s.neighborhoods || []).length > 1 ? 'soft' : 'ok' });
  for (const b of (s.buildings || []).slice(0, 2)) chips.push({ label: b, tone: 'ok' });
  for (const t of (s.propertyTypes || []).slice(0, 2)) chips.push({ label: TYPE_LABEL[t] || t, tone: 'ok' });
  if (s.bedsMin) chips.push({ label: `${s.bedsMin}+ bd`, tone: 'ok' });
  if (s.bathsMin) chips.push({ label: `${s.bathsMin}+ ba`, tone: 'ok' });
  if (s.sqftMin) chips.push({ label: `${Math.round(s.sqftMin / 100) / 10}K+ sf`, tone: 'ok' });
  for (const w of (s.waterfront || []).slice(0, 2)) chips.push({ label: WATER_LABEL[w] || w, tone: 'ok' });
  for (const v of (s.views || []).slice(0, 2)) chips.push({ label: `${v.charAt(0).toUpperCase() + v.slice(1)} view`, tone: 'soft' });
  for (const m of (Array.isArray(s.mustHaves) ? s.mustHaves : []).slice(0, 4)) chips.push({ label: featureLabel(m), tone: (m.importance ?? 1) >= 1 ? 'ok' : 'soft', must: (m.importance ?? 1) >= 1 });
  for (const d of (s.dealBreakers || []).slice(0, 2)) chips.push({ label: noLabel(d), tone: 'no' });
  return chips;
}

export function photoOf(p) {
  return p.heroPhoto || (p.photos && p.photos[0]) || null;
}

export function fmtMonthYear(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Normalize the listings builder's per-client matches into searchId → [rows].
export function normalizeMatches(r) {
  const out = {};
  if (!r) return out;
  const push = (sid, m) => {
    if (!m) return;
    const listing = m.listing || m.property || m;
    const row = {
      id: m.id || listing.id || `${sid}:${Math.random()}`,
      listingId: m.listingId || listing.id,
      title: listing.title || [listing.street, listing.unitNumber ? `#${listing.unitNumber}` : null].filter(Boolean).join(' ') || listing.buildingName || listing.neighborhood || 'Listing',
      neighborhood: listing.neighborhood || listing.city,
      price: listing.listPrice || listing.priceGuide || listing.price,
      photo: listing.heroPhoto || (listing.photoUrls && listing.photoUrls[0]) || null,
      beds: listing.beds, baths: listing.bathsTotal ?? listing.baths, sqft: listing.livingAreaSqft ?? listing.sqft,
      score: m.score ?? m.result?.score ?? null,
      summary: m.summary || m.result?.summary || null,
      origin: listing.origin || m.kind,
      url: listing.listingUrl || null,
    };
    (out[sid || '_'] = out[sid || '_'] || []).push(row);
  };
  if (Array.isArray(r.searches)) {
    for (const s of r.searches) for (const m of s.matches || s.listings || []) push(s.searchId || s.id || (s.search && s.search.id), m);
  }
  if (Array.isArray(r.matches)) for (const m of r.matches) push(m.searchId || (m.search && m.search.id), m);
  if (r.bySearch && typeof r.bySearch === 'object') for (const [sid, list] of Object.entries(r.bySearch)) for (const m of list || []) push(sid, m);
  for (const k of Object.keys(out)) out[k].sort((a, b) => (b.score || 0) - (a.score || 0));
  return out;
}

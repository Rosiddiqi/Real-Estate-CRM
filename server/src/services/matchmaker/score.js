// THE matchmaker scorer — one module for every surface (Listings tiles, the
// Matchmaker tab, listing detail "Interested buyers", client cards, Serena,
// the battle plan). Port of RevMatch's grapevineLogic.scoreContact, re-geared
// to real estate (spec 06 §8.4): a weighted average of "fit to what this buyer
// EXPRESSED" — a factor the buyer never stated is excluded from the
// denominator (null quality), never counted as a miss.
//
//   const { scoreListingForSearch } = require('./score');
//   scoreListingForSearch(listing, search, ctx) →
//     { score, factors, mustHaves, confidence, summary, verifyHold, capped, allConfirmed, gated }
//
// `listing` is a Listing row (or any object with the same field names — an
// owned PortfolioProperty is adapted by toListingShape). `search` is a
// BuyerSearch row. ctx: { includePending, allowOffMarket, hardTypes, hardMarket,
// hardPrice, extraMustHaves, signals, weights } — the three hard gates (type
// family, foreign market, price beyond the soft window) default ON; pass false
// to score through them.
//
// Pure + deterministic (no I/O) so node:test vectors pin the behavior.
const V = require('./vocab');

const MATCH_CONFIG = {
  showThreshold: 80,        // visible everywhere
  fallbackThreshold: 70,    // Whisper falls back to 70–80 when nobody is ≥80
  contactThreshold: 65,     // client-card "home wishlist" surfaces
  hotThreshold: 90,         // Serena / battle-plan "hottest" digest
  storeThreshold: 25,       // persisted Match rows
  weights: {
    market: 16, neighborhood: 20,
    priceRange: 14,
    beds: 10, baths: 5, livingArea: 8, lotSize: 4,
    yearBuilt: 5,
    propertyType: 8,
    style: 5,
    waterfront: 7,
    view: 4,
    mustHaves: 14,
  },
  mustHave: { missingPenalty: 24, metBonus: 5, unknownQuality: 0.7 },
  styleFamilyCredit: 0.6,
  styleMissCredit: 0.22,
};

const LABELS = {
  market: 'Market', neighborhood: 'Neighborhood', priceRange: 'Price', beds: 'Beds', baths: 'Baths',
  livingArea: 'Interior', lotSize: 'Lot', yearBuilt: 'Year built', propertyType: 'Type', style: 'Style',
  waterfront: 'Waterfront', view: 'View', mustHaves: 'Must-haves',
};
// words used in the one-line summary ("Strong on location & price, soft on view")
const SUMMARY_WORD = {
  market: 'location', neighborhood: 'location', priceRange: 'price', beds: 'bedrooms', baths: 'baths',
  livingArea: 'size', lotSize: 'lot', yearBuilt: 'vintage', propertyType: 'type', style: 'style',
  waterfront: 'water', view: 'view', mustHaves: 'must-haves',
};

const BUYABLE = new Set(['active', 'coming_soon']);
const PENDING = new Set(['pending', 'under_contract']);
const PRIVATE_ORIGINS = new Set(['pocket', 'whisper', 'development']);
const DEAD = new Set(['sold', 'withdrawn', 'expired', 'cancelled', 'canceled', 'closed']);

// ── small helpers ─────────────────────────────────────────────────────────
const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const n = (v) => (isNum(v) ? Number(v) : null);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null && String(x).trim() !== '') : []);

function money(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e6) return `$${(x / 1e6).toFixed(x >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)}K`;
  return `$${Math.round(x)}`;
}
const sf = (v) => `${Math.round(Number(v)).toLocaleString('en-US')} sf`;
const acres = (sqft) => {
  const a = Number(sqft) / 43560;
  return `${a >= 10 ? Math.round(a) : a.toFixed(a < 1 ? 2 : 1).replace(/\.?0+$/, '')} ac`;
};

function rangeQ(value, min, max, soft) {
  if (value == null) return null;
  if (min == null && max == null) return null;
  const lo = min == null ? -Infinity : min;
  const hi = max == null ? Infinity : max;
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? lo - value : value - hi;
  if (!soft || soft <= 0) return 0;
  return Math.max(0, 1 - d / soft);
}

function bathsOf(l) {
  if (isNum(l.bathsTotal)) return Number(l.bathsTotal);
  if (isNum(l.baths)) return Number(l.baths);
  if (isNum(l.bathsFull)) return Number(l.bathsFull) + (isNum(l.bathsHalf) ? 0.5 * Number(l.bathsHalf) : 0);
  return null;
}
function lotSqftOf(l) {
  if (isNum(l.lotSqft)) return Number(l.lotSqft);
  if (isNum(l.lotAcres)) return Math.round(Number(l.lotAcres) * 43560);
  return null;
}
function sqftOf(l) {
  if (isNum(l.livingAreaSqft)) return Number(l.livingAreaSqft);
  if (isNum(l.sqft)) return Number(l.sqft);
  return null;
}
function priceOf(l) {
  if (isNum(l.listPrice) && Number(l.listPrice) > 0) return Number(l.listPrice);
  if (isNum(l.priceGuide) && Number(l.priceGuide) > 0) return Number(l.priceGuide);
  if (isNum(l.estValue) && Number(l.estValue) > 0) return Number(l.estValue);
  return null;
}
function monthlyHoa(l) {
  if (!isNum(l.hoaFee) && !isNum(l.hoaMonthly)) return null;
  if (isNum(l.hoaMonthly)) return Number(l.hoaMonthly);
  const fee = Number(l.hoaFee);
  const f = V.lc(l.hoaFrequency);
  if (/year|annual/.test(f)) return Math.round(fee / 12);
  if (/quarter/.test(f)) return Math.round(fee / 3);
  return fee;
}
function typeOf(l) {
  return V.canonicalType(l.propertySubType) || V.canonicalType(l.propertyType);
}
function isDetachedOrLand(l) {
  const t = typeOf(l);
  return !t || V.TYPE_FAMILY[t] === 'detached' || t === 'land';
}

// How much do we trust the listing's amenity list?
//  authoritative: present = met, absent = missing (MLS data, own listing, feature sheet)
//  trusted:       present = met, absent = verify   (agent-entered pocket / new-dev)
//  hearsay:       present = verify, absent = verify (whispers without a feature sheet)
function amenityTrust(l) {
  if (l.hasFeatureSheet || l.isOwnListing) return 'authoritative';
  const o = V.lc(l.origin);
  if (o === 'feed' || o === 'own' || o === 'csv' || o === 'mls') return 'authoritative';
  if (o === 'whisper') return 'hearsay';
  return 'trusted';
}

// ── eligibility (hard gates applied BEFORE scoring) ───────────────────────
function eligibility(l, ctx = {}) {
  const status = V.lc(l.status) || 'active';
  if (l.droppedAt) return 'retired';
  if (DEAD.has(status)) return `status:${status}`;
  if (PENDING.has(status) && !ctx.includePending) return `status:${status}`;
  if (status === 'off_market' && !PRIVATE_ORIGINS.has(V.lc(l.origin)) && !ctx.allowOffMarket) return 'status:off_market';
  return null;
}

// ── factor quality functions ──────────────────────────────────────────────
function marketQ(l, s) {
  const markets = arr(s.markets);
  const hoods = [...arr(s.neighborhoods), ...arr(s.buildings)];
  const hoodHit = hoods.length ? Math.max(
    V.nameSim(l.neighborhood, hoods) || 0,
    V.nameSim(l.buildingName, hoods) || 0,
  ) >= 0.9 : false;
  const hoodDetail = { q: 1, detail: `${l.neighborhood || l.buildingName} is on their list` };
  if (!markets.length) return hoodHit ? hoodDetail : null;
  const places = [l.market, l.city].filter(Boolean); // market-level places only
  if (!places.length) return hoodHit ? hoodDetail : null;
  const placeTokens = [...places, l.neighborhood].filter(Boolean).map((p) => V.nameTokens(p));
  let overlap = false;
  for (const m of markets) {
    const want = V.nameTokens(m);
    if (!want.size) continue;
    for (const have of placeTokens) {
      if (!have.size) continue;
      // equal, or the listing's place is MORE specific than the market they named
      // ("Miami" search ⊇ a "Miami Beach" city) — never the other way round.
      const inter = [...want].filter((x) => have.has(x));
      if (inter.some((x) => !V.WEAK.has(x))) overlap = true;
      if (inter.length === want.size && [...want].some((x) => !V.WEAK.has(x))) {
        return { q: 1, detail: `In ${l.market || l.city}` };
      }
    }
  }
  if (hoodHit) return hoodDetail;
  // "foreign": nothing in common at all (an Aspen search vs a Miami home) → hard gate
  return { q: 0, foreign: !overlap, detail: `Searching ${markets.slice(0, 2).join(' / ')} — not ${l.market || l.city}` };
}

function neighborhoodQ(l, s, ctx) {
  const wants = [...arr(s.neighborhoods), ...arr(s.buildings)];
  let q = null;
  let hit = null;
  if (wants.length) {
    const cands = [l.neighborhood, l.buildingName, l.developmentName, l.city, [l.neighborhood, l.buildingName].filter(Boolean).join(' ')].filter(Boolean);
    for (const c of cands) {
      const sim = V.nameSim(c, wants);
      if (sim != null && (q == null || sim > q)) { q = sim; hit = c; }
    }
  }
  // optional geo: inside radius = 1, linear to 0 at 2× radius
  const geo = (s.criteriaRaw && s.criteriaRaw.geo) || s.geo || null;
  if (geo && isNum(geo.lat) && isNum(geo.lng) && isNum(geo.radiusMi) && isNum(l.lat) && isNum(l.lng)) {
    const d = haversineMi(Number(geo.lat), Number(geo.lng), Number(l.lat), Number(l.lng));
    const r = Number(geo.radiusMi);
    const gq = d <= r ? 1 : Math.max(0, 1 - (d - r) / r);
    if (q == null || gq > q) { q = gq; hit = `${d.toFixed(1)} mi from their pin`; }
  }
  if (q == null) return null;
  const name = l.neighborhood || l.buildingName || l.city || 'this area';
  let detail;
  if (q >= 0.99) detail = `Exact: ${hit && !/mi from/.test(hit) ? (l.buildingName && V.sameName(hit, l.buildingName) ? l.buildingName : name) : name}`;
  else if (q >= 0.5) detail = `Close: wants ${wants[0] || 'their area'}, this is ${name}`;
  else detail = `Different area — wants ${wants.slice(0, 2).join(' / ') || 'another area'}`;
  if (hit && /mi from/.test(hit)) detail = q >= 0.99 ? `Inside their map area` : `${hit}`;
  void ctx;
  return { q, detail };
}

function haversineMi(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function priceQ(l, s) {
  const price = priceOf(l);
  const min = n(s.priceMin); const max = n(s.priceMax);
  if (price == null || (min == null && max == null)) return null;
  const guide = !isNum(l.listPrice) && isNum(l.priceGuide);
  let soft = Math.max(250000, 0.15 * (max || min || 0));
  if (s.budgetFlexible) soft *= 1.5;
  if (guide || (!isNum(l.listPrice) && isNum(l.estValue))) soft *= 1.5; // a guide / estimate is fuzzy
  const q = rangeQ(price, min, max, soft);
  // Beyond the soft window the home is out of the buyer's league (a $30M
  // estate for a $4.5M buyer; a $3M condo for a $12–20M buyer). In cars the
  // make/model factor gated price implicitly; location doesn't, so gate it.
  const off = max != null && price > max ? price - max : min != null && price < min ? min - price : 0;
  const outOfRange = off > soft;
  const label = `${guide ? 'Guide ~' : ''}${money(price)}`;
  const prev = n(l.previousPrice);
  const crossed = prev != null && max != null && prev > max && price <= max;
  let detail;
  if (q === 1) detail = crossed ? `${label} — just dropped into budget (was ${money(prev)})` : `${label} fits budget`;
  else if (min != null && max != null) detail = `${label} vs budget ${money(min)}–${money(max)}`;
  else if (max != null) detail = `${label} vs ≤${money(max)}`;
  else detail = `${label} vs ${money(min)}+`;
  return { q, detail, crossed, outOfRange };
}

function bedsQ(l, s) {
  const want = n(s.bedsMin);
  const have = n(l.beds);
  if (want == null || have == null) return null;
  const q = have >= want ? 1 : have === want - 1 ? 0.5 : 0;
  return { q, detail: q === 1 ? `${have} BR — wants ${want}+` : `${have} BR vs ${want}+ wanted` };
}

function bathsQ(l, s) {
  const want = n(s.bathsMin);
  const have = bathsOf(l);
  if (want == null || have == null) return null;
  const q = rangeQ(have, want, null, 1.5);
  return { q, detail: q === 1 ? `${have} BA — wants ${want}+` : `${have} BA vs ${want}+ wanted` };
}

function areaQ(l, s) {
  const min = n(s.sqftMin); const max = n(s.sqftMax);
  const have = sqftOf(l);
  if (have == null || (min == null && max == null)) return null;
  const q = rangeQ(have, min, max, 0.2 * (min || max));
  const want = min != null && max != null ? `${sf(min)}–${sf(max)}` : min != null ? `≥${sf(min)}` : `≤${sf(max)}`;
  return { q, detail: q === 1 ? `${sf(have)} fits ${want}` : `${sf(have)} vs ${want}` };
}

function lotQ(l, s) {
  const min = n(s.lotSqftMin);
  const have = lotSqftOf(l);
  if (min == null || have == null || !isDetachedOrLand(l)) return null;
  const q = rangeQ(have, min, null, 0.25 * min);
  return { q, detail: q === 1 ? `${acres(have)} lot — wants ${acres(min)}+` : `${acres(have)} lot vs ${acres(min)}+` };
}

function yearQ(l, s) {
  const min = n(s.yearBuiltMin); const max = n(s.yearBuiltMax);
  const built = n(l.yearBuilt);
  const reno = n(l.yearRenovated);
  if (built == null && reno == null) return null;
  if (min == null && max == null) return null;
  const eff = Math.max(built || 0, reno || 0);
  const q = rangeQ(eff, min, max, 10);
  const what = reno && reno > (built || 0) ? `Renovated ${reno}` : `Built ${eff}`;
  const want = min != null && max != null ? `${min}–${max}` : min != null ? `${min}+` : `≤${max}`;
  return { q, detail: q === 1 ? `${what} (${want})` : `${what} vs ${want}` };
}

function typeQ(l, s) {
  const wants = arr(s.propertyTypes).map(V.canonicalType).filter(Boolean);
  const have = typeOf(l);
  if (!wants.length || !have) return null;
  let q = 0; let best = wants[0];
  for (const w of wants) {
    const c = V.typeCompat(w, have) || 0;
    if (c > q) { q = c; best = w; }
  }
  const detail = q >= 0.999 ? `${V.typeLabel(have)} — as wanted`
    : q >= 0.5 ? `${V.typeLabel(have)} — close to ${V.typeLabel(best).toLowerCase()}`
      : `${V.typeLabel(have)} — wants ${wants.map((w) => V.typeLabel(w).toLowerCase()).join(' / ')}`;
  return { q, detail, hard: q === 0 };
}

function styleQ(l, s) {
  const wants = arr(s.styles);
  if (!wants.length) return null;
  const name = l.architecturalStyle || '';
  const fam = V.styleFamily(l.styleFamily) || V.styleFamily(name);
  if (!name && !fam) return null;
  if (name && wants.some((w) => V.squash(w) === V.squash(name))) return { q: 1, detail: `${name} — exact style` };
  const wantFams = new Set(wants.map(V.styleFamily).filter(Boolean));
  if (fam && wantFams.has(fam)) {
    // a family word itself ("Modern") wanted and the listing is in that family = exact
    if (wants.some((w) => V.squash(w) === fam || V.squash(w) === V.squash(V.FAMILY_LABEL[fam]))) return { q: 1, detail: `${name || V.FAMILY_LABEL[fam]} — ${V.FAMILY_LABEL[fam].toLowerCase()} as wanted` };
    return { q: MATCH_CONFIG.styleFamilyCredit, detail: `${name || V.FAMILY_LABEL[fam]} is in their ${V.FAMILY_LABEL[fam]} family` };
  }
  return { q: MATCH_CONFIG.styleMissCredit, detail: `${name || V.FAMILY_LABEL[fam] || 'This style'} isn't their stated style` };
}

function waterfrontQ(l, s) {
  const wants = arr(s.waterfront).map(V.canonicalWaterfront).filter(Boolean);
  if (!wants.length) return null;
  const have = V.canonicalWaterfront(l.waterfront) || 'none';
  const onWater = have !== 'none' && have !== 'any' ? true : have === 'any';
  if (wants.includes('none') && wants.length === 1) {
    return onWater ? { q: 0.5, detail: `${V.WATERFRONT_LABEL[have]} — they didn't ask for water` } : { q: 1, detail: 'Off the water, as wanted' };
  }
  if (wants.includes('any')) {
    return onWater ? { q: 1, detail: `${V.WATERFRONT_LABEL[have]} — on the water` } : { q: 0, detail: 'Not on the water' };
  }
  if (wants.includes(have)) return { q: 1, detail: `${V.WATERFRONT_LABEL[have]} as wanted` };
  if (!onWater) return { q: 0, detail: `Not on the water — wants ${V.WATERFRONT_LABEL[wants[0]].toLowerCase()}` };
  const partial = wants.some((w) => V.NAVIGABLE.has(w)) && V.NAVIGABLE.has(have) ? 0.5 : 0.3;
  return { q: partial, detail: `${V.WATERFRONT_LABEL[have]} — wants ${V.WATERFRONT_LABEL[wants[0]].toLowerCase()}` };
}

function viewQ(l, s) {
  const wants = arr(s.views).map(V.canonicalView).filter(Boolean);
  if (!wants.length) return null;
  const have = arr(l.views).map(V.canonicalView).filter(Boolean);
  const label = (k) => `${k.charAt(0).toUpperCase()}${k.slice(1)} view`;
  const hit = have.find((v) => wants.includes(v) || (wants.includes('water') && V.WATER_VIEWS.has(v)));
  if (hit) return { q: 1, detail: label(hit) };
  if (have.includes('water') && wants.some((w) => V.WATER_VIEWS.has(w))) return { q: 0.5, detail: `Water view — wants ${wants[0]}` };
  if (!have.length) return { q: 0, detail: `No ${wants[0]} view listed` };
  return { q: 0, detail: `${label(have[0])} — wants ${wants[0]}` };
}

// ── must-haves (tri-state) ────────────────────────────────────────────────
// Hearsay (a whisper without a feature sheet) can CONTRADICT a must-have —
// "the dock is 60 ft" is worth knowing — but never confirm one: every "met"
// becomes "verify", so a whisper tops out at 99* until the specs are seen.
function evalMustHave(mh, l, trust, amenitySet) {
  const r = evalMustHaveRaw(mh, l, trust, amenitySet);
  if (trust === 'hearsay' && r.status === 'met') return { status: 'verify', detail: `${r.detail} — heard, verify` };
  return r;
}

function evalMustHaveRaw(mh, l, trust, amenitySet) {
  const flags = (l.amenityFlags && typeof l.amenityFlags === 'object') ? l.amenityFlags : {};
  const flag = (k) => (Object.prototype.hasOwnProperty.call(flags, k) ? flags[k] : undefined);
  const out = (status, detail) => ({ status, detail });
  switch (mh.key) {
    case 'dock_length': {
      if (flag('dock') === false && trust !== 'hearsay') return out('missing', 'No dock');
      const ft = n(l.dockLengthFt);
      if (ft != null) return ft >= mh.min ? out('met', `${ft}-ft dock`) : out('missing', `${ft}-ft dock (needs ${mh.min})`);
      return out('verify', `Dock length unknown (needs ${mh.min} ft)`);
    }
    case 'frontage': {
      const ft = n(l.waterFrontageFt);
      if (ft != null) return ft >= mh.min ? out('met', `${ft} ft frontage`) : out('missing', `${ft} ft frontage (needs ${mh.min})`);
      return out('verify', 'Frontage unknown');
    }
    case 'lot': {
      const have = lotSqftOf(l);
      if (have != null) return have >= mh.min ? out('met', `${acres(have)} lot`) : out('missing', `${acres(have)} lot (needs ${acres(mh.min)})`);
      return out('verify', 'Lot size unknown');
    }
    case 'hoa': {
      const fee = monthlyHoa(l);
      if (fee != null) return fee <= mh.max ? out('met', fee === 0 ? 'No HOA' : `HOA $${fee.toLocaleString('en-US')}/mo`) : out('missing', `HOA $${fee.toLocaleString('en-US')}/mo`);
      const t = typeOf(l);
      if (mh.max === 0 && t && V.TYPE_FAMILY[t] === 'attached') return out('missing', 'Condo association');
      return out('verify', 'HOA unknown');
    }
    case 'garage_spaces': {
      const g = n(l.garageSpaces);
      if (g != null) return g >= mh.min ? out('met', `${g}-car garage`) : out('missing', `${g}-car garage (needs ${mh.min})`);
      return out('verify', 'Garage size unknown');
    }
    case 'stories': {
      const st = n(l.stories);
      if (st != null) return st <= mh.max ? out('met', 'Single-story') : out('missing', `${st} stories`);
      const t = typeOf(l);
      if (t && V.TYPE_FAMILY[t] === 'attached') return out('met', 'Single-level residence');
      return out('verify', 'Stories unknown');
    }
    case 'view': {
      const have = arr(l.views).map(V.canonicalView);
      if (have.includes(mh.value) || (mh.value === 'water' && have.some((v) => V.WATER_VIEWS.has(v)))) return out('met', `${mh.value} view`);
      return have.length ? out('missing', `No ${mh.value} view`) : out('verify', 'Views not listed');
    }
    case 'waterfront': {
      const have = V.canonicalWaterfront(l.waterfront) || null;
      if (!have) return out('verify', 'Waterfront unknown');
      if (have === 'none') return out('missing', 'Not on the water');
      if (mh.value === 'any' || mh.value === have) return out('met', V.WATERFRONT_LABEL[have]);
      return out('missing', `${V.WATERFRONT_LABEL[have]} (wants ${V.WATERFRONT_LABEL[mh.value] || mh.value})`);
    }
    case 'floor': {
      const fl = n(l.floor);
      if (fl != null) return fl >= mh.min ? out('met', `Floor ${fl}`) : out('missing', `Floor ${fl} (wants ${mh.min}+)`);
      return out('verify', 'Floor unknown');
    }
    case 'new_construction': {
      const yb = n(l.yearBuilt);
      const now = new Date().getFullYear();
      if (yb != null) return yb >= now - 1 ? out('met', `Built ${yb}`) : out('missing', `Built ${yb}`);
      return V.lc(l.origin) === 'development' ? out('met', 'New development') : out('verify', 'Year unknown');
    }
    case 'no_hoa':
      return evalMustHave({ ...mh, key: 'hoa', max: 0 }, l, trust, amenitySet);
    case 'waterfront_any':
      return evalMustHave({ ...mh, key: 'waterfront', value: 'any' }, l, trust, amenitySet);
    default: break;
  }
  if (!mh.key) {
    // un-canonical must-have: a phrase match in the amenities / remarks can
    // confirm it; its absence never proves it's missing → verify.
    const hay = V.squash([...(l.amenities || []), l.description || '', l.headline || ''].join(' | '));
    const f = V.squash(mh.feature);
    const label = V.mustHaveLabel(mh);
    if (f && hay && mh.min == null && mh.max == null && V.hasPhrase(hay, f)) return out(trust === 'hearsay' ? 'verify' : 'met', label);
    return out('verify', `${label} — confirm`);
  }
  const f = flag(mh.key);
  if (f === true) return out('met', V.amenityLabel(mh.key));
  if (f === false) {
    // on hearsay an unmentioned amenity is just unknown
    return trust === 'hearsay' ? out('verify', `${V.amenityLabel(mh.key)} — confirm`) : out('missing', `No ${V.amenityLabel(mh.key).toLowerCase()}`);
  }
  // structural signals that confirm an amenity without a list entry
  if (mh.key === 'dock' && n(l.dockLengthFt) > 0) return out('met', `${n(l.dockLengthFt)}-ft dock`);
  if (mh.key === 'garage' && n(l.garageSpaces) > 0) return out('met', `${n(l.garageSpaces)}-car garage`);
  if (mh.key === 'waterfront') return evalMustHave({ ...mh, key: 'waterfront', value: 'any' }, l, trust, amenitySet);
  const present = amenitySet.has(mh.key);
  if (present) return out(trust === 'hearsay' ? 'verify' : 'met', V.amenityLabel(mh.key));
  const provable = trust === 'authoritative' && (V.STRUCTURED.has(mh.key) || l.hasFeatureSheet);
  return out(provable ? 'missing' : 'verify', provable ? `No ${V.amenityLabel(mh.key).toLowerCase()}` : `${V.amenityLabel(mh.key)} — confirm`);
}

// Deal-breakers are negated must-haves: only a CLEAR violation counts.
function evalDealBreaker(text, l, amenitySet) {
  const t = V.squash(text);
  if (!t) return null;
  // "HOA", "high HOA", "condo fees"
  if (/\bhoa\b|association|condo fees?/.test(t)) {
    const fee = monthlyHoa(l);
    if (fee != null && fee > 0) return { violated: true, detail: `HOA $${fee.toLocaleString('en-US')}/mo` };
    return null;
  }
  const type = V.canonicalType(t);
  const have = typeOf(l);
  if (type && have && (type === have || (type === 'condo' && V.TYPE_FAMILY[have] === 'attached'))) {
    return { violated: true, detail: V.typeLabel(have) };
  }
  if (/high ?rise|tower/.test(t) && have && V.TYPE_FAMILY[have] === 'attached' && (n(l.floor) || 0) >= 6) return { violated: true, detail: 'High-rise' };
  const fam = V.styleFamily(t);
  const lfam = V.styleFamily(l.styleFamily) || V.styleFamily(l.architecturalStyle);
  if (fam && lfam && fam === lfam) return { violated: true, detail: l.architecturalStyle || V.FAMILY_LABEL[fam] };
  if (/(two|2|multi|three|3)[ -]?(story|stories|level)|stairs/.test(t) && (n(l.stories) || 0) >= 2) return { violated: true, detail: `${n(l.stories)} stories` };
  if (/flood ?zone/.test(t) && /flood zone (ae|ve|a)\b/.test(V.squash(l.description))) return { violated: true, detail: 'Flood zone' };
  let m;
  if ((m = /(?:dock|slip)\D{0,16}(?:under|less than|shorter than|below|<)\s*(\d{2,3})/.exec(t))) {
    const ft = n(l.dockLengthFt);
    return ft != null && ft < Number(m[1]) ? { violated: true, detail: `${ft}-ft dock` } : null;
  }
  if (/\d/.test(t)) return null; // other numeric deal-breakers aren't machine-checkable
  const key = V.normalizeAmenityStrict(t);
  if (key) {
    const flags = l.amenityFlags || {};
    if (flags[key] === true || amenitySet.has(key)) return { violated: true, detail: V.amenityLabel(key) };
    return null;
  }
  const hay = V.squash([...(l.amenities || []), l.description || '', l.architecturalStyle || '', l.propertyType || ''].join(' | '));
  if (t.length >= 4 && V.hasPhrase(hay, t)) return { violated: true, detail: text };
  return null;
}

function normalizeMustHaves(search, extra) {
  const list = [];
  const seen = new Set();
  const push = (mh) => {
    // free-text compounds ("Gated + staff quarters") become separate must-haves
    if (typeof mh === 'string' && /[+&,;]|\bwith\b|\band\b/i.test(mh)) {
      for (const part of V.splitCompound(mh)) push(part);
      return;
    }
    const p = V.parseMustHave(mh);
    if (!p || !p.feature) return;
    if (!V.fairHousingSafe(p.feature)) return; // never score protected-class proxies
    const k = p.key ? `${p.key}:${p.min ?? ''}:${p.max ?? ''}:${p.value ?? ''}` : `txt:${V.squash(p.feature)}`;
    if (seen.has(k)) return;
    seen.add(k);
    list.push(p);
  };
  const raw = Array.isArray(search.mustHaves) ? search.mustHaves : [];
  raw.forEach(push);
  (extra || []).forEach(push);
  return list;
}

// ── the scorer ────────────────────────────────────────────────────────────
function scoreListingForSearch(listing, search, ctx = {}) {
  const l = listing || {};
  const s = search || {};
  const W = { ...MATCH_CONFIG.weights, ...(ctx.weights || {}) };

  const gate = eligibility(l, ctx);
  if (gate) return gated(gate);

  const factors = [];
  let wsum = 0; let qsum = 0;
  const add = (key, quality, detail, extra) => {
    const weight = W[key];
    if (quality == null || !(weight > 0)) return;
    const q = Math.max(0, Math.min(1, quality));
    wsum += weight; qsum += weight * q;
    const polarity = q >= 0.85 ? 'match' : q >= 0.5 ? 'partial' : 'gap';
    factors.push({ key, label: LABELS[key], weight, quality: Math.round(q * 1000) / 1000, polarity, detail, ...(extra || {}) });
  };

  const mk = marketQ(l, s);
  if (mk && mk.foreign && ctx.hardMarket !== false) return gated('market', mk.detail);
  if (mk) add('market', mk.q, mk.detail);
  const nb = neighborhoodQ(l, s, ctx); if (nb) add('neighborhood', nb.q, nb.detail);
  const pr = priceQ(l, s);
  if (pr && pr.outOfRange && ctx.hardPrice !== false) return gated('price', pr.detail);
  if (pr) add('priceRange', pr.q, pr.detail, pr.crossed ? { crossedBudget: true } : null);
  const bd = bedsQ(l, s); if (bd) add('beds', bd.q, bd.detail);
  const ba = bathsQ(l, s); if (ba) add('baths', ba.q, ba.detail);
  const ar = areaQ(l, s); if (ar) add('livingArea', ar.q, ar.detail);
  const lt = lotQ(l, s); if (lt) add('lotSize', lt.q, lt.detail);
  const yb = yearQ(l, s); if (yb) add('yearBuilt', yb.q, yb.detail);
  const ty = typeQ(l, s);
  if (ty) {
    if (ty.hard && ctx.hardTypes !== false) return gated('type', ty.detail);
    add('propertyType', ty.q, ty.detail);
  }
  const st = styleQ(l, s); if (st) add('style', st.q, st.detail);
  const wf = waterfrontQ(l, s); if (wf) add('waterfront', wf.q, wf.detail);
  const vw = viewQ(l, s); if (vw) add('view', vw.q, vw.detail);

  // must-haves + deal-breakers
  const trust = amenityTrust(l);
  const amenitySet = V.amenityKeys(l.amenities);
  const mhList = normalizeMustHaves(s, ctx.extraMustHaves);
  const mustHaves = [];
  let mustPenalty = 0; let mustBonus = 0; let mq = 0;
  for (const mh of mhList) {
    const r = evalMustHave(mh, l, trust, amenitySet);
    const imp = mh.importance == null ? 1 : mh.importance;
    let q;
    if (r.status === 'met') { q = 1; mustBonus += MATCH_CONFIG.mustHave.metBonus * imp; }
    else if (r.status === 'missing') { q = 0; mustPenalty += MATCH_CONFIG.mustHave.missingPenalty * imp; }
    else q = MATCH_CONFIG.mustHave.unknownQuality;
    mq += q;
    mustHaves.push({ feature: V.mustHaveLabel(mh), key: mh.key || null, importance: imp, source: mh.source || 'search', status: r.status, detail: r.detail });
  }
  for (const db of arr(s.dealBreakers)) {
    const r = evalDealBreaker(db, l, amenitySet);
    if (r && r.violated) {
      mustPenalty += MATCH_CONFIG.mustHave.missingPenalty;
      mustHaves.push({ feature: `No ${db}`.replace(/^No no /i, 'No '), key: null, importance: 1, source: 'deal_breaker', status: 'missing', dealBreaker: true, detail: `Deal-breaker: ${r.detail}` });
    }
  }
  if (mustHaves.length) {
    mq /= mustHaves.length; // deal-breaker rows count as q 0
    const missing = mustHaves.filter((m) => m.status === 'missing');
    const verify = mustHaves.filter((m) => m.status === 'verify');
    const detail = missing.length
      ? `Missing ${missing.map((m) => (m.dealBreaker ? m.detail.replace(/^Deal-breaker: /, '') : m.feature)).join(', ')}`
      : verify.length
        ? `${verify.map((m) => m.feature).join(', ')} — verify on the feature sheet`
        : `Has ${mustHaves.map((m) => m.feature).join(', ')}`;
    add('mustHaves', mq, detail);
  }

  let score = wsum ? (qsum / wsum) * 100 : 0;
  score = score + mustBonus - mustPenalty;
  score = Math.max(1, Math.min(100, Math.round(score)));
  if (!wsum) score = Math.min(score, 50); // nothing expressed → never a "hot" match

  // 100-cap (HARD RULE): 100 only for a fully VERIFIED match — and hearsay
  // (a whisper's specs) is never verified.
  const hearsay = trust === 'hearsay';
  const allConfirmed = !hearsay && factors.length > 0 && factors.every((f) => f.quality >= 0.999) && mustHaves.every((m) => m.status === 'met');
  if (!allConfirmed) score = Math.min(score, 99);
  const verifyHold = !allConfirmed && (hearsay || mustHaves.some((m) => m.status === 'verify'))
    && !mustHaves.some((m) => m.status === 'missing') && factors.every((f) => f.key === 'mustHaves' || f.quality >= 0.999);

  const sigKinds = new Set((ctx.signals || []).map((x) => x.kind));
  const confidence = (hearsay || mustHaves.some((m) => m.status === 'verify')) ? 'needs verification'
    : (factors.length >= 6 || sigKinds.size >= 3) ? 'high' : 'medium';

  factors.sort((a, b) => (b.weight * b.quality) - (a.weight * a.quality));
  const strong = [];
  for (const f of factors) {
    if (f.polarity !== 'match') continue;
    const w = SUMMARY_WORD[f.key];
    if (!strong.includes(w)) strong.push(w);
    if (strong.length === 2) break;
  }
  const soft = [];
  for (const f of [...factors].reverse()) {
    if (f.polarity === 'match') continue;
    const w = SUMMARY_WORD[f.key];
    if (!strong.includes(w) && !soft.includes(w)) soft.push(w);
    if (soft.length === 1) break;
  }
  let summary = strong.length ? `Strong on ${strong.join(' & ')}` : 'Partial match';
  if (soft.length) summary += `, soft on ${soft[0]}`;
  if (pr && pr.crossed) summary = `Just dropped into budget · ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;

  return {
    score,
    factors,
    mustHaves,
    confidence,
    summary,
    verifyHold,
    capped: !allConfirmed,
    allConfirmed,
    crossedBudget: !!(pr && pr.crossed),
    gated: null,
  };
}

function gated(reason, detail) {
  return {
    score: 0, factors: [], mustHaves: [], confidence: 'n/a',
    summary: detail ? `Not a fit: ${detail}` : `Not eligible (${reason})`,
    verifyHold: false, capped: true, allConfirmed: false, crossedBudget: false, gated: reason,
  };
}

// Rank already-scored candidates for one subject (RM rankContacts):
// shown ≥80, falling back to 70–80 when nobody clears 80 (Whisper).
function rankScored(scored, { threshold, fallback = false } = {}) {
  const list = [...scored].sort((a, b) => b.result.score - a.result.score || (b.priority || 0) - (a.priority || 0));
  let t = Number.isFinite(threshold) ? threshold : MATCH_CONFIG.showThreshold;
  let usedFallback = false;
  if (fallback && !list.some((x) => x.result.score >= t)) {
    if (list.some((x) => x.result.score >= MATCH_CONFIG.fallbackThreshold)) { t = MATCH_CONFIG.fallbackThreshold; usedFallback = true; }
  }
  return { shown: list.filter((x) => x.result.score >= t), hidden: list.filter((x) => x.result.score < t), threshold: t, fallback: usedFallback, total: list.length };
}

module.exports = {
  MATCH_CONFIG,
  scoreListingForSearch,
  rankScored,
  // convenience re-export for consumers that only require('./score') — lazy so
  // this module stays pure (no DB) at load time.
  getRecentMatches: (opts) => require('./index').getRecentMatches(opts),
  eligibility,
  // helpers reused by the engine / UI shapers
  priceOf, bathsOf, sqftOf, lotSqftOf, typeOf, monthlyHoa, money, rangeQ, amenityTrust,
};

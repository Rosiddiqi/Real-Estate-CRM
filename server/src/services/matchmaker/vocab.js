// Canonical real-estate vocabularies for the matchmaker (pure, no deps — the
// scorer and every parser share these so "boat dock", "deepwater dockage" and
// "private dock" all mean the same thing).
//
//   normalizeAmenity('Deep-water dock')   → 'dock'
//   canonicalType('Single Family Home')   → 'single_family'
//   styleFamily('Tuscan')                 → 'mediterranean'
//   nameTokens('Bal Harbor Shops')        → Set{bal, harbour, shops}
//   parseMustHave('dock for a 70-ft boat') → {key:'dock_length', min:70, ...}

const lc = (s) => String(s == null ? '' : s).toLowerCase().trim();
const squash = (s) => lc(s).replace(/[_\-./,&()]+/g, ' ').replace(/['’]/g, '').replace(/\s+/g, ' ').trim();

// ── Amenities ─────────────────────────────────────────────────────────────
// key → { label, syn: phrases (lowercase, matched on word boundaries) }
const AMENITIES = {
  pool: { label: 'Pool', syn: ['pool', 'swimming pool', 'heated pool', 'infinity pool', 'saltwater pool', 'salt water pool', 'lap pool', 'private pool', 'plunge pool', 'resort pool', 'resort style pool', 'rooftop pool'] },
  dock: { label: 'Dock', syn: ['dock', 'boat dock', 'private dock', 'dockage', 'deepwater dock', 'deep water dock', 'boat slip', 'yacht dock', 'mooring', 'marina slip', 'deeded slip', 'slip'] },
  boat_lift: { label: 'Boat lift', syn: ['boat lift', 'boatlift', 'jet ski lift', 'davits', 'davit'] },
  gated: { label: 'Gated', syn: ['gated', 'gated community', 'guard gated', 'guard-gated', 'gated entry', 'gated estate', 'security gate', 'guarded', '24/7 security', '24 hour security', '24-hour security', 'manned gate'] },
  elevator: { label: 'Elevator', syn: ['elevator', 'private elevator', 'home elevator', 'elevator foyer', 'private elevator foyer'] },
  guest_house: { label: 'Guest house', syn: ['guest house', 'guesthouse', 'casita', 'guest cottage', 'carriage house', 'guest quarters', 'detached guest'] },
  wine_room: { label: 'Wine room', syn: ['wine room', 'wine cellar', 'wine storage', 'wine cave', 'wine wall', 'wine vault', 'wine tasting room'] },
  generator: { label: 'Generator', syn: ['generator', 'whole house generator', 'whole-house generator', 'whole home generator', 'backup generator', 'full house generator'] },
  smart_home: { label: 'Smart home', syn: ['smart home', 'home automation', 'crestron', 'savant', 'control4', 'lutron', 'automated home'] },
  theater: { label: 'Home theater', syn: ['home theater', 'home theatre', 'theater', 'theatre', 'cinema', 'media room', 'screening room'] },
  gym: { label: 'Gym', syn: ['gym', 'home gym', 'fitness', 'fitness center', 'fitness room', 'exercise room', 'fitness studio'] },
  spa: { label: 'Spa', syn: ['spa', 'sauna', 'steam room', 'steam shower', 'hot tub', 'jacuzzi', 'whirlpool', 'cold plunge', 'wellness center'] },
  tennis: { label: 'Tennis court', syn: ['tennis', 'tennis court', 'pickleball', 'pickleball court', 'sport court', 'basketball court'] },
  beach_access: { label: 'Beach access', syn: ['beach access', 'private beach', 'beach club', 'direct beach access', 'deeded beach', 'beach service'] },
  impact_windows: { label: 'Impact windows', syn: ['impact windows', 'impact glass', 'hurricane windows', 'hurricane impact', 'impact doors', 'impact rated'] },
  outdoor_kitchen: { label: 'Summer kitchen', syn: ['summer kitchen', 'outdoor kitchen', 'outdoor grill', 'bbq area'] },
  office: { label: 'Home office', syn: ['home office', 'office', 'study', 'library', 'den'] },
  staff_quarters: { label: 'Staff quarters', syn: ['staff quarters', 'staff suite', 'staff apartment', 'maids quarters', 'maid quarters', 'housekeeper suite', 'service quarters'] },
  concierge: { label: 'Concierge', syn: ['concierge', 'doorman', 'full service', 'full-service', 'valet', '24 hour concierge', 'white glove'] },
  rooftop: { label: 'Rooftop terrace', syn: ['rooftop', 'roof deck', 'rooftop terrace', 'roof terrace', 'rooftop deck'] },
  garage: { label: 'Garage', syn: ['garage', 'car garage', 'garages', 'auto gallery', 'car gallery'] },
  single_story: { label: 'Single-story', syn: ['single story', 'single-story', 'one story', 'one-story', 'single level', 'single-level', 'one level', 'all on one level'] },
  fireplace: { label: 'Fireplace', syn: ['fireplace', 'fire place', 'fireplaces'] },
  golf: { label: 'Golf course', syn: ['golf course', 'golf membership', 'golf club', 'golf community', 'on the golf course'] },
  equestrian: { label: 'Equestrian', syn: ['equestrian', 'barn', 'stable', 'stables', 'paddock', 'riding arena', 'horse property'] },
  solar: { label: 'Solar', syn: ['solar', 'solar panels', 'solar power'] },
  ev_charging: { label: 'EV charging', syn: ['ev charger', 'ev charging', 'electric vehicle charging', 'tesla charger', 'car charger'] },
  pet_friendly: { label: 'Pet friendly', syn: ['pet friendly', 'pet-friendly', 'pets allowed', 'dogs allowed', 'allows pets', 'allows dogs'] },
  chef_kitchen: { label: "Chef's kitchen", syn: ['chefs kitchen', 'chef kitchen', 'gourmet kitchen', 'catering kitchen', 'scullery'] },
  walk_in_closet: { label: 'Walk-in closets', syn: ['walk in closet', 'walk-in closet', 'walk in closets', 'dressing room', 'his and hers closets'] },
  high_ceilings: { label: 'High ceilings', syn: ['high ceilings', 'double height', 'double-height', 'soaring ceilings', 'vaulted ceilings', '12 ft ceilings', '14 ft ceilings'] },
  privacy: { label: 'Privacy', syn: ['privacy', 'secluded', 'private setting', 'hedged'] },
  new_construction: { label: 'New construction', syn: ['new construction', 'brand new', 'never lived in', 'new build', 'never occupied'] },
  no_hoa: { label: 'No HOA', syn: ['no hoa', 'no association', 'no hoa fees', 'no condo fees'] },
  waterfront: { label: 'Waterfront', syn: ['waterfront', 'on the water', 'water frontage', 'waterfront lot'] },
};

// Phrase index (longest phrases first so "boat lift" wins over "lift").
const AMENITY_PHRASES = Object.entries(AMENITIES)
  .flatMap(([key, a]) => a.syn.map((p) => [squash(p), key]))
  .sort((a, b) => b[0].length - a[0].length);

function hasPhrase(hay, phrase) {
  if (!hay || !phrase) return false;
  const re = new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
  return re.test(hay);
}

// Free text → canonical amenity key (or null).
function normalizeAmenity(text) {
  const t = squash(text);
  if (!t) return null;
  if (AMENITIES[t.replace(/ /g, '_')]) return t.replace(/ /g, '_');
  // "no HOA" before "hoa"-free phrases; boat lift before lift, etc.
  for (const [phrase, key] of AMENITY_PHRASES) if (hasPhrase(t, phrase)) return key;
  return null;
}

function amenityLabel(key) {
  return (AMENITIES[key] && AMENITIES[key].label) || String(key || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// All canonical keys present in a free-text list (amenities[] / description).
function amenityKeys(list) {
  const out = new Set();
  for (const item of [].concat(list || [])) {
    const t = squash(item);
    if (!t) continue;
    const direct = t.replace(/ /g, '_');
    if (AMENITIES[direct]) { out.add(direct); continue; }
    for (const [phrase, key] of AMENITY_PHRASES) if (hasPhrase(t, phrase)) out.add(key);
  }
  // "boat lift" text also mentions a dock in practice, but a dock is not
  // implied by a lift — keep them independent. "no hoa" must not add 'hoa'.
  return out;
}

// ── Must-have parsing (numeric thresholds) ────────────────────────────────
//   "dock for a 70-ft boat" → {key:'dock_length', min:70, unit:'ft'}
//   "at least 1 acre"       → {key:'lot', min:43560}
//   "no HOA" / "HOA under $3K" → {key:'hoa', max:0 | 3000}
//   "4-car garage"          → {key:'garage_spaces', min:4}
//   "100 ft of frontage"    → {key:'frontage', min:100}
//   "single story"          → {key:'stories', max:1}
const num = (s) => Number(String(s).replace(/,/g, ''));

function parseMustHave(input) {
  const raw = typeof input === 'string' ? { feature: input } : { ...(input || {}) };
  const feature = String(raw.feature || raw.name || raw.label || '').trim();
  const t = squash(feature);
  const importance = Number.isFinite(Number(raw.importance)) ? Math.max(0, Math.min(1.2, Number(raw.importance))) : 1;
  const base = { feature, importance, source: raw.source || 'search' };
  if (!feature) return null;

  // explicit structured thresholds win
  if (raw.key && (raw.min != null || raw.max != null)) return { ...base, key: raw.key, min: raw.min ?? null, max: raw.max ?? null };

  let m;
  // dock length / boat size
  if ((m = /(\d{2,3})\s*(?:ft|foot|feet|')\s*(?:\w+\s){0,3}?(?:boat|yacht|dock|vessel|slip)/.exec(t))
    || (m = /(?:dock|slip|boat|yacht)\D{0,24}?(\d{2,3})\s*(?:ft|foot|feet|')/.exec(t))) {
    return { ...base, key: 'dock_length', min: num(m[1]) };
  }
  // water frontage
  if ((m = /(\d{2,4})\s*(?:ft|foot|feet|')\s*(?:of\s+)?(?:water\s*)?frontage/.exec(t))) {
    return { ...base, key: 'frontage', min: num(m[1]) };
  }
  // lot size in acres
  if ((m = /(\d+(?:\.\d+)?)\s*\+?\s*(?:acre|acres|ac)\b/.exec(t))) {
    return { ...base, key: 'lot', min: Math.round(num(m[1]) * 43560) };
  }
  if ((m = /(\d[\d,]{3,})\s*(?:sq ft|sqft|sf|square feet)\s*lot/.exec(t))) {
    return { ...base, key: 'lot', min: num(m[1]) };
  }
  // HOA cap
  if (/\bno (?:hoa|association|condo fees?)\b/.test(t)) return { ...base, key: 'hoa', max: 0 };
  if ((m = /hoa\D{0,20}?\$?\s*(\d+(?:\.\d+)?)\s*(k)?/.exec(t)) && /(under|below|less|max|cap|<|≤|up to|no more)/.test(t)) {
    return { ...base, key: 'hoa', max: Math.round(num(m[1]) * (m[2] ? 1000 : 1)) };
  }
  // garage spaces
  if ((m = /(\d)\s*\+?\s*car\s+(?:garage|gallery)/.exec(t)) || (m = /garage\D{0,12}(\d)\s*\+?\s*cars?/.exec(t))) {
    return { ...base, key: 'garage_spaces', min: num(m[1]) };
  }
  // single story
  if (/\b(single|one)[ -]?(story|level|storey)\b/.test(t)) return { ...base, key: 'stories', max: 1 };
  // view as a must-have ("ocean view", "must see the water")
  const vk = viewKeyFromText(t);
  if (vk && /\bview|views|see the\b/.test(t)) return { ...base, key: 'view', value: vk };
  // waterfront type as a must-have
  const wf = canonicalWaterfront(t);
  if (wf && wf !== 'none' && /front|on the|water/.test(t)) return { ...base, key: 'waterfront', value: wf };

  const key = normalizeAmenity(feature);
  return { ...base, key: key || null };
}

// ── Property types ────────────────────────────────────────────────────────
const TYPE_SYN = [
  ['penthouse', ['penthouse', 'ph', 'sky villa', 'sky home']],
  ['co_op', ['co op', 'coop', 'co-op', 'cooperative']],
  ['townhouse', ['townhouse', 'townhome', 'town house', 'town home', 'row house', 'rowhouse', 'brownstone']],
  ['villa', ['villa']],
  ['estate', ['estate', 'compound', 'mansion', 'manor']],
  ['land', ['land', 'lot', 'vacant land', 'vacant lot', 'acreage', 'parcel', 'teardown', 'buildable lot']],
  ['condo', ['condo', 'condominium', 'apartment', 'flat', 'residence in a building', 'high rise', 'highrise', 'loft']],
  ['single_family', ['single family', 'single-family', 'single family home', 'sfh', 'sfr', 'house', 'home', 'detached', 'residence']],
];
const TYPE_KEYS = new Set(['single_family', 'condo', 'townhouse', 'estate', 'penthouse', 'villa', 'land', 'co_op']);

function canonicalType(text) {
  const t = squash(text).replace(/ /g, '_');
  if (TYPE_KEYS.has(t)) return t;
  const s = squash(text);
  if (!s) return null;
  for (const [key, syns] of TYPE_SYN) for (const p of syns) if (hasPhrase(s, squash(p))) return key;
  return null;
}

const TYPE_FAMILY = { single_family: 'detached', estate: 'detached', villa: 'detached', condo: 'attached', penthouse: 'attached', co_op: 'attached', townhouse: 'town', land: 'land' };
// compat[want][have] — 1 = what they asked for; 0 = a different kind of home.
const TYPE_COMPAT = {
  single_family: { single_family: 1, estate: 1, villa: 0.85, townhouse: 0.4 },
  estate: { estate: 1, single_family: 0.6, villa: 0.85 },
  villa: { villa: 1, estate: 0.85, single_family: 0.7, townhouse: 0.5 },
  condo: { condo: 1, penthouse: 1, co_op: 0.7, townhouse: 0.4 },
  penthouse: { penthouse: 1, condo: 0.5, co_op: 0.4 },
  co_op: { co_op: 1, condo: 0.8, penthouse: 0.8 },
  townhouse: { townhouse: 1, villa: 0.6, single_family: 0.5, condo: 0.5 },
  land: { land: 1 },
};
function typeCompat(want, have) {
  if (!want || !have) return null;
  if (want === have) return 1;
  return (TYPE_COMPAT[want] && TYPE_COMPAT[want][have]) || 0;
}
const TYPE_LABEL = { single_family: 'Single-family', condo: 'Condo', townhouse: 'Townhouse', estate: 'Estate', penthouse: 'Penthouse', villa: 'Villa', land: 'Land', co_op: 'Co-op' };
const typeLabel = (k) => TYPE_LABEL[k] || (k ? String(k).replace(/_/g, ' ') : '');

// ── Architectural style families ──────────────────────────────────────────
const STYLE_FAMILIES = {
  modern: ['modern', 'contemporary', 'minimalist', 'mid century', 'mid-century', 'mid century modern', 'mcm', 'international', 'tropical modern', 'coastal modern', 'miami modern', 'mimo', 'bauhaus', 'brutalist', 'organic modern', 'warm contemporary', 'architectural'],
  mediterranean: ['mediterranean', 'mediterranean revival', 'spanish', 'spanish revival', 'spanish colonial', 'mission', 'tuscan', 'italian', 'italianate', 'venetian', 'moorish', 'hacienda', 'santa barbara'],
  traditional: ['traditional', 'transitional', 'colonial', 'georgian', 'federal', 'neoclassical', 'classical', 'greek revival', 'tudor', 'french', 'french provincial', 'french country', 'chateau', 'normandy', 'english', 'regency', 'victorian', 'estate traditional'],
  coastal: ['coastal', 'british west indies', 'bwi', 'west indies', 'key west', 'island', 'caribbean', 'plantation', 'cape cod', 'shingle', 'shingle style', 'hamptons', 'beach house', 'low country', 'lowcountry', 'old florida'],
  rustic: ['farmhouse', 'modern farmhouse', 'craftsman', 'ranch', 'bungalow', 'cottage', 'rustic', 'mountain', 'mountain modern', 'lodge', 'adobe', 'pueblo', 'barn'],
  art_deco: ['art deco', 'deco', 'streamline', 'streamline moderne'],
};
const STYLE_PHRASES = Object.entries(STYLE_FAMILIES)
  .flatMap(([fam, list]) => list.map((p) => [squash(p), fam]))
  .sort((a, b) => b[0].length - a[0].length);

function styleFamily(text) {
  const t = squash(text);
  if (!t) return null;
  if (STYLE_FAMILIES[t.replace(/ /g, '_')]) return t.replace(/ /g, '_');
  for (const [p, fam] of STYLE_PHRASES) if (hasPhrase(t, p)) return fam;
  return null;
}
const FAMILY_LABEL = { modern: 'Modern', mediterranean: 'Mediterranean', traditional: 'Traditional', coastal: 'Coastal', rustic: 'Farmhouse', art_deco: 'Art Deco' };

// ── Views + waterfront ────────────────────────────────────────────────────
const VIEW_SYN = [
  ['intracoastal', ['intracoastal', 'icw', 'waterway']],
  ['ocean', ['ocean', 'sea', 'atlantic', 'pacific', 'gulf', 'beach']],
  ['bay', ['bay', 'biscayne', 'sound']],
  ['city', ['city', 'skyline', 'downtown', 'urban']],
  ['golf', ['golf', 'fairway']],
  ['park', ['park', 'greenbelt', 'preserve']],
  ['lake', ['lake', 'pond']],
  ['river', ['river']],
  ['canal', ['canal']],
  ['marina', ['marina', 'harbor', 'harbour']],
  ['mountain', ['mountain', 'mountains', 'ski', 'canyon', 'hills']],
  ['garden', ['garden', 'gardens', 'courtyard', 'landscape', 'tropical']],
  ['pool', ['pool']],
  ['water', ['water', 'waterfront']],
];
function viewKeyFromText(text) {
  const t = squash(text);
  if (!t) return null;
  for (const [key, syns] of VIEW_SYN) for (const p of syns) if (hasPhrase(t, p)) return key;
  return null;
}
const canonicalView = (v) => viewKeyFromText(v) || squash(v) || null;
const WATER_VIEWS = new Set(['ocean', 'bay', 'intracoastal', 'lake', 'river', 'canal', 'marina', 'water']);

const WATERFRONT_SYN = [
  ['none', ['none', 'no', 'not waterfront', 'n a']],
  ['any', ['any', 'any water', 'any waterfront', 'waterfront']],
  ['oceanfront', ['oceanfront', 'ocean front', 'ocean', 'beachfront', 'beach front', 'oceanside', 'direct ocean', 'gulf front', 'gulffront']],
  ['bayfront', ['bayfront', 'bay front', 'bay', 'biscayne bay', 'sound front']],
  ['intracoastal', ['intracoastal', 'icw', 'intracoastal waterway', 'waterway', 'deepwater', 'deep water']],
  ['canal', ['canal', 'canal front']],
  ['lake', ['lake', 'lakefront', 'lake front', 'pond']],
  ['river', ['river', 'riverfront', 'river front']],
];
function canonicalWaterfront(text) {
  const t = squash(text);
  if (!t) return null;
  for (const [key, syns] of WATERFRONT_SYN) for (const p of syns) if (t === squash(p)) return key;
  for (const [key, syns] of WATERFRONT_SYN) {
    if (key === 'none' || key === 'any') continue;
    for (const p of syns) if (hasPhrase(t, squash(p))) return key;
  }
  if (/\bwaterfront\b|\bon the water\b/.test(t)) return 'any';
  return null;
}
const WATERFRONT_LABEL = { oceanfront: 'Oceanfront', bayfront: 'Bayfront', intracoastal: 'Intracoastal', canal: 'Canal-front', lake: 'Lakefront', river: 'Riverfront', any: 'Waterfront', none: 'Not waterfront' };
// open/navigable water groups for partial credit
const NAVIGABLE = new Set(['bayfront', 'intracoastal', 'canal', 'river']);

// ── Name tokenizer (neighborhoods, buildings, markets) ───────────────────
const ABBREV = {
  isl: 'island', isle: 'island', isles: 'island', islands: 'island', bch: 'beach', vlg: 'village', vil: 'village',
  hts: 'heights', pt: 'point', pk: 'park', gdns: 'gardens', gdn: 'garden', est: 'estates', ests: 'estates', estate: 'estates',
  mt: 'mount', ft: 'fort', n: 'north', s: 'south', e: 'east', w: 'west', st: 'saint', ste: 'sainte', hbr: 'harbour', harbor: 'harbour',
  ctr: 'center', centre: 'center', twr: 'tower', twrs: 'towers', lk: 'lake', crk: 'creek', cv: 'cove', is: 'island',
  shrs: 'shores', spgs: 'springs', vly: 'valley', hls: 'hills', gr: 'grove', grv: 'grove', ky: 'key', bay: 'bay',
};
const GENERIC = new Set(['the', 'at', 'of', 'a', 'an', 'and', 'by', 'on', 'in', 'residences', 'residence', 'condominium', 'condominiums', 'community', 'neighborhood', 'district', 'area', 'collection', 'private']);
// Tokens too generic to establish a match on their own ("Beach" ≠ "Miami Beach").
const WEAK = new Set(['beach', 'island', 'key', 'park', 'village', 'north', 'south', 'east', 'west', 'harbour', 'bay', 'point', 'heights', 'estates', 'gardens', 'lake', 'city', 'shores', 'grove', 'hills', 'tower', 'towers', 'club', 'house', 'center', 'downtown', 'upper', 'lower', 'old', 'new', 'golf', 'ocean', 'river', 'springs', 'valley', 'cove', 'creek', 'saint', 'mount', 'fort', 'one', 'two', 'grand']);

function nameTokens(str) {
  const t = lc(str).replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const out = new Set();
  for (const raw of t.split(/\s+/)) {
    if (!raw) continue;
    const w = ABBREV[raw] || raw;
    if (GENERIC.has(w)) continue;
    out.add(w);
  }
  return out;
}

// RM modelSim ported to place names: exact token set = 1, containment ≥ 0.9
// (unless the overlap is only generic geography words), else Jaccard.
function nameSim(a, wants) {
  const A = a instanceof Set ? a : nameTokens(a);
  if (!A.size) return null;
  const list = [].concat(wants || []).filter(Boolean);
  if (!list.length) return null;
  let best = 0;
  for (const w of list) {
    const B = nameTokens(w);
    if (!B.size) continue;
    const inter = [...A].filter((x) => B.has(x));
    if (inter.length === A.size && inter.length === B.size) return 1;
    const union = new Set([...A, ...B]).size;
    let sim = union ? inter.length / union : 0;
    const strong = inter.some((x) => !WEAK.has(x) && !/^\d+$/.test(x));
    if (inter.length > 0 && strong && (inter.length === A.size || inter.length === B.size)) sim = Math.max(sim, 0.9);
    best = Math.max(best, sim);
  }
  return best;
}

// Exact-ish place equality (normalized token sets equal).
function sameName(a, b) {
  const A = nameTokens(a); const B = nameTokens(b);
  if (!A.size || !B.size || A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// Fair Housing guardrail — appended to every prompt that reads client words.
const FAIR_HOUSING = 'FAIR HOUSING (mandatory): never extract, infer, store or repeat protected-class information (race, color, religion, national origin, sex, gender identity, sexual orientation, familial status such as kids or pregnancy, disability, age, marital status, source of income) or demographic preferences about neighborhoods ("safe", "good schools for my kids", "people like us"). Record only property attributes and explicitly named locations. If a preference is phrased around people, drop it.';

module.exports = {
  lc, squash, hasPhrase,
  AMENITIES, normalizeAmenity, amenityLabel, amenityKeys, parseMustHave,
  canonicalType, typeCompat, typeLabel, TYPE_FAMILY, TYPE_KEYS,
  STYLE_FAMILIES, styleFamily, FAMILY_LABEL,
  canonicalView, viewKeyFromText, WATER_VIEWS,
  canonicalWaterfront, WATERFRONT_LABEL, NAVIGABLE,
  nameTokens, nameSim, sameName, WEAK,
  FAIR_HOUSING,
};

// Real-estate capture parser — "paste a listing link" and "just describe it"
// for the client Portfolio (spec §8.7 / §8.15 #2–#4).
//
//   parseCapture({ text, url, target: 'property'|'search'|'auto', workspaceId, hints })
//     → { kind: 'property'|'search', fields, confidence, source: 'ai'|'heuristic', portal, chips }
//
// Deterministic first (URL/slug heuristics, regex extraction, RE money rule:
// bare < 100 = millions, 100–9,999 = thousands), then — when AI is available —
// an LLM pass merged UNDER the deterministic backstops. We never fetch the
// external site (no scraping); a URL is parsed from its own text.
const ai = require('../../ai/claude');
const { parseMoneyRE, normalizeBare } = require('./text');

let V = null;
try { V = require('../matchmaker/vocab'); } catch (_) { V = null; }

// ── vocab ────────────────────────────────────────────────────────────────
const NEIGHBORHOODS = [
  'Gables Estates', 'Cocoplum', 'Coral Gables', 'Coconut Grove', 'Key Biscayne', 'Miami Beach', 'South Beach', 'South of Fifth', 'Mid-Beach',
  'North Beach', 'Bal Harbour', 'Bay Harbor Islands', 'Surfside', 'Sunny Isles Beach', 'Sunny Isles', 'Golden Beach', 'Fisher Island', 'Star Island',
  'Indian Creek', 'La Gorce', 'La Gorce Island', 'Nautilus', 'Allison Island', 'Sunset Islands', 'Venetian Islands', 'Palm Island', 'Hibiscus Island',
  'Normandy Isles', 'Brickell', 'Edgewater', 'Downtown Miami', 'Design District', 'Upper East Side', 'Morningside', 'Bayside', 'Wynwood',
  'Pinecrest', 'South Miami', 'High Pines', 'Ponce-Davis', 'Old Cutler', 'Gables by the Sea', 'Snapper Creek', 'Journey’s End', 'Aventura',
  'North Bay Village', 'Miami Shores', 'Bay Point', 'Fort Lauderdale', 'Las Olas', 'Harbor Beach', 'Rio Vista', 'Palm Beach', 'West Palm Beach',
  'Jupiter', 'Jupiter Island', 'Boca Raton', 'Royal Palm Yacht', 'Delray Beach', 'Manalapan', 'Naples', 'Port Royal', 'Aspen', 'Vail',
  'The Hamptons', 'Southampton', 'East Hampton', 'Bridgehampton', 'Tribeca', 'Upper East Side', 'Beverly Hills', 'Bel Air', 'Malibu',
];
const BUILDINGS = [
  'Aman Miami Beach', 'Faena House', 'Four Seasons Surf Club', 'Surf Club', 'St. Regis Bal Harbour', 'Oceana Bal Harbour', 'Jade Signature',
  'Jade Ocean', 'Porsche Design Tower', 'Fendi Chateau', 'Turnberry Ocean Club', 'Estates at Acqualina', 'Acqualina', 'Continuum', 'Apogee',
  'Glass', 'Una Residences', 'Five Park', 'Monad Terrace', 'Ritz-Carlton Residences', 'Brickell Flatiron', 'Echo Brickell', 'One Thousand Museum',
  'Missoni Baia', 'Arte Surfside', 'Eighty Seven Park', 'Bentley Residences', 'Casa Bella', 'Edition Residences', 'The Setai', 'Setai',
  'Mandarin Oriental', 'Cipriani Residences', 'Waldorf Astoria', 'Bvlgari', 'Rivage Bal Harbour', 'The Ritz-Carlton Coconut Grove', 'Park Grove',
  'Grove at Grand Bay', 'Ocean House', 'Eighty Seven Park', 'Muse', 'Mansions at Acqualina', 'Residences at Mandarin Oriental',
];
const LENDERS = ['First Republic', 'JPMorgan', 'J.P. Morgan', 'Chase', 'Wells Fargo', 'Bank of America', 'Citi', 'Citibank', 'City National', 'Northern Trust',
  'Morgan Stanley', 'Goldman Sachs', 'UBS', 'BMO', 'Truist', 'PNC', 'U.S. Bank', 'US Bank', 'Rocket', 'Bank OZK', 'First Citizens', 'Bank of the West',
  'TD Bank', 'Santander', 'Amerant', 'City National Bank', 'Flagstar', 'Bessemer', 'Pacific Western'];

const STYLES = ['modern', 'contemporary', 'mediterranean', 'colonial', 'spanish', 'tudor', 'farmhouse', 'transitional', 'traditional', 'coastal',
  'mid-century', 'art deco', 'british west indies', 'georgian', 'neoclassical', 'tropical modern', 'french', 'tuscan'];

const FEATURE_WORDS = [
  ['pool', /\b(pool|swimming pool|infinity pool|lap pool)\b/i],
  ['dock', /\b(dock|dockage|boat slip|slip)\b/i],
  ['boat lift', /\bboat\s*lift\b/i],
  ['wine cellar', /\bwine\s*(cellar|room|cave|storage)\b/i],
  ['guest house', /\b(guest\s*house|guesthouse|casita|guest cottage)\b/i],
  ['elevator', /\belevator\b/i],
  ['gated', /\b(gated|guard[- ]gated|24\/7 security)\b/i],
  ['generator', /\bgenerator\b/i],
  ['smart home', /\b(smart home|home automation|crestron|savant|control4)\b/i],
  ['home theater', /\b(home theat(?:er|re)|cinema|screening room|media room)\b/i],
  ['gym', /\b(home gym|gym|fitness room)\b/i],
  ['staff quarters', /\b(staff quarters|staff suite|maid'?s quarters)\b/i],
  ['summer kitchen', /\b(summer|outdoor) kitchen\b/i],
  ['rooftop terrace', /\b(rooftop|roof deck|roof terrace)\b/i],
  ['beach access', /\b(private beach|beach access|beach club)\b/i],
  ['tennis court', /\b(tennis|pickleball)\b/i],
  ['spa', /\b(spa|sauna|steam room|cold plunge)\b/i],
  ['impact windows', /\b(impact (?:windows|glass)|hurricane windows)\b/i],
  ['home office', /\b(home office|office|study|library)\b/i],
  ['chef’s kitchen', /\b(chef'?s kitchen|gourmet kitchen|catering kitchen)\b/i],
  ['fireplace', /\bfireplaces?\b/i],
  ['private elevator', /\bprivate elevator\b/i],
  ['concierge', /\b(concierge|doorman|full[- ]service)\b/i],
  ['garage', /\b(\d)\s*[- ]?car garage\b/i],
];

// Fair Housing scrub: never keep people-based preferences as criteria.
const PROTECTED = /\b(school|schools|family|families|kid|kids|child|children|baby|pregnan|church|synagogue|mosque|temple|religio|ethnic|hispanic|latino|latina|jewish|christian|muslim|catholic|asian|black|white|race|racial|disab|wheelchair|handicap|senior|elderly|retiree|retirement community|adult[- ]only|55\+|young professionals|bachelor|demograph|safe neighborhood|low crime|crime|people like|nationality|immigrant)\b/i;
const scrub = (list) => (list || []).filter((x) => x && !PROTECTED.test(String(x)));

// ── small utils ──────────────────────────────────────────────────────────
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, d, suf) => d + suf.toLowerCase());
const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── URL heuristics ───────────────────────────────────────────────────────
const SUFFIX = new Set(['rd', 'road', 'st', 'street', 'ave', 'av', 'avenue', 'dr', 'drive', 'ln', 'lane', 'blvd', 'boulevard', 'ct', 'court', 'way',
  'pl', 'place', 'ter', 'terrace', 'cir', 'circle', 'pkwy', 'parkway', 'hwy', 'highway', 'trl', 'trail', 'pt', 'point', 'cv', 'cove', 'loop', 'row',
  'sq', 'square', 'plz', 'plaza', 'path', 'walk', 'run', 'pass', 'cswy', 'causeway', 'xing', 'crescent', 'cres', 'aly', 'alley', 'bnd', 'bend',
  'is', 'isle', 'island', 'key', 'harbor', 'harbour', 'mews', 'close']);
const DIRS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const SUFFIX_ABBR = { road: 'Rd', street: 'St', avenue: 'Ave', av: 'Ave', drive: 'Dr', lane: 'Ln', boulevard: 'Blvd', court: 'Ct', place: 'Pl', terrace: 'Ter', circle: 'Cir', parkway: 'Pkwy', highway: 'Hwy', trail: 'Trl' };

function portalOf(host) {
  const h = host.replace(/^www\./, '');
  if (/zillow\./.test(h)) return 'Zillow';
  if (/redfin\./.test(h)) return 'Redfin';
  if (/realtor\.com/.test(h)) return 'Realtor.com';
  if (/compass\.com/.test(h)) return 'Compass';
  if (/sothebys/.test(h)) return "Sotheby's";
  if (/christies/.test(h)) return "Christie's";
  if (/elliman/.test(h)) return 'Douglas Elliman';
  if (/coldwellbanker/.test(h)) return 'Coldwell Banker';
  if (/corcoran/.test(h)) return 'Corcoran';
  if (/streeteasy/.test(h)) return 'StreetEasy';
  if (/trulia/.test(h)) return 'Trulia';
  if (/homes\.com/.test(h)) return 'Homes.com';
  if (/(mls|matrix|flexmls|paragon|miamire|miamirealtors|beaches)/.test(h)) return 'MLS';
  return h;
}

// Split slug tokens (street… city… ST zip) into address parts.
function addressFromTokens(tokens) {
  const t = tokens.filter(Boolean);
  if (!t.length) return null;
  let stIdx = -1;
  for (let i = t.length - 1; i >= 0; i--) {
    if (STATES.has(t[i].toUpperCase()) && (i === t.length - 1 || /^\d{5}$/.test(t[i + 1]))) { stIdx = i; break; }
  }
  const zip = stIdx >= 0 && /^\d{5}$/.test(t[stIdx + 1] || '') ? t[stIdx + 1] : null;
  const head = stIdx >= 0 ? t.slice(0, stIdx) : t.slice();
  if (!head.length || !/^\d+[a-z]?$/i.test(head[0])) {
    return stIdx >= 0 ? { city: titleCase(head.join(' ')) || null, state: t[stIdx].toUpperCase(), zip } : null;
  }
  // street = number … suffix (+ directional) ; optional unit ; rest = city
  let end = -1;
  for (let i = 1; i < head.length - 1; i++) if (SUFFIX.has(head[i].toLowerCase())) end = i;
  if (end < 0) end = Math.min(head.length - 2, 3);
  if (end + 1 < head.length - 1 && DIRS.has(head[end + 1].toLowerCase())) end += 1;
  let k = end + 1;
  let unit = null;
  if (k < head.length && /^(apt|unit|ste|suite|ph|#)$/i.test(head[k]) && k + 1 < head.length) { unit = (head[k].toLowerCase() === 'ph' ? 'PH' : '') + head[k + 1].toUpperCase(); k += 2; }
  else if (k < head.length && /^ph\d+[a-z]?$/i.test(head[k])) { unit = head[k].toUpperCase(); k += 1; }
  const street = head.slice(0, end + 1).map((w, i) => {
    const l = w.toLowerCase();
    if (i > 0 && SUFFIX_ABBR[l]) return SUFFIX_ABBR[l];
    if (DIRS.has(l)) return l.toUpperCase();
    return titleCase(w);
  }).join(' ');
  return { street, unit, city: titleCase(head.slice(k).join(' ')) || null, state: stIdx >= 0 ? t[stIdx].toUpperCase() : null, zip };
}

function parseListingUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const portal = portalOf(u.hostname.toLowerCase());
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const segs = path.split('/').filter(Boolean);
  const fields = { listingUrl: u.toString() };
  const confidence = { listingUrl: 1 };
  let addr = null;

  if (portal === 'Zillow') {
    const i = segs.indexOf('homedetails');
    if (i >= 0 && segs[i + 1]) addr = addressFromTokens(segs[i + 1].split('-'));
  } else if (portal === 'Redfin' && segs.length >= 3 && STATES.has(segs[0].toUpperCase())) {
    const streetTok = segs[2].split('-');
    const zip = /^\d{5}$/.test(streetTok[streetTok.length - 1]) ? streetTok.pop() : null;
    const st = addressFromTokens([...streetTok, 'x', segs[0], ...(zip ? [zip] : [])]);
    addr = { street: st && st.street, unit: null, city: titleCase(segs[1].replace(/-/g, ' ')), state: segs[0].toUpperCase(), zip };
    const ui = segs.indexOf('unit');
    const unitSeg = segs.find((s) => /^unit-/i.test(s));
    if (unitSeg) addr.unit = unitSeg.replace(/^unit-/i, '').toUpperCase();
    else if (ui >= 0 && segs[ui + 1]) addr.unit = segs[ui + 1].toUpperCase();
  } else if (portal === 'Realtor.com') {
    const seg = segs.find((s) => s.includes('_')) || '';
    const parts = seg.split('_');
    if (parts.length >= 4) {
      const st = addressFromTokens([...parts[0].split('-'), 'x', parts[2], parts[3]]);
      addr = { street: st && st.street, unit: st && st.unit, city: titleCase(parts[1].replace(/-/g, ' ')), state: parts[2].toUpperCase(), zip: /^\d{5}$/.test(parts[3]) ? parts[3] : null };
    }
  } else {
    // Compass & generic: find the slug with "-ST-ZIP" in it.
    const seg = segs.find((s) => /^\d+[a-z]?-.*-[a-z]{2}-\d{5}(?:-|$)/i.test(s));
    if (seg) addr = addressFromTokens(seg.replace(/-\d{5}-.*$/, (m) => m.slice(0, 6)).split('-'));
  }
  if (addr) {
    for (const k of ['street', 'unit', 'city', 'state', 'zip']) if (addr[k]) { fields[k] = addr[k]; confidence[k] = k === 'city' ? 0.8 : 0.9; }
  }
  // MLS number (Miami: A11512345 / F10123456 / RX-10901234) or explicit params.
  const hay = `${u.pathname} ${u.search}`;
  const mls = /(?:mls(?:id|number|num|_?no)?[=/:-]?\s*)([A-Z]{0,2}-?\d{6,10})/i.exec(hay) || /\b([AFRWK]\d{8}|RX-\d{8})\b/.exec(hay);
  if (mls) { fields.mlsNumber = mls[1].toUpperCase(); confidence.mlsNumber = 0.85; }
  if (fields.city) {
    const hood = NEIGHBORHOODS.find((n) => n.toLowerCase() === fields.city.toLowerCase());
    if (hood) fields.neighborhood = hood;
  }
  return { fields, confidence, portal };
}

// ── text heuristics ──────────────────────────────────────────────────────
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function monthYear(str) {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(?:of\s+)?((?:19|20)\d{2})\b/i.exec(str);
  if (m) return `${m[2]}-${String(MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)] + 1).padStart(2, '0')}-15`;
  const y = /\b((?:19|20)\d{2})\b/.exec(str);
  return y ? `${y[1]}-06-15` : null;
}

function numberWord(s) {
  const W = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  return W[String(s).toLowerCase()] ?? Number(String(s).replace(/,/g, ''));
}

function detectKind(text) {
  const t = text.toLowerCase();
  const want = /\b(wants?|looking for|searching|search for|in the market|needs?|must have|has to have|dream|would love|ideally|budget|up to|under \$?\d|max(?:imum)?|wishlist|hunting|shopping for|interested in)\b/.test(t);
  const own = /\b(owns?|bought|purchased|lives (?:at|in)|their (?:home|house|place|condo)|primary residence|vacation home|paid|mortgage|refi|sold|rents? (?:at|in)|renting|landlord|tenant|arm\b|loan)\b/.test(t);
  if (want && !own) return 'search';
  if (own && !want) return 'property';
  if (/^\s*\d+\s+[a-z]/i.test(text)) return 'property';
  return want ? 'search' : 'property';
}

function extractCommon(text) {
  const t = text;
  const f = {};
  const c = {};
  let m;
  if ((m = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:bd|br|beds?|bedrooms?)\b/i.exec(t))) { f.beds = numberWord(m[1]); c.beds = 0.95; f._bedsPlus = /\+|\bor more\b|at least|min/i.test(t.slice(Math.max(0, m.index - 12), m.index + m[0].length + 10)); }
  if ((m = /(\d+(?:\.\d)?)\s*\+?\s*(?:ba|baths?|bathrooms?)\b/i.exec(t))) { f.baths = Number(m[1]); c.baths = 0.95; }
  if ((m = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k|\d{3,6})\s*(?:\+\s*)?(?:sf|sq\.?\s*ft\.?|square\s*feet|sqft|square foot)\b(?!\s*lot)/i.exec(t))) {
    const raw = m[1].toLowerCase().replace(/\s/g, '');
    f.sqft = raw.endsWith('k') ? Math.round(parseFloat(raw) * 1000) : Number(raw.replace(/,/g, ''));
    c.sqft = 0.9;
  }
  if ((m = /(\d+(?:\.\d+)?)\s*\+?\s*(?:ac|acres?)\b/i.exec(t))) { f.lotAcres = Number(m[1]); f.lotSqft = Math.round(Number(m[1]) * 43560); c.lotSqft = 0.9; }
  else if ((m = /(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:sf|sq\.?\s*ft|square feet)\s*lot/i.exec(t)) || (m = /lot\s*(?:of\s*)?(\d{1,3}(?:,\d{3})+|\d{4,6})/i.exec(t))) { f.lotSqft = Number(m[1].replace(/,/g, '')); c.lotSqft = 0.85; }
  if ((m = /\b(?:built(?: in)?|circa|c\.|year built|completed(?: in)?)\s*((?:19|20)\d{2})\b/i.exec(t)) || (m = /\b((?:19|20)\d{2})\s*(?:build|built|construction|new build)\b/i.exec(t))) { f.yearBuilt = Number(m[1]); c.yearBuilt = 0.9; }
  if ((m = /(\d{1,3}(?:,\d{3})*)\s*(?:'|ft|foot|feet)\s*(?:of\s*)?(?:water\s*)?frontage/i.exec(t))) { f.waterFrontageFt = Number(m[1].replace(/,/g, '')); c.waterFrontageFt = 0.9; }
  if ((m = /(\d{2,3})\s*(?:'|’|ft|foot|feet|-foot|-ft)\s*(?:\w+\s){0,3}?(?:boat|yacht|dock|vessel|slip)/i.exec(t)) || (m = /(?:dock|slip)\D{0,24}?(\d{2,3})\s*(?:'|’|ft|foot|feet)/i.exec(t))) { f.dockLengthFt = Number(m[1]); c.dockLengthFt = 0.9; }

  // places first (so "Gables Estates" / "Faena House" never read as a type)
  const areas = [];
  for (const n of NEIGHBORHOODS) if (new RegExp(`\\b${escapeRe(n)}\\b`, 'i').test(t)) areas.push(n);
  const blds = BUILDINGS.filter((b) => new RegExp(`\\b${escapeRe(b)}\\b`, 'i').test(t));
  let bare = t;
  for (const n of [...areas, ...blds].sort((a, b) => b.length - a.length)) bare = bare.replace(new RegExp(`\\b${escapeRe(n)}\\b`, 'ig'), ' ');

  // type
  const types = [];
  const typeRules = [
    ['penthouse', /\b(penthouse|\bph\b|sky villa)\b/i], ['co_op', /\bco-?op\b/i], ['townhouse', /\b(townhouse|townhome)s?\b/i], ['villa', /\bvillas?\b/i],
    ['estate', /\b(estate|compound|mansion)s?\b/i], ['land', /\b(vacant land|lot to build|teardown|buildable lot|land)\b/i], ['condo', /\b(condo|condominium|apartment|high[- ]rise)s?\b/i],
  ];
  for (const [k, re] of typeRules) if (re.test(bare)) types.push(k);
  if (!types.length && blds.length) types.push('condo');
  if (!types.length && /\b(single[- ]family|house|home)\b/i.test(bare)) types.push('single_family');
  if (types.length) { f.propertyTypes = uniq(types); c.propertyType = 0.85; }

  // waterfront
  const wf = [];
  if (/\b(ocean[- ]?front|beach[- ]?front|direct ocean|on the ocean)\b/i.test(t)) wf.push('oceanfront');
  if (/\b(bay[- ]?front|on the bay|biscayne bay front)\b/i.test(t)) wf.push('bayfront');
  if (/\bintracoastal\b/i.test(t)) wf.push('intracoastal');
  if (/\bcanal[- ]?front|on a canal|canal\b/i.test(t)) wf.push('canal');
  if (/\blake[- ]?front|on the lake\b/i.test(t)) wf.push('lake');
  if (!wf.length && (/\b(water[- ]?front|on the water|deep[- ]?water)\b/i.test(t) || f.dockLengthFt)) wf.push('any');
  if (wf.length) { f.waterfront = uniq(wf); c.waterfront = 0.9; }

  // views
  const views = [];
  if (/\bocean views?\b|\bviews? of the ocean\b/i.test(t)) views.push('ocean');
  if (/\bbay views?\b|\bviews? of the bay\b/i.test(t)) views.push('bay');
  if (/\b(skyline|city) views?\b/i.test(t)) views.push('city');
  if (/\bgolf (?:course )?views?\b/i.test(t)) views.push('golf');
  if (/\bintracoastal views?\b/i.test(t)) views.push('intracoastal');
  if (/\bsunset views?\b/i.test(t)) views.push('sunset');
  if (/\bwater views?\b/i.test(t)) views.push('water');
  if (views.length) f.views = uniq(views);

  // styles
  const styles = STYLES.filter((s) => new RegExp(`\\b${escapeRe(s)}\\b`, 'i').test(t));
  if (/\bbwi\b/i.test(t)) styles.push('british west indies');
  if (styles.length) f.styles = uniq(styles);

  // features
  const feats = [];
  for (const [name, re] of FEATURE_WORDS) {
    const mm = re.exec(t);
    if (!mm) continue;
    const before = t.slice(Math.max(0, mm.index - 4), mm.index).toLowerCase();
    if (/no\s+$/.test(before)) continue; // "no pool" is a deal-breaker, not a feature
    feats.push(name === 'garage' && mm[1] ? `${mm[1]}-car garage` : name);
  }
  const fu = uniq(feats);
  const fclean = fu.filter((x) => !fu.some((y) => y !== x && y.toLowerCase().includes(x.toLowerCase())));
  if (fclean.length) f.features = fclean;

  // areas
  if (/\bthe grove\b/i.test(t)) areas.push('Coconut Grove');
  if (/\bthe gables\b|\bgables\b/i.test(t) && !areas.some((a) => /gables/i.test(a))) areas.push('Coral Gables');
  if (/\bkey bisc\b|\bkb\b/i.test(t)) areas.push('Key Biscayne');
  // longest-name wins when one area contains another ("Coral Gables" vs "Gables Estates" are both kept)
  const cleanedAreas = uniq(areas).filter((a, _, arr) => !arr.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase()) && !/estates|by the sea/i.test(b)));
  if (cleanedAreas.length) { f.areas = cleanedAreas; c.areas = 0.9; }
  if (blds.length) f.buildings = uniq(blds).filter((b, _, arr) => !arr.some((x) => x !== b && x.toLowerCase().includes(b.toLowerCase())));

  // URL + MLS inside text
  const url = /(https?:\/\/[^\s)]+)/i.exec(t);
  if (url) f.listingUrl = url[1];
  if ((m = /\bmls\s*#?\s*:?\s*([A-Z]{0,2}-?\d{6,10})\b/i.exec(t)) || (m = /\b([AF]\d{8})\b/.exec(t))) f.mlsNumber = m[1].toUpperCase();
  return { f, c };
}

// Money phrases with context. Returns [{role, value}] in reading order.
function moneyMentions(text) {
  const out = [];
  const re = /(?:(around|about|approx(?:imately)?|~|up to|upto|under|below|less than|max(?:imum)?|no more than|budget(?: of| is)?|between|from|to|paid|bought (?:it )?for|purchased (?:it )?for|worth|valued at|value(?:d)? (?:is|at)?|est(?:imated)?(?: at)?|zestimate|listed (?:at|for)|asking|sold (?:it )?for|rents? (?:it )?(?:out )?for|rent(?:al)? (?:is|of)|owes?|balance(?: of| is)?|loan(?: of)?|mortgage(?: of| balance)?|hoa(?: is| of)?|taxes(?: are| of)?|pre-?approved (?:for|up to)|-|–|and|or)\s*)?\$?\s*(\d+(?:[.,]\d+)*)\s*(k|m|mm|mil|million|thousand|b)?\b(\s*(?:\/\s*mo|a month|per month|monthly|\/\s*yr|a year|per year|annually))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const ctx = (m[1] || '').toLowerCase();
    const numStr = m[2];
    const unit = (m[3] || '').toLowerCase();
    const per = (m[4] || '').toLowerCase();
    const preceding = text.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const following = text.slice(m.index + m[0].length, m.index + m[0].length + 14).toLowerCase();
    // skip things that are clearly not money
    if (!unit && !m[0].includes('$') && !ctx) continue;
    if (/^\s*(?:bd|br|bed|ba|bath|sf|sq|square|ft|foot|feet|'|acre|ac|car|%|yr|year|story|stories|th|st|nd|rd)\b/.test(following)) continue;
    if (/^(19|20)\d{2}$/.test(numStr) && !unit && !m[0].includes('$')) continue;
    const n = parseFloat(numStr.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    let value;
    if (unit) value = parseMoneyRE(`${n}${unit}`);
    else if (m[0].includes('$') && n >= 1000) value = Math.round(n);
    else value = normalizeBare(n);
    if (!value) continue;
    let role = 'price';
    const c = `${preceding} ${ctx}`;
    if (/(\/\s*mo|month)/.test(per) || /rent/.test(c)) role = /hoa/.test(c) ? 'hoa' : 'rent';
    else if (/hoa/.test(c)) role = 'hoa';
    else if (/tax/.test(c)) role = 'taxes';
    else if (/(owe|balance|loan|mortgage)/.test(c)) role = 'loan';
    else if (/pre-?approved/.test(c)) role = 'preapproval';
    else if (/(paid|bought|purchased)/.test(c)) role = 'purchase';
    else if (/sold/.test(c)) role = 'sold';
    else if (/(worth|valued|value|est|zestimate|listed|asking)/.test(c)) role = 'value';
    else if (/(up to|upto|under|below|less than|max|no more than)/.test(ctx)) role = 'max';
    else if (/(around|about|approx|~|budget)/.test(ctx)) role = 'target';
    else if (/(between|from)/.test(ctx)) role = 'min';
    else if (/^(to|and|or|-|–)$/.test(ctx.trim()) && out.length && ['min', 'target'].includes(out[out.length - 1].role)) role = 'max';
    // rents/hoa are monthly dollars — never apply the "bare = millions" rule.
    if ((role === 'rent' || role === 'hoa') && !unit) value = n >= 100 ? Math.round(n) : Math.round(n * 1000);
    if (role === 'taxes' && !unit && n < 1000) value = Math.round(n * 1000);
    out.push({ role, value });
  }
  return out;
}

function timelineOf(text) {
  const t = text.toLowerCase();
  if (/\b(asap|immediately|right away|right now|urgent)\b/.test(t)) return 'asap';
  if (/\b(30 days|next month|within a month|this month)\b/.test(t)) return '30d';
  if (/\b(60|90) days\b|\b(2|3|two|three) months\b|\bthis summer\b|\bby summer\b|\bthis quarter\b/.test(t)) return '90d';
  if (/\b(6|six) months\b|\bby (?:the )?(?:fall|winter|end of the year|year[- ]end)\b|\bthis year\b/.test(t)) return '6mo';
  const by = /\bby (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t) || /\bbefore (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t);
  if (by) {
    const now = new Date();
    let months = (MONTHS[by[1]] - now.getMonth() + 12) % 12;
    if (months === 0) months = 12;
    return months <= 1 ? '30d' : months <= 3 ? '90d' : months <= 6 ? '6mo' : '12mo';
  }
  if (/\b(next year|12 months|a year|within the year)\b/.test(t)) return '12mo';
  if (/\b(someday|one day|eventually|no rush|opportunistic|if the right one)\b/.test(t)) return 'someday';
  return null;
}

function financingOf(text) {
  const t = text.toLowerCase();
  if (/\b1031\b/.test(t)) return '1031_exchange';
  if (/\b(all[- ]cash|cash buyer|paying cash|cash)\b/.test(t)) return 'cash';
  if (/\bjumbo\b/.test(t)) return 'jumbo';
  if (/\bbridge loan|\bbridge\b/.test(t)) return 'bridge';
  if (/\bpre-?approved\b/.test(t)) return 'preapproved';
  return null;
}

function dealBreakersOf(text) {
  const out = [];
  const re = /\b(?:no|not|never|avoid|hates?|can'?t do|deal[- ]?breakers?:?)\s+(?:an?\s+|the\s+)?([a-z][a-z' -]{1,28}?)(?=[,.;!]|\s+(?:and|or|but|please|either)\b|$)/gi;
  let m;
  while ((m = re.exec(text))) {
    let v = m[1].trim().replace(/\s+/g, ' ');
    if (/^(more than|less than|rush|preference|need|longer|one|way|matter|problem|issue|later|earlier|sooner)\b/i.test(v)) continue;
    if (/^hoa\b/i.test(v)) v = 'HOA';
    if (v.split(' ').length > 4) continue;
    out.push(v);
  }
  return scrub(uniq(out)).slice(0, 8);
}

function importanceFor(text, feature) {
  const idx = text.toLowerCase().indexOf(feature.toLowerCase().split(' ')[0]);
  if (idx < 0) return 'want';
  const window = text.slice(Math.max(0, idx - 40), idx + 5).toLowerCase();
  if (/(must|needs?|has to|have to|non[- ]negotiable|required|requirement|essential)/.test(window)) return 'must';
  return 'want';
}

function heuristicParse(text, target) {
  const kind = target === 'property' || target === 'search' ? target : detectKind(text);
  const { f, c } = extractCommon(text);
  const money = moneyMentions(text);
  if (kind === 'search') {
    const s = { notes: text.trim() };
    if (f.areas) s.neighborhoods = f.areas;
    if (f.buildings) s.buildings = f.buildings;
    if (f.propertyTypes) s.propertyTypes = f.propertyTypes;
    if (f.beds != null) s.bedsMin = f.beds;
    if (f.baths != null) s.bathsMin = f.baths;
    if (f.sqft) s.sqftMin = f.sqft;
    if (f.lotSqft) s.lotSqftMin = f.lotSqft;
    if (f.yearBuilt) s.yearBuiltMin = f.yearBuilt;
    if (f.styles) s.styles = f.styles;
    if (f.waterfront) s.waterfront = f.waterfront.filter((w) => w !== 'any').length ? f.waterfront.filter((w) => w !== 'any') : ['any'];
    if (f.views) s.views = f.views;
    const mins = money.filter((x) => x.role === 'min');
    const maxs = money.filter((x) => x.role === 'max');
    const targets = money.filter((x) => x.role === 'target' || x.role === 'price');
    if (maxs.length) s.priceMax = Math.max(...maxs.map((x) => x.value));
    if (mins.length) s.priceMin = Math.min(...mins.map((x) => x.value));
    if (targets.length) {
      const tv = targets[0].value;
      s.criteriaRaw = { ...(s.criteriaRaw || {}), priceTarget: tv };
      if (!s.priceMax) { s.priceMax = tv; s.budgetFlexible = true; }
      if (!s.priceMin && tv < (s.priceMax || Infinity)) s.priceMin = Math.round(tv * 0.8 / 50000) * 50000;
    }
    if (/\bflexib/i.test(text)) s.budgetFlexible = true;
    const must = [];
    const nice = [];
    for (const feat of f.features || []) {
      (importanceFor(text, feat) === 'must' ? must : nice).push(feat);
    }
    const mustHaves = must.map((feature) => ({ feature, importance: 1, source: 'text' }));
    if (f.dockLengthFt) {
      const i = mustHaves.findIndex((x) => /dock/i.test(x.feature));
      const row = { feature: `Dock ≥ ${f.dockLengthFt} ft`, importance: 1, source: 'text', key: 'dock_length', min: f.dockLengthFt };
      if (i >= 0) mustHaves[i] = row; else mustHaves.push(row);
      const ni = nice.findIndex((x) => /dock/i.test(x));
      if (ni >= 0) nice.splice(ni, 1);
    }
    if (mustHaves.length) s.mustHaves = mustHaves;
    if (nice.length) s.niceToHaves = nice;
    const db = dealBreakersOf(text);
    if (db.length) s.dealBreakers = db;
    const tl = timelineOf(text); if (tl) s.timeline = tl;
    const fin = financingOf(text); if (fin) s.financing = fin;
    const pre = money.find((x) => x.role === 'preapproval');
    s.criteriaRaw = { ...(s.criteriaRaw || {}), freeText: text.trim(), ...(pre ? { preApprovalAmount: pre.value } : {}), ...(f.waterFrontageFt ? { frontageMinFt: f.waterFrontageFt } : {}) };
    s.bucket = /\b(someday|one day|dream|eventually|if the right one|aspirational)\b/i.test(text) ? 'dream' : 'active';
    return { kind, fields: s, confidence: { ...c, price: money.length ? 0.85 : 0 } };
  }

  // property
  const p = {};
  const lower = text.toLowerCase();
  p.relationship = /\b(sold|sold it|sold their)\b/.test(lower) ? 'sold'
    : /\b(rents?|renting|tenant in|leases? (?:a|an|the))\b/.test(lower) && !/\brents? (?:it )?out\b/.test(lower) ? 'rents'
      : /\b(rents? (?:it )?out|landlord|tenant pays|leased (?:it )?out)\b/.test(lower) ? 'leased_out'
        : /\b(watching|keeping an eye|tracking)\b/.test(lower) ? 'watching' : 'owns';
  if (/\b(primary|lives? (?:there|at|in))\b/.test(lower)) p.occupancy = 'primary';
  else if (/\b(vacation|second home|weekend|ski house|beach house)\b/.test(lower)) p.occupancy = 'vacation';
  else if (/\b(investment|rental|airbnb|income)\b/.test(lower)) p.occupancy = 'investment';
  const addr = /\b(\d{1,6}\s+(?:[NSEW]{1,2}\s+)?[A-Z0-9][\w'.-]*(?:\s+[A-Z0-9][\w'.-]*){0,4}?\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway|Hwy|Trl|Point|Pt|Island|Isle|Key|Cswy|Causeway)\b\.?(?:\s+[NSEW]{1,2}\b)?)/.exec(text);
  if (addr) {
    let street = addr[1].replace(/\s+/g, ' ').trim();
    const tail = /^\s+(Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway)\b\.?/.exec(text.slice(addr.index + addr[1].length));
    if (tail) street += ` ${tail[1]}`;
    p.street = street; c.street = 0.85;
  }
  const unit = /(?:#|\bunit\s+|\bapt\.?\s+|\bph\s*)([A-Z]?\d{1,5}[A-Z]?)\b/i.exec(text);
  if (unit) p.unit = (/\bph/i.test(unit[0]) ? 'PH' : '') + unit[1].toUpperCase();
  if (f.areas) { p.neighborhood = f.areas[0]; c.neighborhood = 0.85; }
  if (f.buildings) p.buildingName = f.buildings[0];
  if (f.propertyTypes) p.propertyType = f.propertyTypes[0];
  for (const k of ['beds', 'baths', 'sqft', 'lotSqft', 'lotAcres', 'yearBuilt', 'waterFrontageFt', 'dockLengthFt']) if (f[k] != null) p[k] = f[k];
  if (f.styles) p.architecturalStyle = titleCase(f.styles[0]);
  if (f.waterfront) p.waterfront = f.waterfront[0];
  if (f.views) p.views = f.views;
  if (f.features) p.features = f.features.map((name) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), confirmed: false, importance: 'stated' }));
  for (const x of money) {
    if (x.role === 'purchase' && !p.purchasePrice) p.purchasePrice = x.value;
    else if (x.role === 'value' && !p.estValue) { p.estValue = x.value; p.valueSource = /listed|asking/i.test(text) ? 'listing' : 'manual'; }
    else if (x.role === 'sold' && !p.soldPrice) p.soldPrice = x.value;
    else if (x.role === 'rent' && !p.rentAmount) p.rentAmount = x.value;
    else if (x.role === 'hoa' && !p.hoaMonthly) p.hoaMonthly = x.value;
    else if (x.role === 'taxes' && !p.taxAnnual) p.taxAnnual = x.value;
    else if (x.role === 'loan' && !p.mortgageBalance) p.mortgageBalance = x.value;
    else if ((x.role === 'price' || x.role === 'target') && !p.estValue && !p.purchasePrice) {
      if (p.relationship === 'sold') p.soldPrice = p.soldPrice || x.value; else p.estValue = x.value;
    }
  }
  let m;
  if ((m = /\b(?:bought|purchased|closed|acquired|since)\b[^.]{0,30}?\b((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\b/i.exec(text))) {
    p.purchasedAt = monthYear(`${m[1] || ''}${m[2]}`);
    p.meta = { ...(p.meta || {}), exact: { purchasedAt: !!m[1] } };
  }
  if ((m = /\bsold\b[^.]{0,30}?\b((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\b/i.exec(text))) p.soldAt = monthYear(`${m[1] || ''}${m[2]}`);
  if ((m = /(\d{1,2})\s*\/\s*1\s*arm\b/i.exec(text)) || (m = /(\d{1,2})[- ]year arm\b/i.exec(text))) {
    p.loanType = 'arm';
    p.meta = { ...(p.meta || {}), armFixedYears: Number(m[1]) };
  } else if (/\binterest[- ]only\b/i.test(text)) p.loanType = 'interest_only';
  else if (/\bballoon\b/i.test(text)) p.loanType = 'balloon';
  else if (/\bfixed\b/i.test(text) && /\b(mortgage|loan|rate)\b/i.test(text)) p.loanType = 'fixed';
  else if (/\b(free and clear|paid off|no mortgage|all cash|bought (?:it )?(?:with )?cash)\b/i.test(text)) { p.loanType = 'cash'; p.mortgageBalance = 0; }
  if ((m = /(\d+(?:\.\d+)?)\s*%/.exec(text)) && /\b(rate|arm|mortgage|loan|fixed|at)\b/i.test(text)) { const r = Number(m[1]); if (r > 0 && r < 20) p.mortgageRate = Math.round(r * 1000) / 100000; }
  if ((m = /\b(?:originat\w*|took (?:it|the loan) out|from|since)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2})/i.exec(text)) && p.loanType) {
    p.meta = { ...(p.meta || {}), originatedAt: monthYear(m[1]) };
  }
  const lender = LENDERS.find((l) => new RegExp(`\\b${escapeRe(l)}\\b`, 'i').test(text));
  if (lender) p.lenderName = lender;
  if ((m = /\blease (?:ends|is up|expires|runs (?:out|through)|until)\s+(?:in\s+|on\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,2},?)?\s*(?:(?:19|20)\d{2})?)/i.exec(text))) {
    const s = m[1];
    const y = /(?:19|20)\d{2}/.exec(s);
    const mo = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(s);
    if (mo) {
      const now = new Date();
      let year = y ? Number(y[0]) : now.getFullYear();
      const month = MONTHS[mo[1].toLowerCase()];
      if (!y && month < now.getMonth()) year += 1;
      const day = /\b(\d{1,2})\b/.exec(s.replace(/(?:19|20)\d{2}/, ''));
      p.leaseEndsAt = `${year}-${String(month + 1).padStart(2, '0')}-${String(day ? Number(day[1]) : 1).padStart(2, '0')}`;
    }
  }
  if (/\b(thinking (?:of|about) selling|might sell|wants to sell|ready to sell|considering selling|could sell)\b/i.test(text)) p.thinkingOfSelling = true;
  if (/\b(with me|through me|i sold|i helped|my client bought|we bought|we closed)\b/i.test(text)) {
    if (p.relationship === 'sold') p.soldWithMe = true; else p.boughtWithMe = true;
  }
  if (f.listingUrl) { p.listingUrl = f.listingUrl; p.source = 'listing_link'; }
  if (f.mlsNumber) p.mlsNumber = f.mlsNumber;
  p.notes = text.trim();
  return { kind, fields: p, confidence: c };
}

// ── AI pass ──────────────────────────────────────────────────────────────
const nul = (type) => ({ type: [type, 'null'] });
const strArr = { type: 'array', items: { type: 'string' } };
const AI_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['property', 'search'] },
    property: {
      type: 'object',
      properties: {
        relationship: nul('string'),
        occupancy: nul('string'),
        street: nul('string'), unit: nul('string'), city: nul('string'), state: nul('string'), zip: nul('string'),
        neighborhood: nul('string'), buildingName: nul('string'), propertyType: nul('string'), architecturalStyle: nul('string'),
        beds: nul('integer'), baths: nul('number'), sqft: nul('integer'), lotSqft: nul('integer'), yearBuilt: nul('integer'),
        waterfront: nul('string'), waterFrontageFt: nul('integer'), dockLengthFt: nul('integer'), views: strArr, features: strArr,
        purchasePrice: nul('integer'), purchasedAt: nul('string'), estValue: nul('integer'), soldPrice: nul('integer'), soldAt: nul('string'),
        mortgageBalance: nul('integer'), mortgageRatePct: nul('number'), loanType: nul('string'), armFixedYears: nul('integer'),
        originatedAt: nul('string'), lenderName: nul('string'), monthlyPayment: nul('integer'), rentAmount: nul('integer'),
        leaseEndsAt: nul('string'), hoaMonthly: nul('integer'), taxAnnual: nul('integer'), mlsNumber: nul('string'), listingUrl: nul('string'),
        thinkingOfSelling: nul('boolean'), boughtWithMe: nul('boolean'), soldWithMe: nul('boolean'),
      },
    },
    search: {
      type: 'object',
      properties: {
        name: nul('string'), bucket: nul('string'),
        neighborhoods: strArr, markets: strArr, buildings: strArr, propertyTypes: strArr,
        priceMin: nul('integer'), priceMax: nul('integer'), budgetFlexible: nul('boolean'),
        bedsMin: nul('integer'), bathsMin: nul('number'), sqftMin: nul('integer'), lotSqftMin: nul('integer'), yearBuiltMin: nul('integer'),
        styles: strArr, waterfront: strArr, views: strArr,
        mustHaves: { type: 'array', items: { type: 'object', properties: { feature: { type: 'string' }, importance: { type: 'string' }, min: nul('number') } } },
        niceToHaves: strArr, dealBreakers: strArr, timeline: nul('string'), financing: nul('string'), preApprovalAmount: nul('integer'),
      },
    },
  },
};

const AI_SYSTEM = `You extract structured real-estate data for a luxury agent's CRM from the agent's own shorthand, or from the text of a listing URL. Field vocab: relationship owns | rents | sold | watching | leased_out; occupancy primary | second_home | investment | vacation | rental; search bucket active | dream; must-have importance must | want.
Decide whether the input describes ONE property the client owns/rents/sold/watches ("property") or what the client WANTS to buy ("search"); fill only that object (leave the other with nulls/empty arrays).

Rules:
- Missing detail is fine; DROPPED detail is not. Never invent prices, dates, addresses, sizes or features that are not stated (a URL slug only yields its address/city/zip).
- Money is whole US dollars. Real-estate shorthand: a bare number under 100 in a price context means MILLIONS ("around 9" = 9000000, "8.5" = 8500000); 100–9,999 means thousands ("850" = 850000). Monthly rent / HOA are dollars per month.
- Dates as YYYY-MM-DD (use the 15th for month-only, June 15 for year-only). Mortgage rate as a percent number (6.125). Never compute ARM reset or maturity dates — the server does that.
- propertyType one of single_family | condo | townhouse | estate | penthouse | villa | land | co_op. waterfront one of oceanfront | bayfront | intracoastal | canal | lake | river | any.
- Searches: "5+ beds" → bedsMin 5; "under 10" (price) → priceMax 10000000; "around 9 up to 11" → priceMin ~ 8000000, priceMax 11000000, budgetFlexible true; "Gables or the Grove" → neighborhoods ["Coral Gables","Coconut Grove"] (only explicitly named places); "must have a dock for a 70-foot boat" → waterfront ["any"] unless a water type is named, mustHaves [{feature:"Dock ≥ 70 ft", importance:"must", min:70}]; negatives ("no HOA") → dealBreakers; timeline one of asap | 30d | 90d | 6mo | 12mo | someday; financing one of cash | jumbo | 1031_exchange | bridge | preapproved | undecided.

FAIR HOUSING (mandatory): never extract, infer, store or repeat protected-class information (race, color, religion, national origin, sex, gender identity, sexual orientation, familial status such as kids, schools or pregnancy, disability, age, marital status, source of income) or demographic preferences about neighborhoods ("safe", "good schools", "family-friendly", "people like us"). Record only property attributes and explicitly named locations; drop any people-based preference.`;

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && !(Array.isArray(o[k]) && !o[k].length)).map((k) => [k, o[k]]));

function moneyGuard(v) { return v == null ? v : (v < 10000 ? normalizeBare(v) : Math.round(v)); }

async function aiParse({ text, url, target, workspaceId }) {
  if (!ai.available()) return null;
  const input = url ? `LISTING URL (do not fetch; parse its text only): ${url}${text ? `\nAGENT NOTE: ${text}` : ''}` : text;
  const hint = target === 'property' || target === 'search' ? `\nThe agent says this is a ${target}.` : '';
  try {
    const out = await Promise.race([
      ai.json({ system: AI_SYSTEM, prompt: `${input}${hint}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Return the JSON object.`, schema: AI_SCHEMA, effort: 'low', maxTokens: 4000, feature: 'portfolio_parse', workspaceId }),
      new Promise((r) => setTimeout(() => r(null), 30000)),
    ]);
    return out || null;
  } catch (err) {
    if (err && err.code !== 'ai_unavailable') console.error('[portfolio] parse AI failed:', err.message);
    return null;
  }
}

function mergeProperty(h, a, text) {
  const out = { ...h };
  if (!a) return out;
  if (a.relationship && !['owns', 'rents', 'sold', 'watching', 'leased_out'].includes(a.relationship)) a.relationship = null;
  if (a.occupancy && !['primary', 'second_home', 'investment', 'vacation', 'rental'].includes(a.occupancy)) a.occupancy = null;
  const keys = ['relationship', 'occupancy', 'street', 'unit', 'city', 'state', 'zip', 'neighborhood', 'buildingName', 'propertyType', 'architecturalStyle', 'beds', 'baths', 'sqft', 'lotSqft', 'yearBuilt', 'waterfront', 'waterFrontageFt', 'dockLengthFt', 'purchasedAt', 'soldAt', 'loanType', 'lenderName', 'leaseEndsAt', 'mlsNumber', 'thinkingOfSelling', 'boughtWithMe', 'soldWithMe'];
  for (const k of keys) {
    if (a[k] == null || a[k] === '') continue;
    if (out[k] == null || out[k] === '' || (k === 'relationship' && out[k] === 'owns')) out[k] = a[k];
  }
  for (const k of ['purchasePrice', 'estValue', 'soldPrice', 'mortgageBalance', 'taxAnnual']) {
    if (out[k] == null && a[k] != null) out[k] = moneyGuard(a[k]);
  }
  for (const k of ['rentAmount', 'hoaMonthly']) if (out[k] == null && a[k] != null) out[k] = Math.round(a[k]);
  if (out.mortgageRate == null && a.mortgageRatePct != null && a.mortgageRatePct > 0 && a.mortgageRatePct < 20) out.mortgageRate = Math.round(a.mortgageRatePct * 1000) / 100000;
  const meta = { ...(out.meta || {}) };
  if (a.armFixedYears && !meta.armFixedYears) meta.armFixedYears = a.armFixedYears;
  if (a.originatedAt && !meta.originatedAt) meta.originatedAt = a.originatedAt;
  if (a.monthlyPayment && !meta.monthlyPayment) meta.monthlyPayment = Math.round(a.monthlyPayment);
  if (Object.keys(meta).length) out.meta = meta;
  if (a.views && a.views.length) out.views = uniq([...(out.views || []), ...a.views.map((v) => v.toLowerCase())]);
  if (a.features && a.features.length) {
    const have = new Set((out.features || []).map((f) => f.name.toLowerCase()));
    out.features = [...(out.features || []), ...scrub(a.features).filter((x) => !have.has(x.toLowerCase())).map((name) => ({ name, confirmed: false, importance: 'stated' }))];
  }
  // explicit type words in the text beat the model's guess
  if (h.propertyType) out.propertyType = h.propertyType;
  return out;
}

function mergeSearch(h, a, text) {
  const out = { ...h };
  if (!a) return out;
  if (a.bucket && !['active', 'dream'].includes(a.bucket)) a.bucket = null;
  const lower = text.toLowerCase();
  // Only keep AI places that literally appear in the text (no invented areas).
  const named = (list) => (list || []).filter((x) => x && lower.includes(String(x).toLowerCase().split(/[ ,]/)[0]));
  const areas = uniq([...(out.neighborhoods || []), ...named(a.neighborhoods)]);
  if (areas.length) out.neighborhoods = areas;
  const blds = uniq([...(out.buildings || []), ...named(a.buildings)]); if (blds.length) out.buildings = blds;
  const mk = named(a.markets); if (mk.length) out.markets = uniq([...(out.markets || []), ...mk]);
  if (!out.propertyTypes && a.propertyTypes && a.propertyTypes.length) out.propertyTypes = uniq(a.propertyTypes);
  for (const k of ['bedsMin', 'bathsMin', 'sqftMin', 'lotSqftMin', 'yearBuiltMin', 'timeline', 'financing', 'name', 'bucket']) {
    if (out[k] == null && a[k] != null && a[k] !== '') out[k] = a[k];
  }
  if (a.budgetFlexible && out.budgetFlexible == null) out.budgetFlexible = true;
  if (out.priceMax == null && a.priceMax != null) out.priceMax = moneyGuard(a.priceMax);
  if (out.priceMin == null && a.priceMin != null) out.priceMin = moneyGuard(a.priceMin);
  for (const k of ['styles', 'waterfront', 'views', 'niceToHaves', 'dealBreakers']) {
    const merged = scrub(uniq([...(out[k] || []), ...(a[k] || [])]));
    if (merged.length) out[k] = merged;
  }
  if (a.mustHaves && a.mustHaves.length) {
    const have = new Set((out.mustHaves || []).map((m) => m.feature.toLowerCase()));
    const extra = a.mustHaves.filter((m) => m.feature && !PROTECTED.test(m.feature) && !have.has(m.feature.toLowerCase()))
      .map((m) => ({ feature: m.feature, importance: m.importance === 'want' ? 0.5 : 1, source: 'text', ...(m.min ? { min: m.min } : {}) }));
    const mh = [...(out.mustHaves || []), ...extra.filter((m) => m.importance >= 1)];
    const nice = extra.filter((m) => m.importance < 1).map((m) => m.feature);
    if (mh.length) out.mustHaves = mh;
    if (nice.length) out.niceToHaves = uniq([...(out.niceToHaves || []), ...nice]);
  }
  if (a.preApprovalAmount) out.criteriaRaw = { ...(out.criteriaRaw || {}), preApprovalAmount: moneyGuard(a.preApprovalAmount) };
  return out;
}

// Chips for the live preview ("firm" blue / "soft" amber, spec §5.6).
function chipsFor(kind, f) {
  const chips = [];
  const money = (v) => {
    if (v == null) return null;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
    if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${v}`;
  };
  if (kind === 'search') {
    for (const a of f.neighborhoods || []) chips.push({ key: `area:${a}`, label: a, tone: (f.neighborhoods || []).length > 1 ? 'soft' : 'firm', group: 'Area' });
    for (const b of f.buildings || []) chips.push({ key: `bld:${b}`, label: b, tone: 'firm', group: 'Building' });
    for (const t of f.propertyTypes || []) chips.push({ key: `type:${t}`, label: t.replace('_', '-').replace(/^\w/, (m) => m.toUpperCase()), tone: 'firm', group: 'Type' });
    if (f.priceMin || f.priceMax) chips.push({ key: 'price', label: f.priceMin && f.priceMax ? `${money(f.priceMin)}–${money(f.priceMax)}${f.budgetFlexible ? ' · flexible' : ''}` : f.priceMax ? `Up to ${money(f.priceMax)}${f.budgetFlexible ? ' · flexible' : ''}` : `${money(f.priceMin)}+`, tone: f.budgetFlexible ? 'soft' : 'firm', group: 'Budget' });
    if (f.bedsMin) chips.push({ key: 'beds', label: `${f.bedsMin}+ bd`, tone: 'firm', group: 'Beds' });
    if (f.bathsMin) chips.push({ key: 'baths', label: `${f.bathsMin}+ ba`, tone: 'firm', group: 'Baths' });
    if (f.sqftMin) chips.push({ key: 'sqft', label: `${Number(f.sqftMin).toLocaleString('en-US')}+ sq ft`, tone: 'firm', group: 'Size' });
    for (const w of f.waterfront || []) chips.push({ key: `wf:${w}`, label: w === 'any' ? 'Waterfront' : w.replace(/^\w/, (m) => m.toUpperCase()), tone: 'firm', group: 'Water' });
    for (const s of f.styles || []) chips.push({ key: `style:${s}`, label: s.replace(/^\w/, (m) => m.toUpperCase()), tone: 'soft', group: 'Style' });
    for (const v of f.views || []) chips.push({ key: `view:${v}`, label: `${v.replace(/^\w/, (m) => m.toUpperCase())} view`, tone: 'soft', group: 'View' });
    for (const m of f.mustHaves || []) chips.push({ key: `must:${m.feature}`, label: `${m.feature} · must`, tone: 'firm', group: 'Must-have' });
    for (const n of f.niceToHaves || []) chips.push({ key: `nice:${n}`, label: `${n.replace(/^\w/, (m) => m.toUpperCase())} · want`, tone: 'soft', group: 'Nice-to-have' });
    for (const d of f.dealBreakers || []) chips.push({ key: `no:${d}`, label: `No ${d}`, tone: 'danger', group: 'Deal-breaker' });
    if (f.timeline) chips.push({ key: 'timeline', label: { asap: 'ASAP', '30d': '30 days', '90d': '3 months', '6mo': '6 months', '12mo': '12 months', someday: 'Opportunistic' }[f.timeline] || f.timeline, tone: 'soft', group: 'Timeline' });
    if (f.financing) chips.push({ key: 'financing', label: f.financing.replace('_', ' ').replace(/^\w/, (m) => m.toUpperCase()), tone: 'soft', group: 'Financing' });
  } else {
    if (f.street) chips.push({ key: 'street', label: `${f.street}${f.unit ? ` #${f.unit}` : ''}`, tone: 'firm', group: 'Address' });
    if (f.buildingName) chips.push({ key: 'building', label: f.buildingName, tone: 'firm', group: 'Building' });
    if (f.neighborhood || f.city) chips.push({ key: 'area', label: [f.neighborhood, f.city && f.city !== f.neighborhood ? f.city : null].filter(Boolean).join(', '), tone: 'firm', group: 'Area' });
    if (f.propertyType) chips.push({ key: 'type', label: f.propertyType.replace('_', '-').replace(/^\w/, (m) => m.toUpperCase()), tone: 'firm', group: 'Type' });
    const spec = [f.beds != null ? `${f.beds} bd` : null, f.baths != null ? `${f.baths} ba` : null, f.sqft ? `${Number(f.sqft).toLocaleString('en-US')} sq ft` : null].filter(Boolean).join(' · ');
    if (spec) chips.push({ key: 'spec', label: spec, tone: 'firm', group: 'Specs' });
    if (f.waterfront) chips.push({ key: 'wf', label: [f.waterfront === 'any' ? 'Waterfront' : f.waterfront.replace(/^\w/, (m) => m.toUpperCase()), f.dockLengthFt ? `${f.dockLengthFt} ft dock` : null].filter(Boolean).join(' · '), tone: 'firm', group: 'Water' });
    if (f.estValue) chips.push({ key: 'est', label: `${money(f.estValue)} est.`, tone: 'soft', group: 'Value' });
    if (f.purchasePrice) chips.push({ key: 'paid', label: `Paid ${money(f.purchasePrice)}${f.purchasedAt ? ` · ${f.purchasedAt.slice(0, 4)}` : ''}`, tone: 'firm', group: 'Purchase' });
    if (f.soldPrice) chips.push({ key: 'sold', label: `Sold ${money(f.soldPrice)}`, tone: 'firm', group: 'Sale' });
    if (f.loanType && f.loanType !== 'cash') chips.push({ key: 'loan', label: [f.meta && f.meta.armFixedYears ? `${f.meta.armFixedYears}/1 ARM` : ({ fixed: 'Fixed', interest_only: 'Interest-only', balloon: 'Balloon', arm: 'ARM' }[f.loanType] || f.loanType), f.mortgageRate ? `${(f.mortgageRate * 100).toFixed(3).replace(/\.?0+$/, '')}%` : null, f.lenderName, f.mortgageBalance ? `owes ${money(f.mortgageBalance)}` : null].filter(Boolean).join(' · '), tone: 'firm', group: 'Loan' });
    if (f.loanType === 'cash') chips.push({ key: 'loan', label: 'Free & clear', tone: 'firm', group: 'Loan' });
    if (f.rentAmount) chips.push({ key: 'rent', label: `${money(f.rentAmount)}/mo rent`, tone: 'firm', group: 'Rent' });
    if (f.leaseEndsAt) chips.push({ key: 'lease', label: `Lease ends ${f.leaseEndsAt.slice(0, 7)}`, tone: 'firm', group: 'Lease' });
    for (const ft of f.features || []) chips.push({ key: `feat:${ft.name}`, label: ft.name, tone: ft.confirmed ? 'firm' : 'soft', group: 'Feature' });
    if (f.thinkingOfSelling) chips.push({ key: 'selling', label: 'Thinking of selling', tone: 'danger', group: 'Signal' });
  }
  return chips;
}

async function parseCapture({ text, url, target = 'auto', workspaceId }) {
  const t = String(text || '').trim();
  let u = url ? String(url).trim() : null;
  if (!u) { const inText = /(https?:\/\/[^\s)]+)/i.exec(t); if (inText && t.replace(inText[1], '').trim().length < 12) u = inText[1]; }

  if (u) {
    const parsed = parseListingUrl(u);
    if (!parsed) return { kind: target === 'search' ? 'search' : 'property', fields: {}, confidence: {}, source: 'heuristic', portal: null, chips: [], error: 'That doesn’t look like a listing link.' };
    const fields = { ...parsed.fields, source: 'listing_link' };
    const a = await aiParse({ text: t && t !== u ? t : '', url: u, target: 'property', workspaceId });
    let merged = fields;
    let source = 'heuristic';
    if (a && a.property) {
      merged = mergeProperty(fields, a.property, `${u} ${t}`);
      // the URL slug is ground truth for address parts
      for (const k of ['street', 'unit', 'zip', 'state', 'mlsNumber']) if (fields[k]) merged[k] = fields[k];
      merged.listingUrl = fields.listingUrl;
      source = 'ai';
    }
    if (target === 'search') {
      // "Wishlist from a listing link" → reference criteria around the listing.
      const s = {
        neighborhoods: merged.neighborhood ? [merged.neighborhood] : merged.city ? [merged.city] : [],
        buildings: merged.buildingName ? [merged.buildingName] : [],
        propertyTypes: merged.propertyType ? [merged.propertyType] : [],
        bedsMin: merged.beds || null,
        priceMax: merged.estValue ? Math.round(merged.estValue * 1.1) : null,
        priceMin: merged.estValue ? Math.round(merged.estValue * 0.8) : null,
        notes: `More like ${[merged.street, merged.city].filter(Boolean).join(', ') || 'this listing'} — ${u}`,
        criteriaRaw: { referenceUrl: u },
        bucket: 'active',
      };
      return { kind: 'search', fields: s, confidence: {}, source, portal: parsed.portal, chips: chipsFor('search', s) };
    }
    return { kind: 'property', fields: merged, confidence: parsed.confidence, source, portal: parsed.portal, chips: chipsFor('property', merged) };
  }

  if (!t) return { kind: target === 'search' ? 'search' : 'property', fields: {}, confidence: {}, source: 'heuristic', portal: null, chips: [] };
  const h = heuristicParse(t, target);
  const a = await aiParse({ text: t, target: target === 'auto' ? h.kind : target, workspaceId });
  let kind = h.kind;
  let fields = h.fields;
  let source = 'heuristic';
  if (a) {
    if (target === 'auto' && a.kind && a.kind !== kind) {
      kind = a.kind;
      fields = heuristicParse(t, kind).fields;
    }
    fields = kind === 'search' ? mergeSearch(fields, a.search, t) : mergeProperty(fields, a.property, t);
    source = 'ai';
  }
  if (kind === 'search') {
    for (const k of ['mustHaves']) if (fields[k]) fields[k] = fields[k].filter((m) => !PROTECTED.test(m.feature));
  }
  return { kind, fields, confidence: h.confidence, source, portal: null, chips: chipsFor(kind, fields) };
}

module.exports = { parseCapture, parseListingUrl, heuristicParse, moneyMentions, chipsFor, NEIGHBORHOODS, BUILDINGS, PROTECTED, scrub, V };

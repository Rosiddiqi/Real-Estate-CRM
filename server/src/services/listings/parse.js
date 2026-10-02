// Listing / whisper parser: free text (a whisper, an MLS printout pasted as
// text, a developer blurb) or a listing URL → structured Listing fields with a
// per-field confidence (0..1). AI when available (validated JSON), with a
// deterministic regex + vocabulary parser underneath that always runs — the
// sheet works the same without a key, just with fewer fields filled.
//
// URLs are NEVER fetched (no external requests): we read what the URL itself
// says (Zillow / Realtor / Redfin / brokerage slugs carry the address + ids).
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const V = require('../matchmaker/vocab');

const FIELD_KEYS = ['street', 'unitNumber', 'city', 'state', 'postalCode', 'neighborhood', 'buildingName', 'market', 'developmentName',
  'propertyType', 'listPrice', 'priceGuide', 'beds', 'bathsTotal', 'livingAreaSqft', 'lotSqft', 'yearBuilt', 'yearRenovated', 'stories', 'garageSpaces',
  'architecturalStyle', 'waterfront', 'waterFrontageFt', 'dockLengthFt', 'views', 'amenities', 'hoaFee', 'taxAnnual', 'mlsNumber',
  'status', 'eta', 'whisperSource', 'headline', 'listingUrl'];

const SUFFIX = '(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pl|place|ter|terrace|pkwy|parkway|cir|circle|hwy|highway|trl|trail|row|walk|path|isle|island|key|point|pt|cv|cove|run|xing|loop)';
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

const toInt = (s) => { const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? Math.round(n) : null; };
const title = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Nw|Ne|Sw|Se)\b/g, (m) => m.toUpperCase());

function parseMoneyToken(numStr, unit) {
  const n = Number(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').toLowerCase();
  if (/^(m|mm|mil|million)/.test(u)) return Math.round(n * 1e6);
  if (/^(b|bn|billion)/.test(u)) return Math.round(n * 1e9);
  if (/^(k|thousand)/.test(u)) return Math.round(n * 1e3);
  return Math.round(n);
}

async function knownPlaces(workspaceId) {
  if (!workspaceId) return [];
  try {
    const [ls, ss] = await Promise.all([
      prisma.listing.findMany({ where: { workspaceId }, select: { neighborhood: true, buildingName: true, market: true, city: true }, take: 2000 }),
      prisma.buyerSearch.findMany({ where: { workspaceId }, select: { neighborhoods: true, buildings: true, markets: true }, take: 2000 }),
    ]);
    const out = new Map();
    const add = (name, kind) => { if (name && String(name).trim().length > 2 && !out.has(V.squash(name))) out.set(V.squash(name), { name: String(name).trim(), kind }); };
    for (const l of ls) { add(l.buildingName, 'building'); add(l.neighborhood, 'neighborhood'); add(l.city, 'city'); add(l.market, 'market'); }
    for (const s of ss) { (s.buildings || []).forEach((b) => add(b, 'building')); (s.neighborhoods || []).forEach((n) => add(n, 'neighborhood')); (s.markets || []).forEach((m) => add(m, 'market')); }
    return [...out.values()].sort((a, b) => b.name.length - a.name.length);
  } catch { return []; }
}

// ── URL → fields (no fetch) ───────────────────────────────────────────────
function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const path = decodeURIComponent(u.pathname);
  const fields = { listingUrl: u.toString() };
  const conf = { listingUrl: 1 };
  const setAddr = (street, unit, city, state, zip, c = 0.9) => {
    if (street) { fields.street = title(street.replace(/-/g, ' ')).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, a, b) => a + b.toLowerCase()); conf.street = c; }
    if (unit) { fields.unitNumber = String(unit).toUpperCase(); conf.unitNumber = c; }
    if (city) { fields.city = title(city.replace(/-/g, ' ')); conf.city = c; }
    if (state) { fields.state = state.toUpperCase(); conf.state = c; }
    if (zip) { fields.postalCode = zip; conf.postalCode = c; }
  };
  let m;
  if (/zillow\.com$/.test(host) && (m = /\/homedetails\/([^/]+)\//.exec(path))) {
    const parts = m[1].split('-');
    const zipIdx = parts.findIndex((p) => /^\d{5}$/.test(p));
    if (zipIdx > 2 && STATES.has(parts[zipIdx - 1].toUpperCase())) {
      const head = parts.slice(0, zipIdx - 1);
      const sufIdx = head.findIndex((p, i) => i > 0 && new RegExp(`^${SUFFIX}$`, 'i').test(p));
      let streetEnd = sufIdx >= 0 ? sufIdx + 1 : Math.min(3, head.length - 1);
      let unit = null;
      if (/^(apt|unit|ph|#)$/i.test(head[streetEnd] || '')) { unit = head[streetEnd + 1]; streetEnd += 2; }
      setAddr(head.slice(0, sufIdx >= 0 ? sufIdx + 1 : streetEnd).join(' '), unit, head.slice(streetEnd).join(' '), parts[zipIdx - 1], parts[zipIdx]);
    }
  } else if (/realtor\.com$/.test(host) && (m = /realestateandhomes-detail\/([^/]+)/.exec(path))) {
    const seg = m[1].split('_');
    if (seg.length >= 4) {
      let street = seg[0]; let unit = null;
      const um = /^(.*?)-(?:apt|unit|ph)-?([a-z0-9]+)$/i.exec(street);
      if (um) { street = um[1]; unit = um[2]; }
      setAddr(street, unit, seg[1], seg[2], seg[3]);
    }
  } else if (/redfin\.com$/.test(host) && (m = /^\/([A-Z]{2})\/([^/]+)\/([^/]+?)-(\d{5})(?:\/unit-([^/]+))?\/home\//i.exec(path))) {
    setAddr(m[3], m[5], m[2], m[1], m[4]);
  } else {
    // generic brokerage slug: "...-miami-beach-fl-33139..."
    const slug = path.split('/').filter(Boolean).find((s) => /\d{5}/.test(s) && /-/.test(s)) || '';
    const parts = slug.split(/[-_]/);
    const zipIdx = parts.findIndex((p) => /^\d{5}$/.test(p));
    if (zipIdx > 2 && STATES.has((parts[zipIdx - 1] || '').toUpperCase())) {
      const head = parts.slice(0, zipIdx - 1);
      const sufIdx = head.findIndex((p, i) => i > 0 && new RegExp(`^${SUFFIX}$`, 'i').test(p));
      if (sufIdx > 0) setAddr(head.slice(0, sufIdx + 1).join(' '), null, head.slice(sufIdx + 1).join(' '), parts[zipIdx - 1], parts[zipIdx], 0.75);
    }
  }
  const mls = /\b([A-Z]{1,2}\d{7,9})(?=[/_-]|$)/.exec(path.replace(/_zpid.*/, ''));
  if (mls && !/zillow/.test(host)) { fields.mlsNumber = mls[1]; conf.mlsNumber = 0.6; }
  return { fields, confidence: conf, host };
}

// ── text → fields (regex + vocabulary) ───────────────────────────────────
function parseText(text, places = []) {
  const raw = String(text || '');
  const t = raw.replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  const f = {}; const c = {};
  const set = (k, v, conf) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return; if (f[k] == null) { f[k] = v; c[k] = conf; } };
  let m;

  // price / guide
  const guideRe = /(?:guide|guidance|thinking|around|about|approx(?:imately)?|~|ask(?:ing)?|list(?:ed)?(?: at)?|price(?:d)?(?: at)?|priced|offered at|in the)\s*(?:of\s*|at\s*|is\s*)?(\$)?\s*(\d+(?:[.,]\d+)?)\s*(m|mm|mil|million|k|b|bn)?\b/gi;
  const moneyRe = /\$\s*(\d+(?:[.,]\d+)*)\s*(m|mm|mil|million|k|b|bn)?\b/i;
  while ((m = guideRe.exec(t))) {
    if (!m[1] && !m[3]) continue; // "~7,200 sq ft" is not a price
    const v = parseMoneyToken(m[2], m[3]);
    if (!v || v < 100000) continue;
    if (/guide|guidance|thinking|around|about|approx|~|in the/i.test(m[0])) set('priceGuide', v, 0.7);
    else set('listPrice', v, 0.75);
    break;
  }
  if (f.listPrice == null && f.priceGuide == null && (m = moneyRe.exec(t))) {
    const v = parseMoneyToken(m[1], m[2]);
    if (v && v >= 100000) set('listPrice', v, 0.7);
  }
  // beds / baths
  if ((m = /(\d{1,2})\s*(?:-|\s)?(?:bed(?:room)?s?|br|bd|bdrm)\b/i.exec(t))) set('beds', Number(m[1]), 0.85);
  else if ((m = /\b(one|two|three|four|five|six|seven|eight|nine|ten)[ -]bed(?:room)?/i.exec(t))) set('beds', ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].indexOf(m[1].toLowerCase()) + 1, 0.8);
  if ((m = /(\d{1,2})\s*full\s*(?:\/|and|&|,)\s*(\d)\s*half/i.exec(t))) set('bathsTotal', Number(m[1]) + 0.5 * Number(m[2]), 0.85);
  else if ((m = /(\d{1,2}(?:\.\d)?)\s*(?:-|\s)?(?:bath(?:room)?s?|ba)\b/i.exec(t))) set('bathsTotal', Number(m[1]), 0.85);
  // lot first (so "18,000 sf lot" isn't read as interior)
  if ((m = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:acre|acres|ac)\b/i.exec(t))) set('lotSqft', Math.round(Number(m[1]) * 43560), 0.8);
  else if ((m = /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(?:sq\.?\s*ft\.?|sqft|sf|square\s*f(?:ee|oo)t)\s*(?:lot|parcel)/i.exec(t)) || (m = /lot(?:\s*size)?\s*(?:of\s*)?:?\s*(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(?:sq|sf)/i.exec(t))) set('lotSqft', toInt(m[1]), 0.75);
  const sqftRe = /(\d{1,3}(?:,\d{3})+|\d{3,6})\s*\+?\s*(?:interior\s*|living\s*|adjusted\s*|total\s*)?(?:sq\.?\s*ft\.?|sqft|sf|square\s*f(?:ee|oo)t)(?!\s*(?:lot|parcel))/gi;
  while ((m = sqftRe.exec(t))) {
    const v = toInt(m[1]);
    if (v && v >= 400 && v !== f.lotSqft) { set('livingAreaSqft', v, 0.8); break; }
  }
  // years
  if ((m = /(?:renovated|remodeled|restored|updated)\s*(?:in\s*)?((?:19|20)\d{2})/i.exec(t))) set('yearRenovated', Number(m[1]), 0.75);
  if ((m = /(?:built|completed|constructed|delivered|delivering|built in)\s*(?:in\s*)?((?:19|20)\d{2})/i.exec(t)) || (m = /((?:19|20)\d{2})\s*(?:build|construction|built)\b/i.exec(t))) set('yearBuilt', Number(m[1]), 0.75);
  if (/new construction|brand new|never lived in|pre-?construction/i.test(t) && f.yearBuilt == null) set('yearBuilt', new Date().getFullYear(), 0.5);
  // type, style, water
  const type = V.canonicalType(low.match(/penthouse|townhouse|townhome|villa|estate|condo(?:minium)?|co-?op|single[- ]family|vacant land|lot\b|house|home/)?.[0] || '');
  if (type) set('propertyType', type, /penthouse|townhouse|townhome|condo|co-?op|single[- ]family|estate/.test(low) ? 0.8 : 0.5);
  const famHit = Object.entries(V.STYLE_FAMILIES).flatMap(([, list]) => list).sort((a, b) => b.length - a.length).find((p) => V.hasPhrase(V.squash(t), V.squash(p)));
  const ambiguousStyle = famHit && /^(island|key west|french|english|italian|spanish|mountain|international|classical)$/.test(famHit);
  if (famHit && (!ambiguousStyle || /style|architecture|revival|villa|estate|home|house/.test(low))) set('architecturalStyle', title(famHit), 0.65);
  const wfHit = low.match(/oceanfront|ocean front|beachfront|direct ocean|bayfront|bay front|on the bay|intracoastal|on the icw|deep[- ]water|canal[- ]front|on a canal|lakefront|lake front|riverfront|waterfront|on the water/);
  if (wfHit) {
    const w = V.canonicalWaterfront(wfHit[0].replace(/^on the |^on a /, ''));
    if (w) set('waterfront', w, 0.8);
  }
  if ((m = /(\d{2,3})\s*(?:-|\s)?(?:ft|foot|feet|')\s*(?:of\s*)?(?:dock(?:age)?|slip|boat slip)/i.exec(t)) || (m = /dock\D{0,20}(\d{2,3})\s*(?:ft|feet|')/i.exec(t))) set('dockLengthFt', Number(m[1]), 0.75);
  if ((m = /(\d{2,4})\s*(?:ft|feet|')\s*(?:of\s*)?(?:water\s*|ocean\s*|bay\s*)?frontage/i.exec(t))) set('waterFrontageFt', Number(m[1]), 0.75);
  // views
  const views = new Set();
  const viewRe = /(?:views?\s+(?:of|over|to)\s+(?:the\s+)?([a-z ]{3,24}))|(?:([a-z]{3,14})(?:\s+and\s+([a-z]{3,14}))?\s+views?)/gi;
  while ((m = viewRe.exec(low))) {
    for (const g of [m[1], m[2], m[3]]) {
      const k = g && V.viewKeyFromText(g);
      if (k && k !== 'water' && k !== 'pool') views.add(k);
      else if (k === 'water') views.add('water');
    }
  }
  if (views.size) set('views', [...views], 0.7);
  // amenities
  const keys = V.amenityKeys([t]);
  for (const k of ['waterfront', 'no_hoa', 'new_construction', 'privacy', 'office']) keys.delete(k);
  if (keys.size) set('amenities', [...keys].map(V.amenityLabel), 0.7);
  // garage / stories / hoa / tax
  if ((m = /(\d{1,2})\s*-?\s*car\s+(?:garage|gallery)/i.exec(t))) set('garageSpaces', Number(m[1]), 0.8);
  if (/single[- ](?:story|level)|one[- ]story/i.test(t)) set('stories', 1, 0.75);
  else if ((m = /(\d)\s*-?\s*(?:story|stories|level)\b/i.exec(t))) set('stories', Number(m[1]), 0.7);
  if ((m = /hoa\D{0,12}\$\s*(\d[\d,]*)/i.exec(t))) set('hoaFee', toInt(m[1]), 0.7);
  if ((m = /tax(?:es)?\D{0,12}\$\s*(\d[\d,]*)/i.exec(t))) set('taxAnnual', toInt(m[1]), 0.65);
  // ids + address
  if ((m = /\bmls\s*(?:#|no\.?|number|id)?\s*:?\s*([A-Z]{0,3}\d{5,10})\b/i.exec(t)) || (m = /\b([A-Z]\d{7,9})\b/.exec(t))) set('mlsNumber', m[1].toUpperCase(), 0.8);
  const addrRe = new RegExp(`(?<![\\w,.$~#-])\\b(\\d{1,6})\\s+((?:[NSEW]\\.?\\s+)?(?:[A-Za-z0-9.'-]+\\s+){1,4}?${SUFFIX})\\b\\.?`, 'i');
  if ((m = addrRe.exec(t))) set('street', title(`${m[1]} ${m[2]}`), 0.7);
  if ((m = /\b(?:unit|apt|residence|ph|penthouse)\s*#?\s*-?\s*([A-Z]{0,3}-?\d{1,5}[A-Z]?)\b/i.exec(t)) && !/^mls/i.test(m[0])) set('unitNumber', m[1].toUpperCase(), 0.6);
  // places: buildings / neighborhoods / cities the workspace already knows
  const sq = V.squash(t);
  for (const p of places) {
    if (!V.hasPhrase(sq, V.squash(p.name))) continue;
    if (p.kind === 'building') set('buildingName', p.name, 0.7);
    else if (p.kind === 'neighborhood') set('neighborhood', p.name, 0.7);
    else if (p.kind === 'city') set('city', p.name, 0.6);
    else if (p.kind === 'market') set('market', p.name, 0.6);
  }
  // whisper-specific
  if (/coming soon|quietly|off[- ]market|pocket|before it hits|not on the market|pre-?market/i.test(t)) set('status', 'coming_soon', 0.7);
  if ((m = /\b(after the holidays|(?:this|next|early|late)\s+(?:spring|summer|fall|autumn|winter|month|year|quarter)|in the (?:spring|summer|fall|autumn|winter|new year)|(?:in|within)\s+(?:a few|\d+)\s+(?:weeks?|months?)|q[1-4](?:\s+\d{4})?|early\s+\d{4}|(?:in\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)\b/i.exec(t))) set('eta', m[1].replace(/^in\s+(?:the\s+)?/i, ''), 0.7);
  if (/developer|builder|sales (?:center|gallery)|pre-?construction/i.test(t)) set('whisperSource', 'developer', 0.7);
  else if (/broker(?:'s)? open|caravan|broker preview/i.test(t)) set('whisperSource', 'broker_open', 0.7);
  else if (/\bowner\b|homeowner|the sellers?\b|my client owns/i.test(t)) set('whisperSource', 'owner', 0.6);
  else if (/agent|colleague|listing broker|another broker|heard from/i.test(t)) set('whisperSource', 'agent', 0.55);
  return { fields: f, confidence: c };
}

// ── AI ───────────────────────────────────────────────────────────────────
const SYSTEM = `You turn an agent's note, a pasted listing, or a listing URL into structured fields for a luxury real-estate CRM. Return JSON only.

RULES
- Only fill a field the input states or clearly implies; otherwise null (or [] for lists) with confidence 0.
- confidence per field 0..1: 0.9+ stated verbatim, 0.6–0.85 clearly implied, below 0.5 a guess.
- Money in whole US dollars ("$4.25M" → 4250000). A price the source calls a guide / rumor / "thinking around" goes in priceGuide, not listPrice.
- propertyType one of: single_family, condo, townhouse, estate, penthouse, villa, land, co_op.
- waterfront one of: oceanfront, bayfront, intracoastal, canal, lake, river, none.
- views: short lowercase words (ocean, bay, intracoastal, city, golf, park, garden, lake, marina).
- amenities: short title-case names (Pool, Dock, Boat lift, Gated, Private elevator, Guest house, Wine room, Generator, Smart home, Home theater, Gym, Spa, Tennis court, Beach access, Impact windows, Summer kitchen, Rooftop terrace, Concierge).
- status: coming_soon for whispers / off-market / pocket notes, else active.
- eta: free text exactly as said ("spring", "after the holidays"), never invent a date.
- whisperSource: agent | developer | owner | broker_open, only if stated.
- For a URL you CANNOT open the page: read only what the URL text itself says (address, city, state, zip, ids).
- Never record anything about the owner's personal life or who they are; only the property.
${V.FAIR_HOUSING}`;

const SCHEMA = (() => {
  const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
  const props = {
    street: str, unitNumber: str, city: str, state: str, postalCode: str, neighborhood: str, buildingName: str, market: str, developmentName: str,
    propertyType: str, listPrice: num, priceGuide: num, beds: num, bathsTotal: num, livingAreaSqft: num, lotSqft: num, yearBuilt: num, yearRenovated: num,
    stories: num, garageSpaces: num, architecturalStyle: str, waterfront: str, waterFrontageFt: num, dockLengthFt: num,
    views: { type: 'array', items: { type: 'string' } }, amenities: { type: 'array', items: { type: 'string' } },
    hoaFee: num, taxAnnual: num, mlsNumber: str, status: str, eta: str, whisperSource: str, headline: str,
  };
  return {
    type: 'object',
    properties: {
      fields: { type: 'object', properties: props },
      confidence: { type: 'object', properties: Object.fromEntries(Object.keys(props).map((k) => [k, { type: 'number' }])) },
    },
  };
})();

function normalizeFields(f) {
  const out = {};
  for (const k of FIELD_KEYS) {
    let v = f[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (['listPrice', 'priceGuide', 'beds', 'livingAreaSqft', 'lotSqft', 'yearBuilt', 'yearRenovated', 'stories', 'garageSpaces', 'waterFrontageFt', 'dockLengthFt', 'hoaFee', 'taxAnnual'].includes(k)) {
      v = Number(v); if (!Number.isFinite(v) || v <= 0) continue; v = Math.round(v);
    }
    if (k === 'bathsTotal') { v = Number(v); if (!Number.isFinite(v) || v <= 0) continue; v = Math.round(v * 2) / 2; }
    if (k === 'propertyType') { v = V.canonicalType(v); if (!v) continue; }
    if (k === 'waterfront') { v = V.canonicalWaterfront(v); if (!v) continue; }
    if (k === 'views') v = [...new Set(v.map((x) => V.canonicalView(x)).filter(Boolean))];
    if (k === 'amenities') v = [...new Set(v.map((x) => { const key = V.normalizeAmenity(x); return key ? V.amenityLabel(key) : String(x).trim(); }).filter(Boolean))];
    if (k === 'status' && !['coming_soon', 'active', 'off_market'].includes(v)) continue;
    if (k === 'whisperSource' && !['agent', 'developer', 'owner', 'broker_open'].includes(v)) continue;
    out[k] = v;
  }
  return out;
}

async function parseListing({ workspaceId, text, url, mode = 'listing' } = {}) {
  const places = await knownPlaces(workspaceId);
  const fromUrl = url ? parseUrl(url) : null;
  const fromText = text ? parseText(text, places) : { fields: {}, confidence: {} };
  const base = { fields: { ...(fromUrl ? fromUrl.fields : {}) }, confidence: { ...(fromUrl ? fromUrl.confidence : {}) } };
  for (const [k, v] of Object.entries(fromText.fields)) if (base.fields[k] == null) { base.fields[k] = v; base.confidence[k] = fromText.confidence[k]; }

  let usedAi = false;
  if (ai.available() && (text || url)) {
    try {
      const prompt = [
        mode === 'whisper' ? 'KIND: a whisper (off-market intel the agent heard).' : 'KIND: a listing the agent is adding.',
        url ? `URL: ${url}` : null,
        text ? `TEXT:\n${String(text).slice(0, 6000)}` : null,
        places.length ? `PLACES THIS AGENT WORKS (use exact spelling when one is meant): ${places.slice(0, 80).map((p) => p.name).join(', ')}` : null,
      ].filter(Boolean).join('\n\n');
      const out = await ai.json({ system: SYSTEM, prompt, schema: SCHEMA, effort: 'low', maxTokens: 8000, feature: mode === 'whisper' ? 'whisper_parse' : 'listing_parse', workspaceId });
      if (out && out.fields) {
        usedAi = true;
        const af = normalizeFields(out.fields);
        for (const [k, v] of Object.entries(af)) {
          const cf = Number(out.confidence && out.confidence[k]);
          const conf = Number.isFinite(cf) ? Math.max(0, Math.min(1, cf)) : 0.6;
          if (conf < 0.4) continue;
          if (base.fields[k] == null || conf >= (base.confidence[k] || 0)) { base.fields[k] = v; base.confidence[k] = conf; }
        }
      }
    } catch (err) {
      if (err && err.code !== 'ai_unavailable') console.warn('[listings] AI parse failed, heuristic only:', err.message);
    }
  }
  const fields = normalizeFields(base.fields);
  if (mode === 'whisper') { if (!fields.status) fields.status = 'coming_soon'; delete fields.listPrice; if (base.fields.listPrice && !fields.priceGuide) fields.priceGuide = base.fields.listPrice; }
  const confidence = Object.fromEntries(Object.keys(fields).map((k) => [k, Math.round((base.confidence[k] ?? 0.6) * 100) / 100]));
  if (mode === 'whisper' && fields.priceGuide && confidence.priceGuide == null) confidence.priceGuide = base.confidence.listPrice || 0.6;
  return { fields, confidence, ai: usedAi, source: url ? 'url' : 'text' };
}

module.exports = { parseListing, parseText, parseUrl, knownPlaces };

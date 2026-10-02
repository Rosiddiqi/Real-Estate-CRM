// Audience resolver — the segment builder's filter → the clients who get it.
//
// Campaign.audience shape (all optional):
//   groups:        ['everyone'|'buyers'|'sellers'|'owners'|'investors'|'renters'|
//                   'landlords'|'developers'|'sphere'|'past_clients'|'whales'|'leads'|'active']  (OR)
//   types, statuses, tags, neighborhoods: string[]   (each ANDed, OR within)
//   minRating:     0..5
//   whales, pastClients, sphere: boolean            (ANDed refinements)
//   buyersIn:      { neighborhoods:[], priceMin, priceMax }   active buyer searches overlapping
//   ownersIn:      { neighborhoods:[] }                       owns a home there
//   clientIds:     string[]  explicit adds (union)
//   excludedIds:   string[]  removed by the agent
//   text:          the agent's plain-English description
// Always excluded: opted out (textOptOut), blocked, archived, no phone,
// do-not-text tags, partners/vendors (unless added by id).
//
// Fair Housing: filters are property attributes, price, relationship and
// explicitly named places only. Text that targets a protected class is refused.
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const { clientName } = require('../../lib/clients');
const { FAIR_HOUSING_RE } = require('./constants');

const GROUPS = {
  everyone: 'Everyone', buyers: 'Buyers', sellers: 'Sellers', owners: 'Homeowners', investors: 'Investors',
  renters: 'Renters', landlords: 'Landlords', developers: 'Developers', sphere: 'Sphere',
  past_clients: 'Past clients', whales: 'Whales', leads: 'Leads', active: 'Active clients',
};
const TYPES = ['buyer', 'seller', 'buyer_seller', 'investor', 'renter', 'landlord', 'developer', 'sphere'];
const STATUSES = ['lead', 'active', 'past_client', 'sphere', 'inactive'];
const WHALE_VOLUME = 10000000;
const DNT_RE = /^(do[\s_-]?not[\s_-]?text|dnt|no[\s_-]?texts?|do[\s_-]?not[\s_-]?contact)$/i;

const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

function normalizeAudience(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const buyersIn = a.buyersIn && typeof a.buyersIn === 'object'
    ? { neighborhoods: arr(a.buyersIn.neighborhoods), priceMin: num(a.buyersIn.priceMin), priceMax: num(a.buyersIn.priceMax) }
    : null;
  const ownersIn = a.ownersIn && typeof a.ownersIn === 'object' ? { neighborhoods: arr(a.ownersIn.neighborhoods) } : null;
  return {
    groups: arr(a.groups).filter((g) => GROUPS[g]),
    types: arr(a.types).filter((t) => TYPES.includes(t)),
    statuses: arr(a.statuses).filter((s) => STATUSES.includes(s)),
    tags: arr(a.tags),
    neighborhoods: arr(a.neighborhoods),
    minRating: Math.max(0, Math.min(5, Number(a.minRating) || 0)),
    whales: !!a.whales,
    pastClients: !!a.pastClients,
    sphere: !!a.sphere,
    buyersIn: buyersIn && (buyersIn.neighborhoods.length || buyersIn.priceMin || buyersIn.priceMax || a.buyersIn.enabled) ? buyersIn : null,
    ownersIn: ownersIn && (ownersIn.neighborhoods.length || a.ownersIn.enabled) ? ownersIn : null,
    clientIds: arr(a.clientIds),
    excludedIds: arr(a.excludedIds),
    text: typeof a.text === 'string' ? a.text.slice(0, 500) : '',
  };
}

function hasFilter(a) {
  return !!(a.groups.length || a.types.length || a.statuses.length || a.tags.length || a.neighborhoods.length
    || a.minRating || a.whales || a.pastClients || a.sphere || a.buyersIn || a.ownersIn);
}

const whaleWhere = { OR: [{ isWhale: true }, { lifetimeVolume: { gte: WHALE_VOLUME } }] };
const pastWhere = { OR: [{ status: 'past_client' }, { transactionsCount: { gt: 0 } }, { lastClosedAt: { not: null } }] };
const sphereWhere = { OR: [{ type: 'sphere' }, { status: 'sphere' }] };

function groupWhere(g) {
  switch (g) {
    case 'everyone': return {};
    case 'buyers': return { OR: [{ type: { in: ['buyer', 'buyer_seller', 'investor'] } }, { searches: { some: { status: 'active' } } }] };
    case 'sellers': return { OR: [{ type: { in: ['seller', 'buyer_seller'] } }, { properties: { some: { thinkingOfSelling: true } } }] };
    case 'owners': return { properties: { some: { relationship: 'owns' } } };
    case 'investors': return { type: 'investor' };
    case 'renters': return { OR: [{ type: 'renter' }, { properties: { some: { relationship: 'rents' } } }] };
    case 'landlords': return { OR: [{ type: 'landlord' }, { properties: { some: { relationship: 'leased_out' } } }] };
    case 'developers': return { type: 'developer' };
    case 'sphere': return sphereWhere;
    case 'past_clients': return pastWhere;
    case 'whales': return whaleWhere;
    case 'leads': return { status: 'lead' };
    case 'active': return { status: 'active' };
    default: return null;
  }
}

function searchOverlap(b) {
  const and = [{ status: 'active' }];
  if (b.neighborhoods.length) and.push({ neighborhoods: { hasSome: b.neighborhoods } });
  if (b.priceMin) and.push({ OR: [{ priceMax: null }, { priceMax: { gte: b.priceMin } }] });
  if (b.priceMax) and.push({ OR: [{ priceMin: null }, { priceMin: { lte: b.priceMax } }] });
  return { searches: { some: { AND: and } } };
}

// Prisma where for the FILTER part (before exclusions).
function filterWhere(workspaceId, a) {
  const and = [{ workspaceId }, { contactKind: 'client' }];
  if (a.groups.length && !a.groups.includes('everyone')) and.push({ OR: a.groups.map(groupWhere).filter(Boolean) });
  if (a.types.length) and.push({ type: { in: a.types } });
  if (a.statuses.length) and.push({ status: { in: a.statuses } });
  if (a.tags.length) and.push({ tags: { hasSome: a.tags } });
  if (a.neighborhoods.length) {
    and.push({ OR: [
      { neighborhood: { in: a.neighborhoods } },
      { properties: { some: { neighborhood: { in: a.neighborhoods } } } },
      { searches: { some: { neighborhoods: { hasSome: a.neighborhoods } } } },
    ] });
  }
  if (a.minRating) and.push({ rating: { gte: a.minRating } });
  if (a.whales) and.push(whaleWhere);
  if (a.pastClients) and.push(pastWhere);
  if (a.sphere) and.push(sphereWhere);
  if (a.buyersIn) and.push(searchOverlap(a.buyersIn));
  if (a.ownersIn) and.push({ properties: { some: { relationship: 'owns', ...(a.ownersIn.neighborhoods.length ? { neighborhood: { in: a.ownersIn.neighborhoods } } : {}) } } });
  return { AND: and };
}

function audienceWhere(workspaceId, raw) {
  const a = normalizeAudience(raw);
  const ors = [];
  if (hasFilter(a)) ors.push(filterWhere(workspaceId, a));
  if (a.clientIds.length) ors.push({ workspaceId, id: { in: a.clientIds } });
  if (!ors.length) return null;
  return ors.length === 1 ? ors[0] : { OR: ors };
}

function exclusionReason(c) {
  if (c.textOptOut) return 'optedOut';
  if (c.blocked) return 'blocked';
  if (c.archivedAt) return 'archived';
  if (!c.phone) return 'noPhone';
  if ((c.tags || []).some((t) => DNT_RE.test(String(t).trim()))) return 'doNotText';
  return null;
}

function priceShort(n) {
  if (!n) return '';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '')}M`;
  return `$${Math.round(n / 1e3)}K`;
}

function headlineFor(c) {
  const bits = [];
  if (c.isWhale || (c.lifetimeVolume || 0) >= WHALE_VOLUME) bits.push('Whale');
  const owned = (c.properties || []).find((p) => p.relationship === 'owns');
  const search = (c.searches || []).find((s) => s.status === 'active');
  if (search) {
    const where = (search.neighborhoods || [])[0] || (search.markets || [])[0];
    const band = search.priceMax ? `${search.priceMin ? `${priceShort(search.priceMin)}–` : 'up to '}${priceShort(search.priceMax)}` : '';
    bits.push(`Searching${where ? ` ${where}` : ''}${band ? ` · ${band}` : ''}`);
  } else if (owned) {
    bits.push(`Owns in ${owned.neighborhood || owned.city || 'the area'}`);
  } else if (c.status === 'past_client') bits.push('Past client');
  else if (c.type) bits.push(c.type.replace('_', ' / ').replace(/^\w/, (x) => x.toUpperCase()));
  return bits.join(' · ');
}

const PERSON_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, avatarUrl: true,
  type: true, status: true, rating: true, isWhale: true, lifetimeVolume: true, neighborhood: true, city: true,
  tags: true, textOptOut: true, blocked: true, archivedAt: true, deviceMode: true, lastInboundAt: true,
  properties: { select: { relationship: true, neighborhood: true, city: true }, take: 4 },
  searches: { where: { status: 'active' }, select: { status: true, neighborhoods: true, markets: true, priceMin: true, priceMax: true }, take: 1 },
};

function toPerson(c) {
  return {
    id: c.id, name: clientName(c), firstName: c.firstName || clientName(c).split(' ')[0], phone: c.phone,
    avatarUrl: c.avatarUrl, rating: c.rating, isWhale: !!(c.isWhale || (c.lifetimeVolume || 0) >= WHALE_VOLUME),
    type: c.type, status: c.status, neighborhood: c.neighborhood, channel: c.deviceMode === 'sms' ? 'sms' : 'imessage',
    headline: headlineFor(c),
  };
}

// -> { count, people:[…], excluded:{optedOut,blocked,noPhone,doNotText,archived,manual}, excludedPeople:[…], matched }
async function resolveAudience(workspaceId, raw, { limit = 1000 } = {}) {
  const a = normalizeAudience(raw);
  const where = audienceWhere(workspaceId, a);
  const excluded = { optedOut: 0, blocked: 0, noPhone: 0, doNotText: 0, archived: 0, manual: 0 };
  if (!where) return { count: 0, people: [], excluded, excludedPeople: [], matched: 0 };
  const rows = await prisma.client.findMany({ where, select: PERSON_SELECT, orderBy: [{ rating: 'desc' }, { lastName: 'asc' }], take: 5000 });
  const manual = new Set(a.excludedIds);
  const people = [];
  const excludedPeople = [];
  const seen = new Set();
  for (const c of rows) {
    if (seen.has(c.id)) continue; // dedupe
    seen.add(c.id);
    const why = exclusionReason(c);
    if (why) { excluded[why] += 1; continue; }
    if (manual.has(c.id)) { excluded.manual += 1; excludedPeople.push(toPerson(c)); continue; }
    people.push(toPerson(c));
  }
  return { count: people.length, people: people.slice(0, limit), excluded, excludedPeople, matched: rows.length };
}

// Distinct pick-lists for the segment builder.
async function audienceOptions(workspaceId) {
  const [clients, props, searches] = await Promise.all([
    prisma.client.findMany({ where: { workspaceId, contactKind: 'client', archivedAt: null }, select: { neighborhood: true, tags: true, type: true, status: true, isWhale: true, lifetimeVolume: true, transactionsCount: true } }),
    prisma.portfolioProperty.findMany({ where: { workspaceId }, select: { neighborhood: true, relationship: true } }),
    prisma.buyerSearch.findMany({ where: { workspaceId, status: 'active' }, select: { neighborhoods: true } }),
  ]);
  const hood = new Map();
  const bump = (n, w = 1) => { if (n && n.trim()) hood.set(n.trim(), (hood.get(n.trim()) || 0) + w); };
  clients.forEach((c) => bump(c.neighborhood));
  props.forEach((p) => bump(p.neighborhood));
  searches.forEach((s) => (s.neighborhoods || []).forEach((n) => bump(n)));
  const ownedHoods = new Map();
  props.filter((p) => p.relationship === 'owns').forEach((p) => { if (p.neighborhood) ownedHoods.set(p.neighborhood, (ownedHoods.get(p.neighborhood) || 0) + 1); });
  const searchHoods = new Map();
  searches.forEach((s) => (s.neighborhoods || []).forEach((n) => searchHoods.set(n, (searchHoods.get(n) || 0) + 1)));
  const tags = new Map();
  clients.forEach((c) => (c.tags || []).forEach((t) => { if (!DNT_RE.test(t)) tags.set(t, (tags.get(t) || 0) + 1); }));
  const sortMap = (m) => [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([value, count]) => ({ value, count }));
  const typeCounts = {};
  clients.forEach((c) => { typeCounts[c.type] = (typeCounts[c.type] || 0) + 1; });
  return {
    groups: Object.entries(GROUPS).map(([value, label]) => ({ value, label })),
    types: TYPES.map((t) => ({ value: t, label: t === 'buyer_seller' ? 'Buyer + seller' : t.charAt(0).toUpperCase() + t.slice(1), count: typeCounts[t] || 0 })),
    statuses: STATUSES.map((s) => ({ value: s, label: s === 'past_client' ? 'Past client' : s.charAt(0).toUpperCase() + s.slice(1) })),
    neighborhoods: sortMap(hood),
    ownerNeighborhoods: sortMap(ownedHoods),
    searchNeighborhoods: sortMap(searchHoods),
    tags: sortMap(tags),
  };
}

function describeAudience(raw) {
  const a = normalizeAudience(raw);
  const parts = [];
  if (a.groups.length) parts.push(a.groups.map((g) => GROUPS[g]).join(' or '));
  if (a.types.length) parts.push(a.types.map((t) => t.replace('_', '/')).join(', '));
  if (a.buyersIn) {
    const band = a.buyersIn.priceMin || a.buyersIn.priceMax ? ` ${a.buyersIn.priceMin ? priceShort(a.buyersIn.priceMin) : ''}–${a.buyersIn.priceMax ? priceShort(a.buyersIn.priceMax) : ''}` : '';
    parts.push(`Searching${a.buyersIn.neighborhoods.length ? ` ${a.buyersIn.neighborhoods.join(', ')}` : ''}${band}`);
  }
  if (a.ownersIn) parts.push(`Owners${a.ownersIn.neighborhoods.length ? ` in ${a.ownersIn.neighborhoods.join(', ')}` : ''}`);
  if (a.neighborhoods.length) parts.push(a.neighborhoods.join(', '));
  if (a.whales) parts.push('Whales');
  if (a.pastClients) parts.push('Past clients');
  if (a.sphere) parts.push('Sphere');
  if (a.minRating) parts.push(`${a.minRating}★+`);
  if (a.tags.length) parts.push(a.tags.map((t) => `#${t}`).join(' '));
  if (a.clientIds.length) parts.push(`+${a.clientIds.length} added`);
  return parts.join(' · ');
}

// ── Plain English → filter ─────────────────────────────────────────────
function parsePrice(s) {
  const m = String(s || '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k|thousand)?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit.startsWith('m')) v *= 1e6; else if (unit.startsWith('k') || unit === 'thousand') v *= 1e3;
  else if (v < 100) v *= 1e6; // "3 to 6" in a price context = millions
  return Math.round(v);
}

function keywordResolve(text, options) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const a = { groups: [], neighborhoods: [], tags: [], minRating: 0 };
  const has = (re) => re.test(t);
  if (has(/\b(everyone|everybody|all (of )?my (clients|contacts|book)|whole book|entire book|all clients)\b/)) a.groups.push('everyone');
  if (has(/\b(buyers?|looking to buy|in the market|searching|house ?hunting)\b/)) a.groups.push('buyers');
  if (has(/\b(sellers?|thinking (of|about) selling|listing leads?)\b/)) a.groups.push('sellers');
  if (has(/\b(home ?owners?|owners?)\b/)) a.groups.push('owners');
  if (has(/\binvestors?\b/)) a.groups.push('investors');
  if (has(/\b(renters?|tenants?)\b/)) a.groups.push('renters');
  if (has(/\blandlords?\b/)) a.groups.push('landlords');
  if (has(/\bdevelopers?\b/)) a.groups.push('developers');
  if (has(/\b(sphere|friends|soi|people i know)\b/)) a.groups.push('sphere');
  if (has(/\b(past clients?|former clients?|closed with me|bought with me|sold with me)\b/)) a.groups.push('past_clients');
  if (has(/\b(whales?|top clients?|biggest clients?|vips?|high[- ]net)\b/)) a.whales = true;
  if (has(/\b(leads?|prospects?)\b/)) a.groups.push('leads');
  const stars = t.match(/(\d)\s*(\+|\s*stars?|★)/);
  if (stars) a.minRating = Math.min(5, parseInt(stars[1], 10));
  for (const n of (options.neighborhoods || [])) {
    const name = n.value.toLowerCase();
    if (name.length >= 3 && t.includes(name)) a.neighborhoods.push(n.value);
  }
  for (const tag of (options.tags || [])) {
    if (tag.value.length >= 3 && new RegExp(`(#|\\b)${tag.value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) a.tags.push(tag.value);
  }
  // Price band → buyers searching in that band.
  let priceMin = null; let priceMax = null;
  const range = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k)?\s*(?:-|–|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k)?/);
  if (range) { priceMin = parsePrice(`${range[1]}${range[2] || range[4] || ''}`); priceMax = parsePrice(`${range[3]}${range[4] || ''}`); }
  const under = t.match(/\b(under|below|up to|max(?:imum)?)\s+\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k)?/);
  if (under) priceMax = parsePrice(`${under[2]}${under[3] || ''}`);
  const over = t.match(/\b(over|above|at least|min(?:imum)?|\$?\d+(?:\.\d+)?\s*(?:m|mm|million)?\s*\+)\s*\$?\s*(\d+(?:\.\d+)?)?\s*(m|mm|million|k)?/);
  if (over && over[2]) priceMin = parsePrice(`${over[2]}${over[3] || ''}`);
  const plus = t.match(/\$\s*(\d+(?:\.\d+)?)\s*(m|mm|million)\s*\+/);
  if (plus) priceMin = parsePrice(`${plus[1]}${plus[2]}`);
  const buyerish = a.groups.includes('buyers') || /\b(searching|looking)\b/.test(t);
  if ((priceMin || priceMax) && (buyerish || !a.groups.length)) {
    a.buyersIn = { neighborhoods: buyerish ? a.neighborhoods : [], priceMin, priceMax };
    a.groups = a.groups.filter((g) => g !== 'buyers');
    if (buyerish) a.neighborhoods = [];
  } else if (a.neighborhoods.length && a.groups.includes('owners')) {
    a.ownersIn = { neighborhoods: a.neighborhoods };
    a.groups = a.groups.filter((g) => g !== 'owners');
    a.neighborhoods = [];
  } else if (a.neighborhoods.length && a.groups.includes('buyers') && !a.groups.some((g) => g !== 'buyers')) {
    a.buyersIn = { neighborhoods: a.neighborhoods, priceMin: null, priceMax: null };
    a.groups = [];
    a.neighborhoods = [];
  }
  a.groups = [...new Set(a.groups)];
  return a;
}

const AI_SCHEMA = {
  type: 'object',
  properties: {
    groups: { type: 'array', items: { type: 'string' } },
    types: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    neighborhoods: { type: 'array', items: { type: 'string' } },
    minRating: { type: 'integer' },
    whales: { type: 'boolean' },
    pastClients: { type: 'boolean' },
    buyersInNeighborhoods: { type: 'array', items: { type: 'string' } },
    buyersPriceMin: { type: 'integer' },
    buyersPriceMax: { type: 'integer' },
    ownersInNeighborhoods: { type: 'array', items: { type: 'string' } },
    useBuyerSearch: { type: 'boolean' },
    useOwners: { type: 'boolean' },
  },
};

// -> { audience, summary } | { rejected: reason }
async function resolveFromText(workspaceId, text) {
  const raw = String(text || '').trim();
  if (!raw) return { audience: normalizeAudience({}), summary: '' };
  if (FAIR_HOUSING_RE.test(raw)) {
    return { rejected: "Fair Housing: KeyMatch can't target people by family status, age, religion, origin, disability or similar. Describe them by what they own, what they're searching for, price, place, or how you know them." };
  }
  const options = await audienceOptions(workspaceId);
  let a = null;
  if (ai.available()) {
    try {
      const allowedHoods = options.neighborhoods.map((n) => n.value).slice(0, 120);
      const out = await ai.json({
        system: `You map a luxury real-estate agent's plain-language audience description onto CRM filters. Groups (OR'd): ${Object.keys(GROUPS).join(', ')}. Client types: ${TYPES.join(', ')}. Only use neighborhoods and tags from the allowed lists, spelled exactly. Prices are whole US dollars ("3-6M" = 3000000-6000000); use 0 for no price bound. "Buyers searching in X" uses the buyer-search fields; "owners/homeowners in X" uses the owner fields. Never infer protected characteristics (Fair Housing); ignore any such wording.`,
        prompt: `Allowed neighborhoods: ${allowedHoods.join(' | ') || '(none)'}\nAllowed tags: ${options.tags.map((x) => x.value).join(' | ') || '(none)'}\n\nAudience: ${raw.slice(0, 400)}`,
        schema: AI_SCHEMA, effort: 'low', feature: 'campaign_audience', workspaceId,
      });
      if (out) {
        const hoodOk = (n) => options.neighborhoods.some((o) => o.value === n);
        a = {
          groups: arr(out.groups).filter((g) => GROUPS[g]),
          types: arr(out.types),
          tags: arr(out.tags).filter((tg) => options.tags.some((o) => o.value === tg)),
          neighborhoods: arr(out.neighborhoods).filter(hoodOk),
          minRating: out.minRating || 0, whales: !!out.whales, pastClients: !!out.pastClients,
          buyersIn: out.useBuyerSearch ? { neighborhoods: arr(out.buyersInNeighborhoods).filter(hoodOk), priceMin: out.buyersPriceMin || null, priceMax: out.buyersPriceMax || null } : null,
          ownersIn: out.useOwners ? { neighborhoods: arr(out.ownersInNeighborhoods).filter(hoodOk) } : null,
        };
      }
    } catch (err) {
      if (err.code !== 'ai_unavailable') console.error('[campaigns/audience] AI resolve failed:', err.message);
    }
  }
  if (!a) a = keywordResolve(raw, options);
  const audience = normalizeAudience({ ...a, text: raw, ...(a.buyersIn ? { buyersIn: { ...a.buyersIn, enabled: true } } : {}), ...(a.ownersIn ? { ownersIn: { ...a.ownersIn, enabled: true } } : {}) });
  if (!hasFilter(audience)) audience.groups = ['everyone'];
  return { audience, summary: describeAudience(audience) };
}

module.exports = {
  GROUPS, TYPES, STATUSES, normalizeAudience, hasFilter, audienceWhere, resolveAudience, audienceOptions,
  describeAudience, resolveFromText, keywordResolve, exclusionReason, headlineFor, PERSON_SELECT, toPerson,
};

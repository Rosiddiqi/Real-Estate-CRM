// Listing → API shapes. One place decides lanes, colors, privacy-aware titles
// and the derived numbers (DOM, $/sq ft, drop %), so the Listings page, the
// Matchmaker, the client card and Serena all read a listing the same way.
const V = require('../matchmaker/vocab');
const { bathsOf, sqftOf, lotSqftOf, typeOf, priceOf } = require('../matchmaker/score');

const DAY = 864e5;

// Lanes = the source sections on the Listings page.
const LANES = [
  { id: 'mine', label: 'My Listings', short: 'Mine', color: '#F2A93B' },
  { id: 'mls', label: 'MLS Feed', short: 'MLS', color: '#2E8BFF' },
  { id: 'pocket', label: 'Pocket & Coming Soon', short: 'Pocket', color: '#9A4DFF' },
  { id: 'whisper', label: 'Whispers', short: 'Whispers', color: '#30D27A' },
  { id: 'newdev', label: 'New Development', short: 'New Dev', color: '#32D4F5' },
];
const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l]));

function laneOf(l) {
  const o = String(l.origin || '').toLowerCase();
  if (o === 'whisper') return 'whisper';
  // an agent's own pocket / new-dev units keep their private lane (their
  // privacy + badges matter more than "mine"); "mine" = own public listings
  if (o === 'pocket') return 'pocket';
  if (o === 'development') return 'newdev';
  if (l.isOwnListing || o === 'own') return 'mine';
  if (String(l.status) === 'coming_soon') return 'pocket';
  return 'mls';
}

const STATUS_LABEL = {
  coming_soon: 'Coming soon', active: 'Active', under_contract: 'Under contract', pending: 'Pending', sold: 'Sold',
  withdrawn: 'Withdrawn', expired: 'Expired', off_market: 'Off market',
};

function daysOnMarket(l, now = Date.now()) {
  const start = l.listedAt || (String(l.origin) === 'feed' ? l.firstSeenAt : null) || l.createdAt;
  if (!start) return null;
  const end = (l.status === 'sold' && l.soldAt) ? new Date(l.soldAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(start).getTime()) / DAY));
}

function photosOf(l) {
  const list = Array.isArray(l.photoUrls) ? l.photoUrls.filter(Boolean) : [];
  if (l.heroPhoto && !list.includes(l.heroPhoto)) list.unshift(l.heroPhoto);
  else if (l.heroPhoto && list[0] !== l.heroPhoto) { list.splice(list.indexOf(l.heroPhoto), 1); list.unshift(l.heroPhoto); }
  return list;
}

function streetLine(l) {
  if (!l.street) return null;
  return `${l.street}${l.unitNumber ? ` #${String(l.unitNumber).replace(/^#/, '')}` : ''}`;
}

// What kind of home, in words: "5-bedroom oceanfront estate"
function descriptor(l) {
  const t = typeOf(l);
  const typeWord = !t ? 'residence' : t === 'single_family' ? 'home' : t === 'land' ? 'homesite' : V.typeLabel(t).toLowerCase();
  const wf = V.canonicalWaterfront(l.waterfront);
  const water = wf && wf !== 'none' ? `${(V.WATERFRONT_LABEL[wf] || 'waterfront').toLowerCase()} ` : '';
  const beds = l.beds ? `${l.beds}-bedroom ` : '';
  return `${beds}${water}${typeWord}`.replace(/\s+/g, ' ').trim();
}

// Privacy-aware title for the agent UI. hideAddress → building / descriptive.
function titleOf(l) {
  if (l.title) return l.title;
  const lane = laneOf(l);
  if (lane === 'whisper') {
    const where = l.buildingName || l.neighborhood || l.city;
    const d = descriptor(l);
    return `${d.charAt(0).toUpperCase()}${d.slice(1)}${where ? ` · ${where}` : ''}`;
  }
  if (l.hideAddress) {
    if (l.buildingName) return `${l.buildingName}${l.unitLine ? ` · ${l.unitLine} line` : ''}`;
    const d = descriptor(l);
    return `Private ${d}`.replace(/Private (\d)/, 'Private $1');
  }
  const st = streetLine(l);
  if (st) return st;
  if (l.buildingName) return `${l.buildingName}${l.unitNumber ? ` #${l.unitNumber}` : ''}`;
  if (l.developmentName) return l.developmentName;
  const d = descriptor(l);
  return `${d.charAt(0).toUpperCase()}${d.slice(1)}`;
}

function subtitleOf(l) {
  const t = typeOf(l);
  const where = l.neighborhood || l.city || l.market;
  const parts = [];
  if (where) parts.push(where);
  if (t) parts.push(V.typeLabel(t));
  else if (l.propertyType) parts.push(String(l.propertyType).replace(/_/g, ' '));
  return parts.join(' · ');
}

// How the listing is described to a CLIENT (drafts, public page): never an
// address for whispers / hidden pockets.
function clientLabel(l) {
  const lane = laneOf(l);
  if (lane === 'whisper' || l.hideAddress) {
    const where = (lane !== 'whisper' && l.buildingName) || l.neighborhood || l.city || l.market;
    return `${descriptor(l)}${where ? ` in ${where}` : ''}`;
  }
  if (l.buildingName) {
    const unit = l.unitNumber ? `residence ${String(l.unitNumber).replace(/^#/, '')} at ` : '';
    return `${unit}${l.buildingName}`;
  }
  const st = streetLine(l);
  if (st) return `${st}${l.neighborhood ? ` in ${l.neighborhood}` : ''}`;
  return `${descriptor(l)}${l.neighborhood ? ` in ${l.neighborhood}` : ''}`;
}

function badgesOf(l, lane) {
  const out = [];
  if (lane === 'pocket') out.push(l.status === 'coming_soon' ? 'COMING SOON' : 'POCKET');
  else if (l.status === 'coming_soon' && lane !== 'whisper') out.push('COMING SOON');
  if (lane === 'newdev') out.push('NEW DEV');
  if (lane === 'whisper') out.push('WHISPER');
  return out;
}

// Seeds / feeds may store canonical keys ("boat_lift") — show labels.
function amenityDisplay(a) {
  const raw = String(a || '').trim();
  if (!/^[a-z0-9_]+$/.test(raw)) return raw;
  return (V.AMENITIES[raw] && V.AMENITIES[raw].label) || V.humanize(raw);
}

function cardShape(l, extra = {}) {
  const lane = laneOf(l);
  const laneMeta = LANE_BY_ID[lane];
  const price = Number(l.listPrice) || null;
  const prev = Number(l.previousPrice) || null;
  const dropAmount = prev && price && prev > price ? prev - price : null;
  const orig = Number(l.originalListPrice) || null;
  const sqft = sqftOf(l);
  const lot = lotSqftOf(l);
  const t = typeOf(l);
  return {
    id: l.id,
    lane,
    laneLabel: laneMeta.label,
    // lane colors are the vocabulary (chips, section heads, dots) — a source's
    // own color (bootstrap palette differs) would make MLS and Whisper collide
    laneColor: laneMeta.color,
    origin: l.origin,
    status: l.status,
    statusLabel: STATUS_LABEL[l.status] || l.status,
    isOwnListing: !!l.isOwnListing,
    badges: badgesOf(l, lane),
    title: titleOf(l),
    subtitle: subtitleOf(l),
    clientLabel: clientLabel(l),
    street: l.street, unitNumber: l.unitNumber, city: l.city, state: l.state, postalCode: l.postalCode,
    neighborhood: l.neighborhood, buildingName: l.buildingName, market: l.market, developmentName: l.developmentName,
    hideAddress: !!l.hideAddress,
    propertyType: t || l.propertyType || null,
    typeLabel: t ? V.typeLabel(t) : (l.propertyType || null),
    listPrice: price,
    originalListPrice: orig,
    previousPrice: prev,
    priceDroppedAt: l.priceDroppedAt,
    dropAmount,
    dropPct: dropAmount ? Math.round((dropAmount / prev) * 1000) / 10 : null,
    cumulativeDrop: orig && price && orig > price ? orig - price : null,
    priceGuide: lane === 'whisper' ? (Number(l.priceGuide) || null) : null,
    pricePerSqft: price && sqft ? Math.round(price / sqft) : null,
    beds: l.beds,
    baths: bathsOf(l),
    bathsFull: l.bathsFull, bathsHalf: l.bathsHalf,
    sqft,
    lotSqft: lot,
    lotAcres: l.lotAcres || (lot ? Math.round((lot / 43560) * 100) / 100 : null),
    yearBuilt: l.yearBuilt, yearRenovated: l.yearRenovated,
    architecturalStyle: l.architecturalStyle, styleFamily: V.styleFamily(l.styleFamily) || V.styleFamily(l.architecturalStyle),
    waterfront: V.canonicalWaterfront(l.waterfront) || null,
    waterfrontLabel: (() => { const w = V.canonicalWaterfront(l.waterfront); return w && w !== 'none' ? V.WATERFRONT_LABEL[w] : null; })(),
    views: (l.views || []).filter(Boolean),
    amenities: [...new Set((l.amenities || []).filter(Boolean).map(amenityDisplay))],
    photos: photosOf(l),
    listedAt: l.listedAt || null,
    dom: daysOnMarket(l),
    sourceId: l.sourceId,
    sourceName: (l.source && l.source.name) || laneMeta.label,
    sourceKind: l.source && l.source.kind,
    publicSlug: l.publicSlug,
    eta: l.eta,
    whisperSource: l.whisperSource,
    floor: l.floor, unitLine: l.unitLine,
    mlsNumber: l.mlsNumber,
    createdAt: l.createdAt, updatedAt: l.updatedAt,
    ...extra,
  };
}

function detailShape(l, extra = {}) {
  return {
    ...cardShape(l),
    description: l.description,
    headline: l.headline,
    parcelNumber: l.parcelNumber,
    lat: l.lat, lng: l.lng,
    propertySubType: l.propertySubType,
    stories: l.stories, garageSpaces: l.garageSpaces,
    waterFrontageFt: l.waterFrontageFt, dockLengthFt: l.dockLengthFt,
    amenityFlags: l.amenityFlags || {},
    hasFeatureSheet: !!l.hasFeatureSheet, featureSheetUrl: l.featureSheetUrl,
    hoaFee: l.hoaFee, hoaFrequency: l.hoaFrequency, taxAnnual: l.taxAnnual,
    virtualTourUrl: l.virtualTourUrl, listingUrl: l.listingUrl,
    listAgentName: l.listAgentName, listOfficeName: l.listOfficeName,
    ownerClientId: l.ownerClientId,
    closePrice: l.closePrice, soldAt: l.soldAt,
    confidence: l.confidence || null,
    priceGuideRaw: l.priceGuide,
    priceEvents: (l.priceEvents || []).map((e) => ({ id: e.id, fromPrice: e.fromPrice, toPrice: e.toPrice, changedAt: e.changedAt })),
    ...extra,
  };
}

// Specialty-thesis tier for tile ordering: price band desc, waterfront, newest.
function tierRank(card) {
  const p = Number(card.listPrice || card.priceGuide || 0);
  const band = p >= 20e6 ? 0 : p >= 10e6 ? 1 : p >= 5e6 ? 2 : p >= 3e6 ? 3 : 4;
  const water = card.waterfront && card.waterfront !== 'none' ? 0 : 1;
  const listed = card.listedAt || card.createdAt;
  const age = listed ? Math.min(9999, Math.floor((Date.now() - new Date(listed).getTime()) / DAY)) : 9999;
  return band * 1e5 + water * 1e4 + age;
}

module.exports = { amenityDisplay, LANES, LANE_BY_ID, laneOf, titleOf, subtitleOf, clientLabel, descriptor, cardShape, detailShape, daysOnMarket, photosOf, tierRank, streetLine, STATUS_LABEL, priceOf };

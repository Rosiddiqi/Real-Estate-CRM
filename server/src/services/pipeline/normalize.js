// Normalized deal — the ONE shape every consumer sees (REST, realtime
// broadcasts, Serena tools). Joins the client, listing and portfolio property,
// derives phase/labels/stale/DOM/closing countdown from stages.js and the live
// commission estimate from commission.js + the cap-year state.
const prisma = require('../../lib/prisma');
const S = require('./stages');
const C = require('./commission');
const { pricingContext } = require('./plan');

const WHALE_VOLUME = 10000000;

const CLIENT_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, rating: true, isWhale: true, avatarUrl: true,
  phone: true, email: true, lifetimeVolume: true, lifetimeGci: true, transactionsCount: true, lastClosedAt: true,
  type: true, status: true,
};
const LISTING_SELECT = {
  id: true, street: true, unitNumber: true, city: true, state: true, neighborhood: true, buildingName: true, title: true,
  heroPhoto: true, photoUrls: true, listPrice: true, closePrice: true, mlsNumber: true, status: true, beds: true,
  bathsTotal: true, livingAreaSqft: true, listedAt: true, isOwnListing: true, developmentName: true, propertyType: true,
  hideAddress: true,
};
const PROPERTY_SELECT = {
  id: true, clientId: true, relationship: true, street: true, unit: true, city: true, neighborhood: true, buildingName: true,
  heroPhoto: true, photos: true, estValue: true, purchasePrice: true, mlsNumber: true, listingId: true, beds: true,
  baths: true, sqft: true, nickname: true,
};

function clientName(c) {
  if (!c) return 'Unknown';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || c.phone || 'Unknown';
}

function listingAddress(l) {
  if (!l) return null;
  const street = l.street ? `${l.street}${l.unitNumber ? ` #${l.unitNumber}` : ''}` : null;
  return street || l.buildingName || l.developmentName || l.title || null;
}
function propertyAddress(p) {
  if (!p) return null;
  const street = p.street ? `${p.street}${p.unit ? ` #${p.unit}` : ''}` : null;
  return street || p.buildingName || p.nickname || null;
}

function isoOrNull(d) { return d ? new Date(d).toISOString() : null; }

async function buildContext(workspaceId, deals, pricing) {
  const clientIds = [...new Set(deals.map((d) => d.clientId).filter(Boolean))];
  const listingIds = [...new Set(deals.map((d) => d.listingId).filter(Boolean))];
  const propertyIds = [...new Set(deals.map((d) => d.portfolioPropertyId).filter(Boolean))];
  const [clients, listings, properties, px] = await Promise.all([
    clientIds.length ? prisma.client.findMany({ where: { workspaceId, id: { in: clientIds } }, select: CLIENT_SELECT }) : [],
    listingIds.length ? prisma.listing.findMany({ where: { workspaceId, id: { in: listingIds } }, select: LISTING_SELECT }) : [],
    propertyIds.length ? prisma.portfolioProperty.findMany({ where: { workspaceId, id: { in: propertyIds } }, select: PROPERTY_SELECT }) : [],
    pricing ? Promise.resolve(pricing) : pricingContext(workspaceId),
  ]);
  return {
    ...px,
    clients: new Map(clients.map((c) => [c.id, c])),
    listings: new Map(listings.map((l) => [l.id, l])),
    properties: new Map(properties.map((p) => [p.id, p])),
  };
}

function clientSummary(c) {
  if (!c) return null;
  const lifetimeVolume = c.lifetimeVolume || 0;
  return {
    id: c.id,
    name: clientName(c),
    firstName: c.firstName || clientName(c).split(' ')[0],
    lastName: c.lastName || '',
    rating: c.rating || 0,
    isWhale: !!c.isWhale,
    whale: !!c.isWhale || lifetimeVolume >= WHALE_VOLUME,
    avatarUrl: c.avatarUrl || null,
    phone: c.phone || null,
    email: c.email || null,
    lifetimeVolume,
    lifetimeGci: c.lifetimeGci || 0,
    transactions: c.transactionsCount || 0,
    type: c.type || null,
  };
}

function normalizeDeal(d, ctx) {
  if (!d) return null;
  const now = ctx.now || new Date();
  const side = d.side || 'buyer';
  const sInfo = S.sideInfo(side);
  const stage = d.stage;
  const phase = S.phaseOf(stage);
  const { label, sub } = S.labelFor(stage, side);
  const client = ctx.clients.get(d.clientId) || d.client || null;
  const listing = d.listingId ? ctx.listings.get(d.listingId) || null : null;
  const property = d.portfolioPropertyId ? ctx.properties.get(d.portfolioPropertyId) || null : null;
  const est = C.estimate(d, ctx.plan, ctx.ytd);
  const odds = S.odds(stage);
  const t = S.timing(d, now, { listedAt: listing && listing.isOwnListing ? listing.listedAt : null });
  const ex = d.extras && typeof d.extras === 'object' ? d.extras : {};
  const lAddr = listingAddress(listing);
  const pAddr = propertyAddress(property);
  const address = d.propertyAddress || lAddr || pAddr || null;
  const addressLine2 = listing
    ? [listing.buildingName && listing.buildingName !== address ? listing.buildingName : null, listing.neighborhood || listing.city].filter(Boolean).join(' · ') || null
    : property ? [property.buildingName, property.neighborhood || property.city].filter(Boolean).join(' · ') || null : null;
  const photo = (listing && (listing.heroPhoto || (listing.photoUrls || [])[0]))
    || (property && (property.heroPhoto || (property.photos || [])[0]))
    || ex.photo || null;
  const inv = S.INVENTORY_TYPES.find((x) => x.id === d.inventoryType) || S.INVENTORY_TYPES[0];
  const cs = clientSummary(client);
  return {
    id: d.id,
    clientId: d.clientId,
    name: cs ? cs.name : 'Unknown',
    title: d.title || null,
    side,
    sideLabel: sInfo.label,
    sideChip: sInfo.chip,
    group: sInfo.group,
    family: sInfo.family,
    inventoryType: d.inventoryType || 'resale',
    inventoryLabel: inv.label,
    inventoryChip: inv.chip,
    track: d.track || 'main',
    stage,
    subStatus: d.subStatus || null,
    phase,
    label,
    stageSub: sub,
    color: S.colorFor(stage),
    stageChangedAt: isoOrNull(d.stageChangedAt),
    stageAge: t.stageAge,
    stale: t.stale,
    staleDays: t.staleDays,
    dom: t.dom,
    closing: t.closing,
    next: S.nextStage({ stage, side, track: d.track }),
    price: est.price,
    priceCaption: C.priceCaption(d),
    priceField: C.priceField(d),
    rawPrice: d.price ?? null,
    listPrice: d.listPrice ?? null,
    contractPrice: d.contractPrice ?? null,
    salePrice: d.salePrice ?? null,
    rate: est.rate,
    sideRate: d.sideRate ?? null,
    listRate: d.listRate ?? null,
    buyRate: d.buyRate ?? null,
    commissionFlat: d.commissionFlat ?? null,
    splitShare: d.splitShare ?? 1,
    referralOutPct: d.referralOutPct ?? null,
    coopBonus: d.coopBonus ?? null,
    monthlyRent: d.monthlyRent ?? null,
    grossCommission: d.grossCommission ?? null,
    commission: d.commission ?? null,
    booked: d.commission != null,
    estimates: {
      sideGci: est.sideGci,
      gci: est.myGci,
      net: est.estimatedNet != null ? est.estimatedNet : est.net,
      companyDollar: est.companyDollar,
      franchise: est.franchise,
      fee: est.fee,
      team: est.team,
      referralOut: est.referralOut,
      coopBonus: est.coopBonus,
      split: est.split,
      capped: est.capped,
      sides: est.sides,
      volume: est.volume,
      odds,
      weightedNet: Math.round((est.estimatedNet != null ? est.estimatedNet : est.net) * odds),
    },
    probability: odds,
    contractDate: isoOrNull(d.contractDate),
    closingDate: isoOrNull(d.closingDate),
    inspectionDeadline: isoOrNull(d.inspectionDeadline),
    appraisalDeadline: isoOrNull(d.appraisalDeadline),
    financingDeadline: isoOrNull(d.financingDeadline),
    contingencies: d.contingencies || {},
    finishSelectionDue: isoOrNull(d.finishSelectionDue),
    estCompletion: isoOrNull(d.estCompletion),
    depositSchedule: d.depositSchedule || {},
    listingId: d.listingId || null,
    portfolioPropertyId: d.portfolioPropertyId || null,
    address,
    addressLine2,
    propertyLabel: d.propertyLabel || null,
    mlsNumber: (listing && listing.mlsNumber) || (property && property.mlsNumber) || ex.mlsNumber || null,
    photo,
    listing: listing ? {
      id: listing.id,
      address: lAddr,
      heroPhoto: listing.heroPhoto || (listing.photoUrls || [])[0] || null,
      price: listing.listPrice ?? null,
      mlsNumber: listing.mlsNumber || null,
      status: listing.status,
      beds: listing.beds ?? null,
      baths: listing.bathsTotal ?? null,
      sqft: listing.livingAreaSqft ?? null,
      neighborhood: listing.neighborhood || listing.city || null,
      isOwnListing: !!listing.isOwnListing,
      listedAt: isoOrNull(listing.listedAt),
    } : null,
    property: property ? {
      id: property.id,
      address: pAddr,
      relationship: property.relationship,
      heroPhoto: property.heroPhoto || (property.photos || [])[0] || null,
      estValue: property.estValue ?? null,
    } : null,
    shortlist: Array.isArray(d.shortlist) ? d.shortlist : [],
    client: cs,
    linkedDealId: d.linkedDealId || null,
    lenderName: d.lenderName || null,
    titleCompany: d.titleCompany || null,
    coAgentName: d.coAgentName || null,
    coAgentBrokerage: d.coAgentBrokerage || null,
    leadSource: d.leadSource || null,
    lostReason: d.lostReason || null,
    lostNote: d.lostNote || null,
    lostAt: isoOrNull(d.lostAt),
    closedAt: isoOrNull(d.closedAt),
    archivedAt: isoOrNull(d.archivedAt),
    notes: d.notes || null,
    extras: ex,
    position: d.position ?? 0,
    createdAt: isoOrNull(d.createdAt),
    updatedAt: isoOrNull(d.updatedAt),
  };
}

async function normalizeMany(workspaceId, deals, pricing) {
  if (!deals.length) return [];
  const ctx = await buildContext(workspaceId, deals, pricing);
  return deals.map((d) => normalizeDeal(d, ctx));
}

async function normalizeOne(workspaceId, deal, pricing) {
  if (!deal) return null;
  const [n] = await normalizeMany(workspaceId, [deal], pricing);
  return n;
}

module.exports = {
  WHALE_VOLUME,
  CLIENT_SELECT,
  LISTING_SELECT,
  PROPERTY_SELECT,
  clientName,
  listingAddress,
  propertyAddress,
  clientSummary,
  buildContext,
  normalizeDeal,
  normalizeMany,
  normalizeOne,
};

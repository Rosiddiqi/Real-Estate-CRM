// Row builders (part A): clients, listings (+ price events), portfolio,
// searches, deals (+ events, commissions). All take the shared state `S`.
const { uid, phone, photoSet, geo, round, DAY, img } = require('./util');

const MARKET = (city) => (['Palm Beach', 'Jupiter Island', 'Boca Raton'].includes(city) ? 'Palm Beach County'
  : city === 'Fort Lauderdale' || city === 'Weston' ? 'Broward County' : 'Miami-Dade');

// Recursively apply relative-date templates to every string.
function deepT(ctx, v) {
  if (typeof v === 'string') return ctx.t(v);
  if (Array.isArray(v)) return v.map((x) => deepT(ctx, x));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deepT(ctx, x);
    return out;
  }
  return v;
}

// Drop null/undefined so optional Json columns never receive a bare null.
function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

const fmtMoney = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/0$/, '').replace(/\.$/, '')}M` : `$${Math.round(n / 1e3)}K`);

// ── Clients ───────────────────────────────────────────────────────────────
function buildClients(S, defs) {
  const { ctx, rng, WS } = S;
  S.clientDefs = {};
  S.clientId = {};
  const rows = [];
  for (const raw of defs) {
    const d = deepT(ctx, raw);
    S.clientDefs[d.key] = d;
    const id = uid(`client:${d.key}`);
    S.clientId[d.key] = id;
    const g = d.neighborhood ? geo(d.neighborhood) : {};
    const created = new Date(ctx.now.getTime() - (d.since || 30) * DAY - rng.int(1, 9) * 3600e3);
    rows.push({
      id, workspaceId: WS, firstName: d.firstName, lastName: d.lastName || '', displayName: d.displayName,
      phone: phone(d.phone), phoneAlt: phone(d.phoneAlt), email: d.email, company: d.company, jobTitle: d.jobTitle,
      type: d.type || 'buyer', contactKind: d.contactKind || 'client', vendorRole: d.vendorRole, status: d.status || 'lead',
      rating: d.rating || 0, isWhale: !!d.isWhale, leadSource: d.leadSource, tags: d.tags || [],
      street: d.street, unit: d.unit, city: d.city !== undefined ? d.city : g.city, state: d.state !== undefined ? d.state : (g.state || (d.neighborhood ? 'FL' : null)),
      zip: d.zip || g.zip, neighborhood: d.neighborhood, birthday: d.birthday, personal: d.personal || {},
      preferredChannel: d.preferredChannel, deviceMode: d.deviceMode, deviceModeReason: d.deviceModeReason,
      financing: d.financing, preApprovalAmount: d.preApprovalAmount, preApprovalExpires: d.preApprovalExpires, lenderName: d.lenderName,
      timeline: d.timeline, motivation: d.motivation, purchasePower: d.purchasePower, aiSummary: d.aiSummary,
      aiSummaryAt: d.aiSummary ? new Date(ctx.now.getTime() - rng.int(40, 900) * 60000) : null, aiFacts: d.aiFacts,
      textOptOut: false, createdAt: created,
    });
  }
  return rows;
}

// ── Listings ──────────────────────────────────────────────────────────────
function listingAddress(l) {
  const unit = l.unitNumber ? (/^(PH|Residence)/i.test(l.unitNumber) ? ` ${l.unitNumber}` : ` #${l.unitNumber}`) : '';
  return [`${l.street || ''}${unit}`.trim(), l.city, l.state && l.postalCode ? `${l.state} ${l.postalCode}` : l.state].filter(Boolean).join(', ');
}

function buildListings(S, defs) {
  const { ctx, rng, WS, sources } = S;
  S.listingDefs = {};
  S.listingId = {};
  S.listingRow = {};
  const rows = [];
  const events = [];
  defs.forEach((raw, i) => {
    const d = deepT(ctx, raw);
    const id = uid(`listing:${d.key}`);
    S.listingDefs[d.key] = d;
    S.listingId[d.key] = id;
    const origin = d.origin || 'feed';
    const g = geo(d.neighborhood, rng);
    const unitLabel = d.unitNumber ? (/^PH/i.test(d.unitNumber) ? d.unitNumber : `Residence ${d.unitNumber}`) : null;
    const title = d.title || (d.buildingName && unitLabel ? `${d.buildingName} · ${unitLabel}` : d.street);
    const { photos, heroPhoto } = photoSet(i, d.propertyType, d.photos || 4);
    const lotSqft = d.lotSqft || (d.lotAcres ? Math.round(d.lotAcres * 43560) : null);
    const lotAcres = d.lotAcres || (lotSqft ? +(lotSqft / 43560).toFixed(2) : null);

    let listedAt = d.dom ? ctx.at(-d.dom, 9, 30) : null;
    const soldDeal = d.soldDeal ? S.closedPlan[d.soldDeal] : null;
    let soldAt = null;
    if (soldDeal) { soldAt = soldDeal.at; listedAt = new Date(soldDeal.at.getTime() - 96 * DAY); }
    const firstSeenAt = listedAt || ctx.at(-(d.heard || (origin === 'whisper' ? 14 : 3)), 10, 0);

    let previousPrice = null; let priceDroppedAt = null; let originalListPrice = d.listPrice || null;
    if (d.drop) {
      previousPrice = d.drop.from;
      priceDroppedAt = ctx.past(-d.drop.daysAgo, 9, 12);
      originalListPrice = (d.drop.earlier && d.drop.earlier[0] && d.drop.earlier[0].from) || d.drop.from;
      for (const e of d.drop.earlier || []) events.push({ id: uid(`lpe:${d.key}:${e.daysAgo}`), listingId: id, fromPrice: e.from, toPrice: e.to, changedAt: ctx.past(-e.daysAgo, 9, 5) });
      events.push({ id: uid(`lpe:${d.key}:${d.drop.daysAgo}`), listingId: id, fromPrice: d.drop.from, toPrice: d.listPrice, changedAt: priceDroppedAt });
    }

    const KEY_AM = ['pool', 'dock', 'elevator', 'gated', 'guest_house', 'wine_room', 'generator', 'boat_lift', 'gym', 'spa'];
    const amenities = d.amenities || [];
    const amenityFlags = {};
    for (const k of KEY_AM) {
      if (amenities.includes(k)) amenityFlags[k] = true;
      else amenityFlags[k] = origin === 'feed' && ['generator', 'wine_room', 'guest_house'].includes(k) ? null : false;
    }
    const slug = d.slug || (origin === 'own' && !['withdrawn'].includes(d.status)) ? rng.slug(10) : null;
    const mlsNumber = d.mls || (origin === 'own' && d.status !== 'withdrawn' ? `A116${String(rng.int(10000, 99999))}` : (origin === 'own' ? `A115${String(rng.int(10000, 99999))}` : null));

    const row = {
      id, workspaceId: WS, sourceId: sources[d.src || 'mls'], origin, isOwnListing: origin === 'own',
      mlsNumber, title, headline: d.headline, description: d.description,
      street: d.street, unitNumber: d.unitNumber, city: g.city, state: g.state, postalCode: g.zip, neighborhood: d.neighborhood, buildingName: d.buildingName,
      market: MARKET(g.city), lat: g.lat, lng: g.lng, hideAddress: !!d.hideAddress, status: d.status || 'active',
      propertyType: d.propertyType, propertySubType: d.propertySubType, listPrice: d.listPrice, originalListPrice, previousPrice, priceDroppedAt,
      closePrice: d.closePrice, beds: d.beds, bathsFull: d.bathsFull, bathsHalf: d.bathsHalf || 0,
      bathsTotal: d.bathsFull != null ? d.bathsFull + 0.5 * (d.bathsHalf || 0) : null, livingAreaSqft: d.sqft, lotSqft, lotAcres,
      yearBuilt: d.yearBuilt, yearRenovated: d.yearRenovated, stories: d.stories || (['condo', 'penthouse'].includes(d.propertyType) ? 1 : 2), garageSpaces: d.garage,
      architecturalStyle: d.style, styleFamily: d.family, waterfront: d.waterfront, waterFrontageFt: d.frontage, dockLengthFt: d.dock,
      views: d.views || [], amenities, amenityFlags, hoaFee: d.hoaFee, hoaFrequency: d.hoaFee ? 'monthly' : null,
      taxAnnual: d.taxAnnual || (d.listPrice ? round(d.listPrice * 0.0148, 100) : null), listedAt, soldAt,
      photoUrls: photos, heroPhoto, hasFeatureSheet: !!d.featureSheet, listAgentName: d.agent ? d.agent[0] : null, listOfficeName: d.agent ? d.agent[1] : null,
      ownerClientId: d.owner ? S.clientId[d.owner] : null, developmentName: d.developmentName, floor: d.floor, unitLine: d.unitLine,
      publicSlug: slug, promotedAt: origin === 'own' && listedAt && d.status === 'active' ? new Date(listedAt.getTime() + DAY) : null,
      priceGuide: d.priceGuide, eta: d.eta, whisperSource: d.whisperSource, confidence: d.confidence,
      firstSeenAt, lastSeenAt: soldAt || (d.status === 'withdrawn' ? ctx.at(-38, 12) : ctx.minsAgo(rng.int(20, 300))),
      droppedAt: d.status === 'withdrawn' ? ctx.at(-38, 12) : null, createdAt: firstSeenAt,
    };
    row.fullAddress = listingAddress(row);
    S.listingRow[d.key] = row;
    rows.push(row);
  });
  return { rows, events };
}

// ── Portfolio ─────────────────────────────────────────────────────────────
function buildPortfolio(S, defs) {
  const { ctx, rng, WS } = S;
  S.propId = {};
  const rows = [];
  defs.forEach((raw, i) => {
    const d = deepT(ctx, raw);
    const id = uid(`pp:${d.key}`);
    S.propId[d.key] = id;
    const L = d.listing ? S.listingRow[d.listing] : null;
    const LD = d.listing ? S.listingDefs[d.listing] : null;
    const deal = d.deal ? S.closedPlan[d.deal] : null;
    const g = d.neighborhood ? geo(d.neighborhood, rng) : (L ? { city: L.city, state: L.state, zip: L.postalCode, lat: L.lat, lng: L.lng } : {});
    const watching = d.relationship === 'watching';
    const src = (watching ? LD : d) || {};
    const propertyType = d.propertyType || (LD && LD.propertyType);

    let purchasePrice = d.purchasePrice || null; let purchasedAt = null;
    let boughtWithMe = false; let soldWithMe = false; let soldPrice = null; let soldAt = null; let purchasedDealId = null;
    if (deal && d.role === 'bought') { purchasePrice = deal.salePrice; purchasedAt = deal.at; boughtWithMe = true; purchasedDealId = uid(`deal:${d.deal}`); }
    if (d.bought) purchasedAt = ctx.yearsBack(d.bought[0], d.bought[1], 11).date;
    if (deal && d.role === 'sold') { soldPrice = deal.salePrice; soldAt = deal.at; soldWithMe = true; }

    let estValue = d.estValue || null;
    if (!estValue && purchasePrice) estValue = round(purchasePrice * (d.appreciation || 1), 5000);
    if (watching && L) estValue = L.listPrice || L.priceGuide;
    if (d.relationship === 'sold') estValue = soldPrice;
    const ltvBalance = d.ltv && purchasePrice ? round(purchasePrice * d.ltv * 0.985, 1000) : null;
    const hasLoan = d.mortgageBalance || ltvBalance;
    const { photos, heroPhoto } = L ? { photos: L.photoUrls, heroPhoto: L.heroPhoto } : photoSet(i + 5, propertyType, d.photos || 3);

    const createdAt = boughtWithMe ? new Date(Math.max(purchasedAt.getTime() + 3600e3, Math.min(purchasedAt.getTime() + DAY, ctx.now.getTime() - 2 * 3600e3)))
      : new Date(Math.max(ctx.now.getTime() - (S.clientDefs[d.client].since || 30) * DAY + 2 * DAY, ctx.now.getTime() - 400 * DAY));
    rows.push(clean({
      id, workspaceId: WS, clientId: S.clientId[d.client], relationship: d.relationship || 'owns', occupancy: d.occupancy, nickname: d.nickname,
      listingId: L ? L.id : null, source: d.source || (boughtWithMe || soldWithMe ? 'mls' : d.relationship === 'rents' ? 'described' : 'public_record'),
      listingUrl: null, mlsNumber: L ? L.mlsNumber : null,
      street: d.street || (L ? L.street : null), unit: d.unit || (L ? L.unitNumber : null), city: d.city || g.city, state: d.state !== undefined ? d.state : (g.state || null), zip: d.zip || g.zip,
      neighborhood: d.neighborhood || (L ? L.neighborhood : null), subdivision: d.subdivision, buildingName: d.buildingName || (L ? L.buildingName : null),
      market: d.market || (g.city ? MARKET(g.city) : null), lat: g.lat, lng: g.lng,
      propertyType, architecturalStyle: src.style || (L && L.architecturalStyle), styleFamily: src.family || (L && L.styleFamily),
      beds: src.beds, baths: src.baths || (L ? L.bathsTotal : null), sqft: src.sqft || (L ? L.livingAreaSqft : null),
      lotSqft: src.lotSqft || (src.lotAcres ? Math.round(src.lotAcres * 43560) : (L ? L.lotSqft : null)), lotAcres: src.lotAcres || (src.lotSqft ? +(src.lotSqft / 43560).toFixed(2) : (L ? L.lotAcres : null)),
      yearBuilt: src.yearBuilt || (L ? L.yearBuilt : null), stories: src.stories, garageSpaces: src.garage,
      waterfront: src.waterfront || (L ? L.waterfront : null), waterFrontageFt: src.frontage || (L ? L.waterFrontageFt : null), dockLengthFt: src.dock || (L ? L.dockLengthFt : null),
      views: src.views || (L ? L.views : []), amenities: src.amenities || (L ? L.amenities : []),
      features: (src.amenities || []).length ? src.amenities.map((a) => ({ name: a, confirmed: true })) : null,
      purchasePrice, purchasedAt, purchasedDealId, estValue, estValueAt: estValue ? ctx.daysAgo(rng.int(2, 35)) : null,
      valueSource: estValue ? (d.valueSource || (watching ? 'listing' : 'avm')) : null, titleHolding: d.titleHolding,
      lenderName: hasLoan ? d.lenderName : null, mortgageBalance: d.mortgageBalance || ltvBalance, mortgageRate: hasLoan ? d.mortgageRate : null,
      loanType: d.loanType, loanResetAt: d.loanResetAt, loanMaturesAt: hasLoan && purchasedAt ? new Date(purchasedAt.getTime() + 30 * 365.25 * DAY) : null,
      rentAmount: d.rentAmount, leaseEndsAt: d.leaseEndsAt, hoaMonthly: d.hoaMonthly || (L && L.hoaFee) || null,
      taxAnnual: d.taxAnnual || (estValue && ['owns', 'leased_out'].includes(d.relationship || 'owns') && (g.state === 'FL') ? round(estValue * 0.0165, 100) : null),
      boughtWithMe, soldWithMe, soldPrice, soldAt, thinkingOfSelling: !!d.thinkingOfSelling, sellSignals: d.sellSignals,
      photos, heroPhoto, notes: d.notes, createdAt,
    }));
  });
  return rows;
}

// ── Searches ──────────────────────────────────────────────────────────────
function buildSearches(S, defs) {
  const { ctx, WS } = S;
  return defs.map((raw) => {
    const d = deepT(ctx, raw);
    return clean({
      id: uid(`search:${d.key}`), workspaceId: WS, clientId: S.clientId[d.client], name: d.name, bucket: d.bucket || 'active', status: d.status || 'active',
      markets: d.markets || [], neighborhoods: d.neighborhoods || [], buildings: d.buildings || [], propertyTypes: d.propertyTypes || [],
      priceMin: d.priceMin, priceMax: d.priceMax, budgetFlexible: !!d.budgetFlexible, bedsMin: d.bedsMin, bathsMin: d.bathsMin, sqftMin: d.sqftMin, sqftMax: d.sqftMax,
      lotSqftMin: d.lotSqftMin, yearBuiltMin: d.yearBuiltMin, yearBuiltMax: d.yearBuiltMax, styles: d.styles || [], waterfront: d.waterfront || [], views: d.views || [],
      mustHaves: d.mustHaves, niceToHaves: d.niceToHaves || [], dealBreakers: d.dealBreakers || [], timeline: d.timeline, financing: d.financing, notes: d.notes,
      criteriaRaw: d.bucket === 'inferred' ? { inferredFrom: d.notes, confidence: 0.55 } : null, createdAt: ctx.past(d.created || -10, 10, 30),
    });
  });
}

// ── Deals ─────────────────────────────────────────────────────────────────
const STAGE_LABEL = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted', under_contract: 'Under contract', closed: 'Closed',
  seller_lead: 'Seller lead', listing_appt: 'Listing appointment', active: 'Active', offer_received: 'Offer received', lost: 'Lost',
  unit_selection: 'Unit selection', pricing_received: 'Pricing received', priority_list: 'Priority list', reserved: 'Reserved', building_delivered: 'Building delivered',
};

function buildDeals(S, defs) {
  const { ctx, WS } = S;
  const PLAN = { agentSplit: 0.8, cap: 24000, fee: 395, postCapFee: 250 };
  S.dealId = {};
  S.dealRow = {};
  const rows = [];
  const events = [];
  // Booked net for closed deals, honoring the cap per calendar year.
  const closed = defs.filter((d) => d.closed).sort((a, b) => a.closedAt - b.closedAt);
  const capUsed = {};
  const net = {};
  for (const d of closed) {
    const y = d.closedAt.getUTCFullYear();
    const gross = Math.round(d.salePrice * d.sideRate * (d.splitShare || 1));
    const used = capUsed[y] || 0;
    const broker = Math.min(gross * (1 - PLAN.agentSplit), PLAN.cap - used);
    capUsed[y] = used + broker;
    net[d.key] = { gross, net: Math.round(gross - broker - (used < PLAN.cap ? PLAN.fee : PLAN.postCapFee)) };
  }
  const positions = {};
  for (const raw of defs) {
    const d = deepT(ctx, raw);
    const id = uid(`deal:${d.key}`);
    S.dealId[d.key] = id;
    const L = d.listing ? S.listingRow[d.listing] : null;
    const path = d.path;
    const last = path[path.length - 1];
    const stage = last[0];
    positions[stage] = (positions[stage] || 0) + 1;
    const split = d.splitShare || 1;
    let estimatedGci = d.commissionFlat || Math.round((d.price || 0) * (d.sideRate || 0) * split * (d.referralOutPct || 1));
    if (d.closed) estimatedGci = net[d.key].gross;
    const row = clean({
      id, workspaceId: WS, clientId: S.clientId[d.client], title: d.title, side: d.side || 'buyer', inventoryType: d.inventoryType || 'resale', track: d.track || 'main',
      stage, stageChangedAt: last[1], position: positions[stage], listingId: L ? L.id : null, portfolioPropertyId: d.property ? S.propId[d.property] : null,
      propertyAddress: d.propertyAddress || (L ? L.fullAddress : null), propertyLabel: d.propertyLabel || (L ? L.title : null),
      shortlist: d.shortlist ? d.shortlist.map((s) => ({ listingId: s.listingKey ? S.listingId[s.listingKey] : null, label: s.label, price: s.price })) : null,
      price: d.price, listPrice: d.listPrice, contractPrice: d.contractPrice, salePrice: d.salePrice, sideRate: d.sideRate,
      listRate: d.listRate, buyRate: d.buyRate, commissionFlat: d.commissionFlat, splitShare: split, referralOutPct: d.referralOutPct, monthlyRent: d.monthlyRent,
      estimatedGci, estimatedNet: d.closed ? net[d.key].net : Math.round(estimatedGci - PLAN.postCapFee),
      grossCommission: d.closed ? net[d.key].gross : null, commission: d.closed ? net[d.key].net : null,
      probability: stage === 'lost' ? 0 : d.probability, contractDate: d.contractDate, closingDate: d.closingDate,
      inspectionDeadline: d.inspectionDeadline, appraisalDeadline: d.appraisalDeadline, financingDeadline: d.financingDeadline, contingencies: d.contingencies,
      finishSelectionDue: d.finishSelectionDue, estCompletion: d.estCompletion, depositSchedule: d.depositSchedule,
      lenderName: d.lenderName, titleCompany: d.titleCompany, coAgentName: d.coAgentName, coAgentBrokerage: d.coAgentBrokerage, leadSource: d.leadSource,
      lostReason: d.lostReason, lostNote: d.lostNote, lostAt: stage === 'lost' ? last[1] : null,
      closedAt: d.closedAt, closeProcessedAt: d.closeProcessedAt, notes: d.notes, extras: d.extras && Object.keys(d.extras).length ? d.extras : null,
      createdAt: path[0][1],
    });
    rows.push(row);
    S.dealRow[d.key] = { ...row, def: d };
    path.forEach(([st, at], i) => {
      const type = i === 0 ? 'created' : st === 'closed' ? 'closed' : st === 'lost' ? 'lost' : 'stage';
      const meta = type === 'closed' ? { salePrice: d.salePrice, grossCommission: row.grossCommission } : type === 'lost' ? { reason: d.lostReason } : null;
      events.push(clean({ id: uid(`de:${d.key}:${i}`), workspaceId: WS, dealId: id, type, fromStage: i ? path[i - 1][0] : null, toStage: st, meta, createdAt: at }));
    });
  }
  return { rows, events };
}

module.exports = { deepT, clean, fmtMoney, buildClients, buildListings, buildPortfolio, buildSearches, buildDeals, STAGE_LABEL, listingAddress, img };

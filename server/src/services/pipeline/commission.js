// Commission maths — the ONE formula (RevMatch had three; this replaces all of
// them). Pure functions, no I/O. Mirrored 1:1 for live estimates in
// web/src/components/pipeline/commission.js (parity is checked by
// commission.test.js) — change both together.
//
// Per deal (spec §9.5):
//   1. side GCI   flat fee > 0 ? flat
//                 : dual    → price × (listRate + buyRate)
//                 : lease   → monthlyRent × leaseFeeMonths (or annual rent × rate; default one month)
//                 : referral_out → price × partner side rate × referral fee % (fee you receive;
//                                  extras.referralFeePct, else referralOutPct, else 25%)
//                 : price × (sideRate ?? plan default for the side)
//   2. your share myGci = sideGCI × splitShare        (booked grossCommission wins when typed)
//   3. off the top referralOut = myGci × referralOutPct; adj = myGci − referralOut + coopBonus
//   4. franchise  min(adj × franchisePct, franchiseCap − franchisePaidYTD)
//      company $  (adj − franchise) × (1 − split[tier at GCI YTD]) until the anniversary-year cap,
//                 then at (1 − postCapSplit)
//      fee        transactionFee, or postCapTransactionFee once capped
//      team       (adj − franchise − company) × teamLeadPct on team-sourced deals
//      estimatedNet = adj − franchise − company − team − fee
//   5. Booked first: deal.commission (net actually received) wins everywhere and
//      is NEVER re-split (RevMatch's half-deal rule).
// Sides counted = base sides (buyer/listing/lease 1, dual 2, referral-out 0) × splitShare.
// Closings are processed chronologically within the anniversary year so the
// cap and tiers apply in the order the money actually landed.

const DEFAULT_PLAN = {
  planType: 'split_cap', // split_cap | tiered | flat_fee | 100pct
  defaultBuyerRate: 0.025,
  defaultListingRate: 0.03,
  agentSplit: 0.7,
  capAmount: null,
  capAnniversary: '01-01',
  postCapSplit: 1,
  transactionFee: 0,
  postCapTransactionFee: 0,
  franchisePct: 0,
  franchiseCap: null,
  teamLeadPct: 0,
  tiers: [],
  goals: {},
};

const BASE_SIDES = { buyer: 1, listing: 1, dual: 2, lease_tenant: 1, lease_landlord: 1, referral_out: 0, referral_in: 1 };
const LEASE_SIDES = new Set(['lease_tenant', 'lease_landlord']);
const LISTING_FAMILY = new Set(['listing', 'dual', 'lease_landlord']);

const num = (v, d = 0) => {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const opt = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n) => Math.round(Number(n) || 0);
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function normalizePlan(p) {
  const x = { ...DEFAULT_PLAN, ...(p || {}) };
  const tiers = Array.isArray(x.tiers) ? x.tiers : [];
  return {
    ...x,
    planType: x.planType || 'split_cap',
    defaultBuyerRate: num(x.defaultBuyerRate, DEFAULT_PLAN.defaultBuyerRate),
    defaultListingRate: num(x.defaultListingRate, DEFAULT_PLAN.defaultListingRate),
    agentSplit: clamp01(num(x.agentSplit, DEFAULT_PLAN.agentSplit)),
    capAmount: opt(x.capAmount) && opt(x.capAmount) > 0 ? opt(x.capAmount) : null,
    capAnniversary: /^\d{2}-\d{2}$/.test(String(x.capAnniversary || '')) ? x.capAnniversary : '01-01',
    postCapSplit: clamp01(num(x.postCapSplit, 1)),
    transactionFee: Math.max(0, num(x.transactionFee)),
    postCapTransactionFee: Math.max(0, num(x.postCapTransactionFee)),
    franchisePct: clamp01(num(x.franchisePct)),
    franchiseCap: opt(x.franchiseCap) && opt(x.franchiseCap) > 0 ? opt(x.franchiseCap) : null,
    teamLeadPct: clamp01(num(x.teamLeadPct)),
    tiers: tiers
      .map((t) => ({ fromGci: Math.max(0, num(t.fromGci ?? t.fromGCI)), agentSplit: clamp01(num(t.agentSplit, x.agentSplit)) }))
      .sort((a, b) => a.fromGci - b.fromGci),
    goals: x.goals && typeof x.goals === 'object' ? x.goals : {},
  };
}

const baseSides = (side) => (side in BASE_SIDES ? BASE_SIDES[side] : 1);
const splitShare = (d) => {
  const s = opt(d && d.splitShare);
  return s == null || s <= 0 ? 1 : Math.min(1, s);
};
const isLease = (side) => LEASE_SIDES.has(side);
const isListingFamily = (side) => LISTING_FAMILY.has(side);

function phaseOfStage(stage) {
  if (stage === 'closed' || stage === 'under_contract' || stage === 'lost') return stage;
  return 'open';
}

// The best-known price for the deal's moment in time.
function dealPrice(d) {
  if (!d) return 0;
  const ph = phaseOfStage(d.stage);
  const chain = ph === 'closed'
    ? [d.salePrice, d.contractPrice, d.price, d.listPrice]
    : ph === 'under_contract'
      ? [d.contractPrice, d.price, d.listPrice]
      : isListingFamily(d.side)
        ? [d.listPrice, d.price, d.contractPrice]
        : [d.price, d.listPrice, d.contractPrice];
  for (const v of chain) { const n = opt(v); if (n && n > 0) return n; }
  return 0;
}

// Which column the card's single "Price" field edits right now, and its caption.
function priceField(d) {
  const ph = phaseOfStage(d && d.stage);
  if (ph === 'closed') return 'salePrice';
  if (ph === 'under_contract') return 'contractPrice';
  if (isListingFamily(d && d.side)) return 'listPrice';
  return 'price';
}
function priceCaption(d) {
  const ph = phaseOfStage(d && d.stage);
  if (isLease(d && d.side)) return 'RENT';
  if (ph === 'closed') return 'SOLD';
  if (ph === 'under_contract' && opt(d.contractPrice)) return 'CONTRACT';
  if (isListingFamily(d && d.side) && opt(d.listPrice)) return 'LIST';
  return 'PRICE';
}

function defaultRate(side, plan) {
  return isListingFamily(side) && side !== 'dual' ? plan.defaultListingRate : plan.defaultBuyerRate;
}

// The rate the card shows in "Side rate %" (combined for dual).
function effectiveRate(d, planIn) {
  const plan = planIn && planIn.__normalized ? planIn : normalizePlan(planIn);
  const side = (d && d.side) || 'buyer';
  if (side === 'dual') {
    const lr = opt(d.listRate); const br = opt(d.buyRate);
    if (lr != null || br != null) return (lr ?? plan.defaultListingRate) + (br ?? plan.defaultBuyerRate);
    return opt(d.sideRate) ?? plan.defaultListingRate + plan.defaultBuyerRate;
  }
  return opt(d && d.sideRate) ?? defaultRate(side, plan);
}

function sideGci(d, planIn) {
  const plan = planIn && planIn.__normalized ? planIn : normalizePlan(planIn);
  const flat = opt(d.commissionFlat);
  if (flat && flat > 0) return flat;
  const side = d.side || 'buyer';
  const ex = (d.extras && typeof d.extras === 'object') ? d.extras : {};
  if (isLease(side)) {
    const rent = num(d.monthlyRent);
    const months = opt(ex.leaseFeeMonths);
    if (months != null) return rent * months;
    const rate = opt(d.sideRate);
    if (rate != null) return rent * 12 * rate;
    return rent;
  }
  const price = dealPrice(d);
  if (side === 'referral_out') {
    // On a referral-out deal the referral % is the fee you RECEIVE.
    const partnerRate = opt(d.sideRate) ?? plan.defaultBuyerRate;
    const pct = opt(ex.referralFeePct) ?? opt(d.referralOutPct) ?? 0.25;
    return price * partnerRate * pct;
  }
  return price * effectiveRate(d, plan);
}

function dealSides(d) {
  return baseSides((d && d.side) || 'buyer') * splitShare(d || {});
}

// Production volume this deal contributes (sales sides only).
function dealVolume(d) {
  const side = (d && d.side) || 'buyer';
  if (isLease(side) || side === 'referral_out') return 0;
  return dealPrice(d) * baseSides(side) * splitShare(d);
}

function splitFor(plan, gciYtd) {
  if (plan.planType === '100pct' || plan.planType === 'flat_fee') return 1;
  if (plan.tiers && plan.tiers.length) {
    let s = plan.tiers[0].agentSplit;
    for (const t of plan.tiers) if (gciYtd >= t.fromGci) s = t.agentSplit;
    return s;
  }
  return plan.agentSplit;
}

const ZERO_YTD = { gci: 0, company: 0, franchise: 0 };

// Full breakdown for one deal given the cap-year state before it.
function estimate(d, planIn, ytdIn) {
  const plan = planIn && planIn.__normalized ? planIn : normalizePlan(planIn);
  const ytd = { ...ZERO_YTD, ...(ytdIn || {}) };
  const side = d.side || 'buyer';
  const price = dealPrice(d);
  const gross = sideGci(d, plan);
  const share = splitShare(d);
  const bookedGross = opt(d.grossCommission);
  const my = bookedGross != null ? bookedGross : gross * share;
  const bookedNet = opt(d.commission);
  const sides = dealSides(d);
  const out = {
    price: round(price),
    rate: isLease(side) ? null : effectiveRate(d, plan),
    sideGci: round(gross),
    share,
    myGci: round(my),
    referralOut: 0,
    coopBonus: 0,
    adj: 0,
    franchise: 0,
    companyDollar: 0,
    towardCap: 0,
    split: splitFor(plan, ytd.gci),
    fee: 0,
    team: 0,
    net: 0,
    sides,
    volume: round(dealVolume(d)),
    capped: plan.capAmount != null && ytd.company >= plan.capAmount,
    booked: bookedNet != null,
    bookedNet,
    after: { ...ytd },
  };
  // referral fee you PAY a referring agent (on referral-out deals the % is the fee received instead)
  const referralOut = side === 'referral_out' ? 0 : my * (opt(d.referralOutPct) || 0);
  const coop = Math.max(0, num(d.coopBonus));
  const adj = my - referralOut + coop;
  out.referralOut = round(referralOut);
  out.coopBonus = round(coop);
  if (!(adj > 0)) {
    out.net = bookedNet != null ? bookedNet : 0;
    return out;
  }
  let franchise = adj * plan.franchisePct;
  if (plan.franchiseCap != null) franchise = Math.min(franchise, Math.max(0, plan.franchiseCap - ytd.franchise));
  const base = adj - franchise;
  const split = out.split;
  const preRate = 1 - split;
  let company = 0;
  let towardCap = 0;
  if (plan.planType !== 'flat_fee' && plan.planType !== '100pct') {
    if (plan.capAmount == null) {
      company = base * preRate;
      towardCap = company;
    } else {
      const room = Math.max(0, plan.capAmount - ytd.company);
      const pre = base * preRate;
      if (pre <= room) {
        company = pre;
        towardCap = pre;
      } else {
        const baseToCap = preRate > 0 ? room / preRate : base;
        company = room + Math.max(0, base - baseToCap) * (1 - plan.postCapSplit);
        towardCap = room;
      }
    }
  }
  const capped = plan.capAmount != null && ytd.company + towardCap >= plan.capAmount - 0.5;
  const fee = plan.planType === 'flat_fee' || !capped ? plan.transactionFee : plan.postCapTransactionFee;
  const ex = (d.extras && typeof d.extras === 'object') ? d.extras : {};
  const teamSourced = !!ex.teamSourced || d.leadSource === 'team';
  const team = teamSourced ? Math.max(0, base - company) * plan.teamLeadPct : 0;
  const net = adj - franchise - company - team - fee;
  Object.assign(out, {
    adj: round(adj),
    franchise: round(franchise),
    companyDollar: round(company),
    towardCap: round(towardCap),
    fee: round(fee),
    team: round(team),
    net: bookedNet != null ? bookedNet : round(net),
    estimatedNet: round(net),
    capped,
    after: { gci: ytd.gci + my, company: ytd.company + towardCap, franchise: ytd.franchise + franchise },
  });
  return out;
}

// Booked net wins; otherwise the estimate. Never re-split a typed number.
function dealNet(d, planIn, ytd) {
  const booked = opt(d && d.commission);
  if (booked != null) return booked;
  return estimate(d, planIn, ytd).net;
}

// Walk closings in the order the money landed. Returns per-deal rows and
// running totals (the cap-year state after the last one).
function processClosings(deals, planIn, startYtd) {
  const plan = planIn && planIn.__normalized ? planIn : normalizePlan(planIn);
  const sorted = [...(deals || [])].sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));
  let ytd = { ...ZERO_YTD, ...(startYtd || {}) };
  const rows = [];
  const totals = { closings: 0, sides: 0, volume: 0, gci: 0, net: 0, bookedNet: 0, estimatedNet: 0, estimatedCount: 0, company: 0, franchise: 0, fees: 0 };
  for (const d of sorted) {
    const e = estimate(d, plan, ytd);
    rows.push({ id: d.id, ...e });
    totals.closings += 1;
    totals.sides += e.sides;
    totals.volume += e.volume;
    totals.gci += e.myGci;
    totals.net += e.net;
    if (e.booked) totals.bookedNet += e.bookedNet;
    else { totals.estimatedNet += e.net; totals.estimatedCount += 1; }
    totals.company += e.companyDollar;
    totals.franchise += e.franchise;
    totals.fees += e.fee;
    ytd = e.after;
  }
  return { rows, totals, ytd };
}

function preparePlan(p) {
  const n = normalizePlan(p);
  Object.defineProperty(n, '__normalized', { value: true, enumerable: false });
  return n;
}

module.exports = {
  DEFAULT_PLAN,
  BASE_SIDES,
  normalizePlan,
  preparePlan,
  baseSides,
  splitShare,
  isLease,
  isListingFamily,
  dealPrice,
  priceField,
  priceCaption,
  effectiveRate,
  sideGci,
  dealSides,
  dealVolume,
  splitFor,
  estimate,
  dealNet,
  processClosings,
};

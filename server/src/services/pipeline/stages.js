// Pipeline stages — THE source of truth for every stage key, column, label,
// sub-status, stale threshold and forecast weight. The web reads this through
// GET /api/pipeline/stages; server code requires it directly.
//
// Model (RevMatch's lesson: few columns, fine keys mapped onto them):
//   • ONE board of six phase columns shared by every side:
//       Engaged · Consult · Active · Offer · Under Contract (quiet) · Closed (money)
//   • Each side belongs to a key FAMILY. Buyer-family sides store
//       new_lead → consultation → touring → offer_submitted → under_contract → closed
//     listing-family sides store
//       seller_lead → listing_appt → active → offer_received → under_contract → closed
//   • `lost` is terminal and is not a column (only reachable via the reasons sheet).
//   • The New Development lane (track 'new_dev') tracks the unit/building, not
//     the client: unit_selection → pricing_received → priority_list → reserved →
//     building_delivered, then returns to the main board at Under Contract.
//   • Terminal keys `closed` and `lost` are load-bearing — never rename them.
//
//   const S = require('./stages');
//   S.phaseOf('touring')                → 'active'
//   S.labelFor('offer_received','listing') → { label: 'Offers', sub: 'Offer in · negotiating' }
//   S.nextStage({ stage:'touring', side:'buyer', track:'main' }) → 'offer_submitted'
//   S.canonicalize('inspection', 'buyer') → { stage: 'under_contract', subStatus: 'inspection' }

const DAY = 86400000;

// ── Board columns (phases) ────────────────────────────────────────────────
const PHASES = [
  { id: 'engaged', label: 'Engaged', color: '#8A8A89', sub: 'New lead · Seller lead', staleDays: 14, odds: 0 },
  { id: 'consult', label: 'Consult', color: '#5AC8FA', sub: 'Consult · Listing appt', staleDays: 7, odds: 0.1 },
  { id: 'active', label: 'Active', color: '#E6E6E6', sub: 'Touring · Listed', staleDays: 30, odds: 0.2 },
  { id: 'offer', label: 'Offer', color: '#FFB440', sub: 'Offers out · in', staleDays: 5, odds: 0.4 },
  { id: 'under_contract', label: 'Under Contract', color: '#32D7C9', sub: 'Contingencies open', staleDays: null, odds: 0.85, quiet: true },
  { id: 'closed', label: 'Closed', color: '#D4FF3F', sub: 'Funded · recorded', staleDays: null, odds: 1, money: true },
];
const LOST = { id: 'lost', label: 'Lost', color: '#8E8E93', sub: 'Closed out · kept for the record' };
const PHASE_BY_ID = Object.fromEntries([...PHASES, LOST].map((p) => [p.id, p]));
const PHASE_IDS = PHASES.map((p) => p.id);

// ── Key families ──────────────────────────────────────────────────────────
const FAMILY_KEYS = {
  buyer: ['new_lead', 'consultation', 'touring', 'offer_submitted', 'under_contract', 'closed'],
  listing: ['seller_lead', 'listing_appt', 'active', 'offer_received', 'under_contract', 'closed'],
};

// canonical key → phase (both families; shared terminal keys)
const KEY_PHASE = {};
for (const fam of Object.keys(FAMILY_KEYS)) {
  FAMILY_KEYS[fam].forEach((k, i) => { KEY_PHASE[k] = PHASE_IDS[i]; });
}
KEY_PHASE.lost = 'lost';

// ── New Development lane (pre-construction) ───────────────────────────────
const NEW_DEV = [
  { key: 'unit_selection', label: 'Unit Selection', sub: 'Project · line · floorplan · finishes', color: '#8A8A89', odds: 0.1 },
  { key: 'pricing_received', label: 'Pricing Received', sub: 'Worksheet or price sheet back', color: '#E6E6E6', odds: 0.2 },
  { key: 'priority_list', label: 'Priority List', sub: 'In line for a release or phase', color: '#FFB440', odds: 0.3 },
  { key: 'reserved', label: 'Reserved / Contracted', sub: 'Deposit paid · contract signed', color: '#5AC8FA', odds: 0.85 },
  { key: 'building_delivered', label: 'Building Delivered', sub: 'TCO/CO issued → closing', color: '#D4FF3F', odds: 0.9 },
];
const NEW_DEV_KEYS = NEW_DEV.map((s) => s.key);
const NEW_DEV_BY_KEY = Object.fromEntries(NEW_DEV.map((s) => [s.key, s]));
const NEW_DEV_RETURN_STAGE = 'under_contract';

// ── Sides ─────────────────────────────────────────────────────────────────
// group drives the board filter chips (All · Buyers · Listings · Leases).
const SIDES = [
  { id: 'buyer', label: 'Buyer', chip: 'BUYER', family: 'buyer', group: 'buyers', baseSides: 1 },
  { id: 'listing', label: 'Listing', chip: 'LISTING', family: 'listing', group: 'listings', baseSides: 1 },
  { id: 'dual', label: 'Dual', chip: 'DUAL', family: 'listing', group: 'listings', baseSides: 2 },
  { id: 'lease_tenant', label: 'Lease · Tenant', chip: 'LEASE', family: 'buyer', group: 'leases', baseSides: 1 },
  { id: 'lease_landlord', label: 'Lease · Landlord', chip: 'LEASE', family: 'listing', group: 'leases', baseSides: 1 },
  { id: 'referral_out', label: 'Referral Out', chip: 'REFERRAL', family: 'buyer', group: 'buyers', baseSides: 0 },
  { id: 'referral_in', label: 'Referral In', chip: 'REFERRAL IN', family: 'buyer', group: 'buyers', baseSides: 1 },
];
const SIDE_BY_ID = Object.fromEntries(SIDES.map((s) => [s.id, s]));
const SIDE_IDS = SIDES.map((s) => s.id);

const FILTER_GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'listings', label: 'Listings' },
  { id: 'leases', label: 'Leases' },
];

const INVENTORY_TYPES = [
  { id: 'resale', label: 'Resale', chip: 'RESALE' },
  { id: 'new_construction', label: 'New construction', chip: 'NEW BUILD' },
  { id: 'pre_construction', label: 'Pre-construction', chip: 'PRE-CON' },
  { id: 'off_market', label: 'Off-market', chip: 'OFF-MARKET' },
];
const INVENTORY_IDS = INVENTORY_TYPES.map((t) => t.id);

// ── Side-specific stage labels (6 per side, phase order) ──────────────────
const L = (label, sub) => ({ label, sub });
const LABELS = {
  buyer: [
    L('New Lead', 'Interest shown'),
    L('Consultation', 'Buyer agreement · needs'),
    L('Touring', 'Showings in progress'),
    L('Offer', 'Offer out · negotiating'),
    L('Under Contract', 'Contingencies open'),
    L('Closed', 'Funded · recorded'),
  ],
  listing: [
    L('Seller Lead', 'Valuation asked'),
    L('Listing Appointment', 'CMA · presentation'),
    L('Listed', 'Pre-market → Active'),
    L('Offers', 'Offer in · negotiating'),
    L('Under Contract', 'Contingencies open'),
    L('Closed', 'Recorded · paid'),
  ],
  dual: [
    L('Seller Lead', 'Valuation asked'),
    L('Listing Appointment', 'CMA · presentation'),
    L('Listed', 'Both sides · on market'),
    L('Offers', 'Your buyer · negotiating'),
    L('Under Contract', 'Both sides · contingencies'),
    L('Closed', 'Double-ended · recorded'),
  ],
  lease_tenant: [
    L('Lead', 'Looking to rent'),
    L('Consult', 'Needs · budget · dates'),
    L('Touring', 'Showings in progress'),
    L('Application', 'Submitted · screening'),
    L('Lease Signed', 'Deposit · move-in set'),
    L('Moved In', 'Paid'),
  ],
  lease_landlord: [
    L('Lead', 'Rental valuation asked'),
    L('Listing Appt', 'Rent analysis · terms'),
    L('Listed for Rent', 'On market'),
    L('Applications', 'Screening tenants'),
    L('Lease Signed', 'Deposit · move-in set'),
    L('Paid', 'Fee received'),
  ],
  referral_out: [
    L('Lead', 'Client to refer out'),
    L('Referred', 'Sent to partner'),
    L('Partner Active', 'Partner working it'),
    L('Partner Offer', 'Offer in play'),
    L('Partner Under Contract', 'Fee pending'),
    L('Fee Received', 'Referral paid'),
  ],
  referral_in: [
    L('New Lead', 'Referred to you'),
    L('Consultation', 'Buyer agreement · needs'),
    L('Touring', 'Showings in progress'),
    L('Offer', 'Offer out · negotiating'),
    L('Under Contract', 'Contingencies open'),
    L('Closed', 'Referral fee owed'),
  ],
};

// ── Sub-status pills ──────────────────────────────────────────────────────
const CONTINGENCIES = [
  { id: 'inspection', label: 'Inspection', short: 'Inspect', deadlineField: 'inspectionDeadline' },
  { id: 'appraisal', label: 'Appraisal', short: 'Appraisal', deadlineField: 'appraisalDeadline' },
  { id: 'financing', label: 'Financing', short: 'Financing', deadlineField: 'financingDeadline' },
  { id: 'clear_to_close', label: 'Clear to close', short: 'CTC', deadlineField: null },
];
const LISTING_STATUSES = [
  { id: 'pre_market', label: 'Pre-market', short: 'Pre-market' },
  { id: 'coming_soon', label: 'Coming soon', short: 'Coming soon' },
  { id: 'active', label: 'Active', short: 'Active' },
  { id: 'price_improved', label: 'Price improved', short: 'Improved' },
];
const DEPOSIT_STEPS = [
  { id: 'd1', label: 'Deposit 1' },
  { id: 'd2', label: 'Deposit 2' },
  { id: 'd3', label: 'Deposit 3' },
  { id: 'balance', label: 'Balance at closing' },
];

// ── Lost reasons (side-aware presets) ─────────────────────────────────────
const LOST_REASONS = {
  buyer: [
    'Bought with another agent',
    'Priced out / affordability',
    'Financing fell through',
    'Walked after inspection/appraisal',
    'Paused search — timing',
    'Went silent / unreachable',
  ],
  listing: [
    'Listing expired',
    'Withdrew — not selling now',
    'Listed with another agent',
    'Price expectations too high',
    'Sold privately / FSBO',
    'Went silent / unreachable',
  ],
  lease_tenant: [
    'Leased with another agent',
    'Priced out / budget',
    'Application declined',
    'Renewed current lease',
    'Paused — timing',
    'Went silent / unreachable',
  ],
  lease_landlord: [
    'Listed with another agent',
    'Rented privately',
    'Rent expectations too high',
    'Withdrew — not renting now',
    'Decided to sell instead',
    'Went silent / unreachable',
  ],
  referral_out: [
    'Partner lost the client',
    'Client paused the move',
    'Client chose another agent',
    'Went silent / unreachable',
  ],
};
LOST_REASONS.dual = LOST_REASONS.listing;
LOST_REASONS.referral_in = LOST_REASONS.buyer;

const SPLIT_PRESETS = [
  { share: 1, label: 'Full side' },
  { share: 0.5, label: '50/50' },
  { share: 0.6, label: '60/40' },
  { share: 0.7, label: '70/30' },
];

// ── Fine / legacy keys → canonical (stage + optional sub-status) ──────────
// Anything an importer, an AI tool or an old client might send.
const FINE_KEYS = {
  // engaged
  lead: ['engaged'], contacted: ['engaged'], nurture: ['engaged'], engaged: ['engaged'], new: ['engaged'],
  // consult
  consult: ['consult'], buyer_agreement_signed: ['consult'], preapproved: ['consult'], listing_presented: ['consult'],
  listing_appointment: ['consult'], cma: ['consult'],
  // active
  showing_scheduled: ['active'], showings: ['active'], second_showing: ['active'], listing_signed: ['active', 'pre_market'],
  pre_market: ['active', 'pre_market'], coming_soon: ['active', 'coming_soon'], price_improved: ['active', 'price_improved'],
  back_on_market: ['active', 'active'], listed: ['active', 'active'], on_market: ['active', 'active'],
  // offer
  offer: ['offer'], offers: ['offer'], countered: ['offer'], negotiation: ['offer'], negotiating: ['offer'], multiple_offers: ['offer'],
  application: ['offer'],
  // under contract
  pending: ['under_contract'], in_contract: ['under_contract'], contract: ['under_contract'], escrow: ['under_contract'],
  inspection: ['under_contract', 'inspection'], appraisal: ['under_contract', 'appraisal'],
  financing: ['under_contract', 'financing'], clear_to_close: ['under_contract', 'clear_to_close'],
  lease_signed: ['under_contract'],
  // closed
  won: ['closed'], sold: ['closed'], funded: ['closed'], recorded: ['closed'], delivered: ['closed'], paid: ['closed'],
  // lost
  dead: ['lost'], closed_lost: ['lost'], terminated: ['lost'], fell_through: ['lost'], expired: ['lost'],
  withdrawn: ['lost'], cancelled: ['lost'], canceled: ['lost'],
};

// ── helpers ───────────────────────────────────────────────────────────────
const isNewDevStage = (key) => NEW_DEV_KEYS.includes(key);
const sideInfo = (side) => SIDE_BY_ID[side] || SIDE_BY_ID.buyer;
const familyOf = (side) => sideInfo(side).family;
const keysFor = (side) => FAMILY_KEYS[familyOf(side)];

function phaseOf(stage) {
  if (!stage) return 'engaged';
  if (KEY_PHASE[stage]) return KEY_PHASE[stage];
  if (isNewDevStage(stage)) return 'new_dev';
  return 'engaged';
}

// The canonical key for a phase on a given side.
function stageForPhase(phase, side) {
  if (phase === 'lost') return 'lost';
  const idx = PHASE_IDS.indexOf(phase);
  return keysFor(side)[idx >= 0 ? idx : 0];
}

function isValidStage(key) {
  return !!KEY_PHASE[key] || isNewDevStage(key);
}

// Map any stage key (canonical, fine/legacy, phase id, other family) onto the
// canonical key for `side`. Returns { stage, subStatus } or null if unknown.
function canonicalize(raw, side = 'buyer') {
  if (raw == null || raw === '') return null;
  const k = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isNewDevStage(k)) return { stage: k, subStatus: null };
  if (k === 'lost') return { stage: 'lost', subStatus: null };
  if (KEY_PHASE[k]) return { stage: stageForPhase(KEY_PHASE[k], side), subStatus: null };
  if (PHASE_BY_ID[k]) return { stage: stageForPhase(k, side), subStatus: null };
  if (FINE_KEYS[k]) {
    const [phase, sub] = FINE_KEYS[k];
    return { stage: stageForPhase(phase, side), subStatus: sub || null };
  }
  return null;
}

// Re-key a stage when the deal's side changes family (touring ↔ active …).
function translateStage(stage, side) {
  if (!stage || stage === 'lost' || isNewDevStage(stage)) return stage;
  return stageForPhase(phaseOf(stage), side);
}

function labelFor(stage, side = 'buyer') {
  if (stage === 'lost') return { label: LOST.label, sub: LOST.sub };
  if (isNewDevStage(stage)) {
    const s = NEW_DEV_BY_KEY[stage];
    return { label: s.label, sub: s.sub };
  }
  const idx = PHASE_IDS.indexOf(phaseOf(stage));
  const list = LABELS[side] || LABELS[familyOf(side)] || LABELS.buyer;
  return list[idx >= 0 ? idx : 0];
}

function colorFor(stage) {
  if (isNewDevStage(stage)) return NEW_DEV_BY_KEY[stage].color;
  return (PHASE_BY_ID[phaseOf(stage)] || PHASE_BY_ID.engaged).color;
}

// The ordered stage list a deal can move between (its side's family, or the
// lane), without Lost — callers append Lost where it's offered.
function stagesFor({ side = 'buyer', track = 'main' } = {}) {
  if (track === 'new_dev') return NEW_DEV.map((s) => ({ key: s.key, label: s.label, sub: s.sub, color: s.color, phase: 'new_dev' }));
  const labels = LABELS[side] || LABELS.buyer;
  return keysFor(side).map((key, i) => ({ key, label: labels[i].label, sub: labels[i].sub, color: PHASES[i].color, phase: PHASE_IDS[i] }));
}

// One-tap advance: the next working stage — NEVER into Closed or Lost, and
// nothing past the lane's last stage (that's the return row's job).
function nextStage({ stage, side = 'buyer', track = 'main' } = {}) {
  if (!stage || stage === 'closed' || stage === 'lost') return null;
  const list = track === 'new_dev' || isNewDevStage(stage) ? NEW_DEV_KEYS : keysFor(side);
  const idx = list.indexOf(stage);
  if (idx < 0) return null;
  const next = list[idx + 1];
  if (!next || next === 'closed') return null;
  return next;
}

function odds(stage) {
  if (stage === 'lost') return 0;
  if (isNewDevStage(stage)) return NEW_DEV_BY_KEY[stage].odds;
  return (PHASE_BY_ID[phaseOf(stage)] || {}).odds ?? 0;
}

const isOpenStage = (stage) => stage !== 'closed' && stage !== 'lost';
const isTerminal = (stage) => stage === 'closed' || stage === 'lost';

// Stale / DOM / countdown — everything time-derived about a deal's stage.
//   listing-family sides in the Active phase show DOM instead of a stale badge;
//   Under Contract shows a closing countdown (red once past); the lane is
//   never stale.
function timing(deal, now = new Date(), { listedAt } = {}) {
  const t = now.getTime();
  const changed = deal.stageChangedAt ? new Date(deal.stageChangedAt).getTime() : t;
  const stageAge = Math.max(0, Math.floor((t - changed) / DAY));
  const phase = phaseOf(deal.stage);
  const fam = familyOf(deal.side);
  const out = { stageAge, stale: false, staleDays: null, dom: null, closing: null };
  if (deal.track === 'new_dev' || phase === 'new_dev') return withClosing(out, deal, t);
  if (phase === 'active' && fam === 'listing') {
    const since = listedAt ? new Date(listedAt).getTime() : changed;
    out.dom = Math.max(0, Math.floor((t - since) / DAY));
  } else {
    const thr = (PHASE_BY_ID[phase] || {}).staleDays;
    if (thr != null && stageAge >= thr) { out.stale = true; out.staleDays = stageAge; }
  }
  return withClosing(out, deal, t);
}

function withClosing(out, deal, t) {
  const phase = phaseOf(deal.stage);
  const date = deal.closingDate || (deal.track === 'new_dev' ? deal.estCompletion : null);
  if (date && (phase === 'under_contract' || phase === 'offer' || phase === 'new_dev')) {
    const ms = new Date(date).getTime();
    const days = Math.ceil((ms - t) / DAY);
    out.closing = { date: new Date(ms).toISOString(), days, overdue: days < 0 && phase === 'under_contract' };
  }
  return out;
}

// The payload for GET /api/pipeline/stages — the web's one source of truth.
function config() {
  return {
    version: 1,
    phases: PHASES.map((p) => ({ ...p })),
    lost: { ...LOST },
    families: FAMILY_KEYS,
    keyPhase: KEY_PHASE,
    sides: SIDES.map((s) => ({ ...s })),
    filterGroups: FILTER_GROUPS,
    inventoryTypes: INVENTORY_TYPES,
    labels: LABELS,
    newDev: { stages: NEW_DEV.map((s) => ({ ...s })), returnStage: NEW_DEV_RETURN_STAGE },
    subStatuses: { under_contract: CONTINGENCIES, listing_active: LISTING_STATUSES },
    depositSteps: DEPOSIT_STEPS,
    lostReasons: LOST_REASONS,
    splitPresets: SPLIT_PRESETS,
    terminal: ['closed', 'lost'],
  };
}

module.exports = {
  DAY,
  PHASES,
  PHASE_IDS,
  PHASE_BY_ID,
  LOST,
  FAMILY_KEYS,
  KEY_PHASE,
  NEW_DEV,
  NEW_DEV_KEYS,
  NEW_DEV_RETURN_STAGE,
  SIDES,
  SIDE_IDS,
  SIDE_BY_ID,
  FILTER_GROUPS,
  INVENTORY_TYPES,
  INVENTORY_IDS,
  LABELS,
  CONTINGENCIES,
  LISTING_STATUSES,
  DEPOSIT_STEPS,
  LOST_REASONS,
  SPLIT_PRESETS,
  FINE_KEYS,
  sideInfo,
  familyOf,
  keysFor,
  phaseOf,
  stageForPhase,
  isValidStage,
  isNewDevStage,
  canonicalize,
  translateStage,
  labelFor,
  colorFor,
  stagesFor,
  nextStage,
  odds,
  isOpenStage,
  isTerminal,
  timing,
  config,
};

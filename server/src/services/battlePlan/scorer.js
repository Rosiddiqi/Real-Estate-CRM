// Candidate scorer (ported from RevMatch battlePlanScorer.js, re-geared to
// real estate). Deterministic 0–100:
//   impact (expected GCI, linear to $250K → 60) + match boost + property-tier
//   boost + recency + conversation + stage + lifecycle + standing-block bonus
//   × tag multiplier (whale 1.20, repeat 1.10, vip 1.05) − silence decay.
// Lifetime volume is BANNED from every priority signal (whale = the 5-star /
// isWhale toggle only); only an OPEN deal's expected GCI (or a matched
// listing's potential GCI) is a legitimate impact anchor.

// Stage boosts aligned with the KeyMatch pipeline vocabulary.
const STAGE_BOOST = {
  offer_submitted: 8, offer_received: 8,
  touring: 5, active: 5,
  consultation: 4, listing_appt: 4,
  pricing_received: 4, priority_list: 4, unit_selection: 3,
  under_contract: 3, reserved: 2,
  new_lead: 1, seller_lead: 1,
};

const IMPACT_CAP = 250_000; // $250K expected GCI ⇒ 60 points

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function normalizeImpact(dollars) {
  if (!dollars || dollars <= 0) return 0;
  return Math.round((Math.min(dollars, IMPACT_CAP) / IMPACT_CAP) * 60);
}

function tagMultiplier(bundle) {
  const tags = (bundle && bundle.tags) || [];
  let m = 1.0;
  if (tags.includes('whale')) m *= 1.20;
  if (tags.includes('repeat')) m *= 1.10;
  if (tags.includes('vip')) m *= 1.05;
  return m;
}

function stageBoost(bundle) {
  const stage = String((bundle && bundle.dealStage) || '').toLowerCase();
  return STAGE_BOOST[stage] || 0;
}

function silenceDecay(bundle) {
  const d = bundle && bundle.silenceDays;
  if (d == null || d <= 14) return 0;
  return Math.min(20, d - 14); // −1 per day after 14, capped at −20
}

function isDoNotDisturb(bundle) {
  const lines = (bundle && bundle.noteHighlights) || [];
  for (const line of lines) {
    if (/do[\s-]?not[\s-]?(disturb|contact|call)|don'?t call|please stop|leave me alone/i.test(line)) return true;
  }
  return false;
}

function recencyBoost(candidate, bundle) {
  if (candidate.kind !== 'respond.text') return 0;
  const lastAt = bundle && bundle.lastInboundAt;
  if (!lastAt) return 0;
  const now = candidate.nowMs || Date.now();
  const ageH = (now - new Date(lastAt).getTime()) / 3_600_000;
  if (ageH < 24) return 6;  // last 24h — strong recency
  if (ageH < 72) return 3;  // last 3 days
  return 0;
}

function conversationBonus(candidate) {
  return candidate.kind === 'respond.text' ? 12 : 0; // they asked — live momentum
}

function matchBoost(candidate) {
  if (!candidate.matchScore) return 0;
  const base = Math.min(30, Math.round(candidate.matchScore * 0.4));
  return candidate.kind === 'offmarket.match.call' ? base + 10 : base;
}

function lifecycleBonus(candidate) {
  switch (candidate.kind) {
    case 'lease.expiry.call': return 18;      // buy-vs-renew windows close fast
    case 'equity.milestone.call': return 18;  // rate reset / maturity / payoff
    case 'showing.feedback': return 14;       // strike while the showing is fresh
    case 'deal.unstick': return 8;
    case 'search.nudge': return 6;
    default: return 0;
  }
}

function standingBonus(candidate) {
  switch (candidate.kind) {
    case 'content.block': return 40;
    case 'personal.lunch': return 35;   // protected window
    case 'birthday.text': return 15;    // tactical — short window
    case 'anniversary.text': return 15; // annual CMA touch
    default: return 0;
  }
}

const PROPERTY_TIER_KINDS = new Set([
  'listing.match.call', 'listing.match.send', 'offmarket.match.call', 'lease.expiry.call',
  'equity.milestone.call', 'respond.text', 'search.nudge', 'deal.unstick', 'showing.feedback',
  'soi.checkin.text',
]);

function propertyTierBoost(candidate, bundle) {
  if (!bundle || !PROPERTY_TIER_KINDS.has(candidate.kind)) return 0;
  const p = bundle.propertyPriority;
  return typeof p === 'number' ? Math.round((p / 100) * 30) : 0;
}

function scoreCandidate(candidate, ctx = {}) {
  const bundle = (ctx.bundles && candidate.contactId) ? ctx.bundles.get(candidate.contactId) : null;
  if (isDoNotDisturb(bundle)) return 0;
  const base = normalizeImpact(candidate.impactDollars)
    + matchBoost(candidate)
    + propertyTierBoost(candidate, bundle)
    + recencyBoost(candidate, bundle)
    + conversationBonus(candidate)
    + stageBoost(bundle)
    + lifecycleBonus(candidate)
    + standingBonus(candidate);
  const final = base * tagMultiplier(bundle) - silenceDecay(bundle);
  return clamp(Math.round(final), 0, 100);
}

function scoreAll(candidates, ctx) {
  for (const c of candidates) c.score = scoreCandidate(c, ctx);
  return candidates.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
}

module.exports = {
  scoreCandidate, scoreAll, normalizeImpact, tagMultiplier, stageBoost, silenceDecay,
  isDoNotDisturb, matchBoost, lifecycleBonus, standingBonus, propertyTierBoost, STAGE_BOOST,
};

// Live call co-pilot: classify each transcript line.
//  • signal — silent gutter tick (RevMatch C2): showing · offer · listing ·
//    financing · inspection · plan.
//  • cue — an objection-handling card for luxury real estate, raised when the
//    CLIENT voices an objection (price/value, rates, commission, multiple
//    offers, inspection asks, "see more homes", "think about it", agents/FSBO,
//    market timing). Each cue: { kind, title, reframe, points[] }.
// Deterministic and instant (runs on every final line); never blocks a call.

const CUES = [
  {
    kind: 'commission', rx: /\b(commission|one and a half percent|1\.5 ?%|1 ?%|discount (broker|agent|brokerage)|lower (fee|rate)|your fee|cut (your|the) (fee|commission))\b/i,
    title: 'Commission push-back',
    reframe: 'Net-to-seller beats a lower fee.',
    points: ['Show net proceeds side by side: your plan vs. a discount listing', 'Bring days-on-market + price-cut data for discount listings', 'Trade value, not rate: private preview, film, staging'],
  },
  {
    kind: 'value', rx: /\b(zillow|zestimate|redfin|worth (quite a bit |a lot )?more|over ?priced|too (high|much)|priced too|price is (too|high))\b/i,
    title: 'Price vs. value',
    reframe: 'Buyers and appraisers only pay for closed comps.',
    points: ['Pull 3 closed comps within 0.5 mi, last 6 months', 'Walk the $/sq ft of the last two comparable sales', 'Name what the algorithm can’t see: finishes, view, lot'],
  },
  {
    kind: 'rates', rx: /\b(wait (for|until) (the )?rates|rates (to )?(come|go|drop)|rates are (too )?high|interest rates?|for rates)\b/i,
    title: 'Waiting on rates',
    reframe: 'Date the rate, marry the house.',
    points: ['When rates drop, sidelined buyers flood back: more competition', 'Run a buy-down / ARM scenario with their lender', 'Refi break-even math on a 1-point drop'],
  },
  {
    kind: 'multiple_offers', rx: /\b(multiple offers|other offers|highest and best|best and final|bidding war|escalat\w*|over asking)\b/i,
    title: 'Multiple offers',
    reframe: 'Win on terms, not just price.',
    points: ['Escalation clause with a firm cap', 'Shorter inspection on major systems + proof of funds up front', 'Flexible close or a rent-back for the seller'],
  },
  {
    kind: 'inspection', rx: /\b(inspection|seawall|roof|foundation|mold|termite|repairs?|fix (those|it|them)|credit at closing)\b/i,
    title: 'Inspection asks',
    reframe: 'Ask for credits on material items, not cosmetic ones.',
    points: ['Prioritize safety + structure: roof, seawall, HVAC', 'A closing credit beats seller-done repairs', 'Attach two contractor quotes to the ask'],
  },
  {
    kind: 'see_more', rx: /\b(see (a few )?more (homes|houses|options|places)|keep looking|other options|not ready to (decide|commit)|before we decide)\b/i,
    title: 'Wants to see more',
    reframe: 'Compare against the best alternatives, then decide.',
    points: ['Score this home against their must-haves out loud', 'Book 2–3 true comparables back to back', 'Agree on a decision date'],
  },
  {
    kind: 'think', rx: /\b(think about it|sleep on it|talk to my (wife|husband|spouse|partner)|get back to you|let me (talk|think))\b/i,
    title: '“Let me think about it”',
    reframe: 'Isolate the real concern, then lock a next step.',
    points: ['“What would need to be true to move forward?”', 'Offer a second look with everyone who decides', 'Agree on a specific time to reconnect'],
  },
  {
    kind: 'agents', rx: /\b(another agent|other agents|interviewing (agents|other)|sell it ourselves|by owner|fsbo)\b/i,
    title: 'Interviewing agents / FSBO',
    reframe: 'Make the decision about outcomes, not personalities.',
    points: ['Your last 3 sales: list-to-sale ratio and days on market', 'Your buyer network for a private preview', 'Offer an easy-exit listing agreement'],
  },
  {
    kind: 'market', rx: /\b(market (is going to|will|might) (crash|drop|correct)|bubble|prices (will|are going to) (fall|drop)|wait for the market)\b/i,
    title: 'Market timing',
    reframe: 'Time in the market beats timing the market.',
    points: ['Local inventory + absorption for their price band', 'They buy and sell in the same market', 'Hold horizon vs. short-term swings'],
  },
];

const SIGNALS = [
  ['showing', /\b(see (it|the house|the home|the property)|tour|walk ?through|come by|private showing|open house|when can we see|showings?)\b/i],
  ['offer', /\b(make an offer|write an offer|offer|counter|best and final|escalation)\b/i],
  ['listing', /\b(list (my|our|the) (home|house)|sell (my|our) (home|house)|what('s| is) (my|our) (home|house) worth|cma|valuation|listing presentation)\b/i],
  ['financing', /\b(pre-?approv\w*|lender|rates?|cash|proof of funds|jumbo|mortgage|buy-?down|refinanc\w*)\b/i],
  ['inspection', /\b(inspection|appraisal|seawall|roof|hvac|credit)\b/i],
  ['plan', /\b(i'?ll (send|email|text|call|pull|put together|draft|get|set up|have)|send (you|me)|email me|follow up|call me back|circle back)\b/i],
];

function classify(line) {
  const text = String(line.text || '');
  let signal = null;
  for (const [k, rx] of SIGNALS) if (rx.test(text)) { signal = k; break; }
  let cue = null;
  if (line.speaker === 'client') {
    for (const c of CUES) if (c.rx.test(text)) { cue = { kind: c.kind, title: c.title, reframe: c.reframe, points: c.points }; break; }
  }
  return { signal, cue };
}

module.exports = { classify, CUES };

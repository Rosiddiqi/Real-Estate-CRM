// Campaigns + Automations — shared constants (statuses, lanes, templates,
// default automations, accents). Ported from RevMatch's automations stack and
// re-geared for luxury real estate.
//
// Data model (KeyMatch schema, see prisma/schema.prisma "Campaigns"):
//   Campaign.kind      blast | sequence | automation
//   Campaign.trigger   template key for blasts (just_listed, open_house_invite…)
//                      or the automation trigger (home_anniversary, birthday…)
//   Campaign.status    draft | scheduled | running | paused | completed
//   Campaign.audience  segment filter + builder state (see audience.js)
//   Campaign.steps     [{dayOffset, instructions, includePhoto, listingId, attachment}]
//                      blasts: steps[0] is the announcement; automations: the sequence
//   Campaign.lanes     {green, yellow, red, gray, aiReply, reminders}
//   Campaign.event     {title, address, startAt, endAt, rsvp, calendarInvite}
//   Campaign.pacing    safe | all_now
//   Campaign.stats     cached scoreboard + run frame {run:{startAt,endAt,pausedAt,canceledAt}}
//
//   CampaignRecipient.status  pending | scheduled | drafting | sent | replied |
//                             taken_over | opted_out | failed | muted |
//                             rate_deferred | canceled
//   CampaignRecipient.lane    none | green | yellow | red   (gray = sent, no reply)
//   CampaignRecipient.meta    {queue:[{id,kind,at,step,lane,payload}], conversationId,
//                              initialSentAt, lastInboundAt, laneSetAt, lastReply,
//                              sends:[…], tier, isNew, seen:[messageIds], …}
//   nextSendAt = the earliest queued action (the row IS the queue — restart-safe).

const LANES = ['green', 'yellow', 'red', 'gray'];

const LANE_META = {
  green: { color: '#30D27A', title: "They're in", tag: 'WANTS TO SEE IT', sub: 'Interested, wants a showing or the details' },
  yellow: { color: '#F2C94C', title: 'They might', tag: 'MAYBE / QUESTIONS', sub: 'Curious, unsure, or asking questions' },
  red: { color: '#FF5A56', title: "They're out", tag: 'NOT INTERESTED', sub: 'Close out politely, then stop' },
  gray: { color: '#9AA7B8', title: 'They go quiet', tag: 'NO REPLY', sub: 'Wait it out, then reach back once' },
};

// Recipient statuses that are still "listening" for a reply.
const LISTENING = ['pending', 'scheduled', 'drafting', 'sent', 'replied', 'rate_deferred'];
// Statuses the engine may claim (when nextSendAt is due).
const CLAIMABLE = ['pending', 'scheduled', 'sent', 'replied', 'taken_over'];
const NOT_SENT = ['pending', 'scheduled', 'drafting', 'rate_deferred'];

// Kinds of queued actions on a recipient row.
//   initial_send   the announcement (texts WE start)
//   gray_check     the one no-reply nudge (texts WE start)
//   lane_step      a follow-up in the reply's lane (conversation)
//   close_out      the red lane's polite close (conversation)
//   reminder_step  event logistics, anchored to the event (survives takeover)
//   auto_step      an automation's trigger-fired text (texts WE start)
//   approved_send  an agent-approved draft waiting for a safe slot
const WE_START = ['initial_send', 'gray_check', 'auto_step'];
const SEQUENCE_KINDS = ['lane_step', 'close_out', 'reminder_step', 'approved_send'];

const ACCENTS = ['#2E8BFF', '#34C4A8', '#B98CFF', '#F2A93B', '#FF7A66'];

function accentFor(campaign) {
  if (!campaign) return ACCENTS[0];
  if (campaign.kind === 'automation' && AUTOMATION_DEFS[campaign.trigger]) return AUTOMATION_DEFS[campaign.trigger].accent;
  const tpl = TEMPLATES[campaign.trigger];
  if (tpl && tpl.accent) return tpl.accent;
  let h = 0;
  const s = String(campaign.id || campaign.name || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

// ── Campaign templates (brief starters) ─────────────────────────────────
// `brief` is the agent's instruction to the AI, written the way an agent
// would say it. {tokens} are filled from the attached listing / event when
// the builder applies the template.
const TEMPLATES = {
  just_listed: {
    key: 'just_listed', label: 'Just Listed', icon: 'sign', accent: '#2E8BFF', needsListing: true,
    sub: 'Announce a new listing to the right buyers',
    brief: 'Let them know I just listed {address}{specs}{price}. Offer a private showing before the weekend.',
    audienceHint: 'Buyers with active searches in the area and price band',
  },
  just_sold: {
    key: 'just_sold', label: 'Just Sold', icon: 'key', accent: '#30D27A', needsListing: true,
    sub: 'Social proof for owners nearby',
    brief: 'Tell them I just closed {address}{price}. Ask if they are curious what their own home would sell for today.',
    audienceHint: 'Homeowners in the same neighborhood',
  },
  open_house_invite: {
    key: 'open_house_invite', label: 'Open House Invite', icon: 'door', accent: '#BF5AF2', needsListing: true, needsEvent: true,
    sub: 'Invite, RSVP, reminders',
    brief: 'Invite them to the open house at {address}. Light bites and a private walkthrough, bring a friend. Ask them to reply if they are coming.',
    audienceHint: 'Sphere and active buyers nearby',
  },
  price_improvement: {
    key: 'price_improvement', label: 'Price Improvement', icon: 'trendingDown', accent: '#F2A93B', needsListing: true,
    sub: 'Tell matched buyers the price moved',
    brief: 'Let them know {address} just had a price improvement{price}. Offer a private tour this week.',
    audienceHint: 'Buyers searching in that price band',
  },
  market_update: {
    key: 'market_update', label: 'Market Update', icon: 'barChart', accent: '#34C4A8',
    sub: 'A neighborhood pulse, one insight',
    brief: 'Share a quick market update for their neighborhood: what is selling and how fast. Offer a complimentary valuation if they are curious.',
    audienceHint: 'Owners and past clients',
  },
  home_anniversary: {
    key: 'home_anniversary', label: 'Home Anniversary', icon: 'cake', accent: '#FF7A66',
    sub: 'Equity check-in for past buyers',
    brief: 'Congratulate them on another year in their home. Mention that values nearby have moved and offer a complimentary equity review.',
    audienceHint: 'Past clients who bought with you',
  },
  coming_soon: {
    key: 'coming_soon', label: 'Coming Soon', icon: 'lock', accent: '#9A4DFF',
    sub: 'Off-market tease for top buyers',
    brief: 'Quiet heads up: an off-market home is coming soon{area}, before it hits the MLS. Do not share the address. Ask if they want first look.',
    audienceHint: 'Whales and active buyers',
  },
  custom: {
    key: 'custom', label: 'Custom', icon: 'compose', accent: '#2E8BFF',
    sub: 'Your own message', brief: '',
  },
};

// ── Default automations ─────────────────────────────────────────────────
// approval: 'auto'  → turning it on approves every trigger-fired text
//                     (the campaign-level carve-out); each still passes the
//                     Sender Guard.
//           'draft' → each text is drafted for the agent's one-tap approval.
const AUTOMATION_DEFS = {
  home_anniversary: {
    trigger: 'home_anniversary', name: 'Home Anniversary', icon: 'cake', accent: '#34C4A8',
    when: 'Every year on the day they bought (annual CMA / equity touch)',
    approval: 'auto',
    brief: 'Happy home anniversary. Mention how many years they have owned it and offer a complimentary updated valuation (CMA) so they know what it is worth today.',
  },
  birthday: {
    trigger: 'birthday', name: 'Birthday', icon: 'gift', accent: '#FF7A66',
    when: "On a client's birthday",
    approval: 'auto',
    brief: 'Wish them a happy birthday. Warm and personal, no business talk at all.',
  },
  new_listing_match: {
    trigger: 'new_listing_match', name: 'New Listing Match', icon: 'zap', accent: '#5856D6',
    when: 'A new listing scores 90+ against a buyer’s search',
    approval: 'draft', minScore: 90,
    brief: 'A new listing just hit that fits what they are looking for. Mention the address, the one detail that fits their search best, and the price. Offer a private showing.',
  },
  price_drop: {
    trigger: 'price_drop', name: 'Price Drop Alert', icon: 'trendingDown', accent: '#F2A93B',
    when: 'A home a buyer is watching drops its price',
    approval: 'draft',
    brief: 'Let them know the home they have been watching just dropped its price. Give the new price and offer to set up a showing.',
  },
  open_house_invite: {
    trigger: 'open_house_invite', name: 'Open House Follow-up', icon: 'door', accent: '#BF5AF2',
    when: 'The day after an open house, for everyone who came',
    approval: 'auto',
    brief: 'Thank them for coming to the open house yesterday. Ask what they thought and offer a private second look.',
  },
  post_closing: {
    trigger: 'post_closing', name: 'Post-Closing Check-ins', icon: 'key', accent: '#30D27A',
    when: 'After a closing: 1 week, 1 month, 6 months, 1 year',
    approval: 'auto',
    brief: 'Check in after their closing.',
    steps: [
      { dayOffset: 7, label: '1 WEEK', instructions: 'How is the move-in going? Offer help with anything they need (contractors, movers, utilities).' },
      { dayOffset: 30, label: '1 MONTH', instructions: 'One month in. Ask how they are settling in and if anything needs attention.' },
      { dayOffset: 182, label: '6 MONTHS', instructions: 'Six months in. Share that values nearby have held and that you are always a text away.' },
      { dayOffset: 365, label: '1 YEAR', instructions: 'Happy one year in the home. Offer a complimentary equity review and ask, if they were happy, whether anyone they know is thinking of buying or selling.' },
    ],
  },
  lease_expiry: {
    trigger: 'lease_expiry', name: 'Lease Expiry: Buy vs Renew', icon: 'calendar', accent: '#32D4F5',
    when: "90 days before a renter's lease ends",
    approval: 'auto', leadDays: 90,
    brief: 'Their lease is ending soon. Offer a quick buy-versus-renew comparison: what their rent could own nearby. No pressure.',
  },
  showing_followup: {
    trigger: 'showing_followup', name: 'Showing Feedback', icon: 'messageSquare', accent: '#2E8BFF',
    when: 'The morning after a private showing',
    approval: 'auto',
    brief: 'Ask what they thought of the home they toured yesterday. Keep it short and easy to answer.',
  },
};

const AUTOMATION_ORDER = ['home_anniversary', 'birthday', 'new_listing_match', 'price_drop', 'open_house_invite', 'post_closing', 'lease_expiry', 'showing_followup'];

// Fair Housing: never segment or phrase by protected class. Used by the
// audience resolver (reject) and every drafting prompt (guardrail).
const FAIR_HOUSING_RE = /\b(famil(y|ies)[- ]friendly|young (couples?|families|professionals)|families with (kids|children)|empty[- ]nesters?|singles|bachelors?|retirees?|seniors?|elderly|old(er)? people|millennials|gen ?z|boomers|christians?|jewish|jews|muslims?|catholics?|hindus?|church|synagogue|mosque|hispanics?|latinos?|latinas?|black (people|families|buyers)|white (people|families|buyers)|asians?|immigrants?|foreigners?|nationality|national origin|race|racial|ethnic(ity)?|religio(n|us)|disab(led|ility)|handicap(ped)?|wheelchair|pregnan(t|cy)|gay|lesbian|straight couples?|men only|women only|male|female|kids?|children|school district)\b/i;

const FAIR_HOUSING_GUARDRAIL = `FAIR HOUSING (absolute): never mention, infer, or target protected characteristics (race, color, religion, national origin, sex, familial status, disability, age, sexual orientation, source of income). Never describe a neighborhood by who lives there ("family-friendly", "perfect for young couples", "safe area", schools as a proxy, places of worship). Talk only about the property, its features, its price, and explicitly named locations.`;

module.exports = {
  LANES, LANE_META, LISTENING, CLAIMABLE, NOT_SENT, WE_START, SEQUENCE_KINDS,
  ACCENTS, accentFor, TEMPLATES, AUTOMATION_DEFS, AUTOMATION_ORDER,
  FAIR_HOUSING_RE, FAIR_HOUSING_GUARDRAIL,
};

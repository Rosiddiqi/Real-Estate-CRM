// Campaign drafter — writes ONE recipient their own text at send time, in the
// agent's voice. AI (effort low) with the brief + client context + the fenced
// LISTING / EVENT facts + the Fair Housing guardrail; when AI is unavailable
// (no key, budget, outage) a deterministic template personalized by first
// name / neighborhood / listing takes over, so campaigns always work.
//
// Output rules (both paths): no em dashes, no emoji, one text, ≤480 chars,
// never invent a fact the brief/listing/event doesn't give.
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const { clientName } = require('../../lib/clients');
const { partsIn } = require('../../lib/dates');
const { FAIR_HOUSING_GUARDRAIL, AUTOMATION_DEFS } = require('./constants');

const MAX_LEN = 480;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

function sanitizeOutbound(text) {
  let t = String(text || '');
  t = t.replace(/^\s*(?:text|message|draft|reply)\s*:\s*/i, '');
  t = t.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  t = t.replace(/\s*[—–]\s*/g, ', ');
  t = t.replace(EMOJI_RE, '');
  t = t.replace(/\s+/g, ' ').trim().replace(/\s+([.,!?;:])/g, '$1').replace(/,\s*,/g, ',');
  if (t.length > MAX_LEN) {
    const cut = t.slice(0, MAX_LEN);
    const stop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    t = stop > MAX_LEN * 0.5 ? cut.slice(0, stop + 1) : cut.trim();
  }
  return t;
}

// ── Facts ──────────────────────────────────────────────────────────────
function money(n) {
  if (!n) return '';
  if (n >= 1e6) {
    const m = n / 1e6;
    return `$${m >= 10 ? m.toFixed(m % 1 === 0 ? 0 : 1) : m.toFixed(2)}`.replace(/\.?0+$/, '') + 'M';
  }
  return `$${Math.round(n / 1000)}K`;
}

function listingFacts(l) {
  if (!l) return null;
  const offMarket = ['pocket', 'whisper'].includes(l.origin) || l.status === 'coming_soon' || l.status === 'off_market';
  const street = l.hideAddress || offMarket ? null : [l.street, l.unitNumber ? `#${l.unitNumber}` : null].filter(Boolean).join(' ');
  const baths = l.bathsTotal || ((l.bathsFull || 0) + (l.bathsHalf ? l.bathsHalf * 0.5 : 0)) || null;
  const specs = [l.beds ? `${l.beds} bed` : null, baths ? `${String(baths).replace(/\.0$/, '')} bath` : null, l.livingAreaSqft ? `${Number(l.livingAreaSqft).toLocaleString('en-US')} sq ft` : null].filter(Boolean).join(', ');
  return {
    id: l.id,
    address: street || l.buildingName || (l.neighborhood ? `a home in ${l.neighborhood}` : 'the home'),
    street, neighborhood: l.neighborhood || l.city || null, city: l.city || null,
    specs, price: money(l.listPrice || l.priceGuide), wasPrice: l.previousPrice && l.listPrice && l.previousPrice > l.listPrice ? money(l.previousPrice) : '',
    closePrice: money(l.closePrice), status: l.status, offMarket,
    photo: l.heroPhoto || (l.photoUrls || [])[0] || null, headline: l.headline || null,
  };
}

function fmtEventWhen(event, tz) {
  if (!event || !event.startAt) return '';
  try {
    const s = new Date(event.startAt);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(s);
    const time = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '');
    if (event.endAt) {
      const e = new Date(event.endAt);
      const a = time(s); const b = time(e);
      const sameHalf = a.slice(-2) === b.slice(-2);
      return `${day}, ${sameHalf ? a.replace(/\s?[AP]M$/, '') : a}-${b}`;
    }
    return `${day} at ${time(s)}`;
  } catch { return ''; }
}

async function agentInfo(workspaceId) {
  const [user, ws] = await Promise.all([
    prisma.user.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { firstName: true, lastName: true, aiPreferences: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { brokerageName: true, timezone: true, name: true } }),
  ]);
  return {
    firstName: (user && user.firstName) || 'your agent',
    fullName: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '',
    brokerage: (ws && ws.brokerageName) || null,
    tz: (ws && ws.timezone) || 'America/New_York',
  };
}

async function clientContext(workspaceId, client) {
  const [props, searches, convs] = await Promise.all([
    prisma.portfolioProperty.findMany({ where: { workspaceId, clientId: client.id, relationship: { in: ['owns', 'rents', 'watching'] } }, select: { relationship: true, street: true, neighborhood: true, city: true, propertyType: true, purchasedAt: true, beds: true, leaseEndsAt: true }, take: 4 }),
    prisma.buyerSearch.findMany({ where: { workspaceId, clientId: client.id, status: 'active' }, select: { neighborhoods: true, markets: true, propertyTypes: true, priceMin: true, priceMax: true, bedsMin: true, waterfront: true, views: true }, take: 2 }),
    prisma.conversation.findMany({ where: { workspaceId, clientId: client.id, isGroup: false }, select: { id: true }, take: 3 }),
  ]);
  let thread = [];
  if (convs.length) {
    const msgs = await prisma.message.findMany({
      where: { conversationId: { in: convs.map((c) => c.id) }, kind: 'text', body: { not: null } },
      orderBy: { sentAt: 'desc' }, take: 10, select: { body: true, isFromMe: true },
    });
    thread = msgs.reverse().map((m) => `${m.isFromMe ? 'AGENT' : 'CLIENT'}: ${String(m.body).slice(0, 220)}`);
  }
  return { props, searches, thread };
}

async function voiceSample(workspaceId) {
  const msgs = await prisma.message.findMany({
    where: { workspaceId, isFromMe: true, aiGenerated: false, campaignId: null, kind: 'text', body: { not: null } },
    orderBy: { sentAt: 'desc' }, take: 12, select: { body: true },
  }).catch(() => []);
  return msgs.map((m) => String(m.body).slice(0, 200)).filter((b) => b.length > 8);
}

// ── Deterministic templates ────────────────────────────────────────────
function hashPick(seed, n) {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return n ? h % n : 0;
}

function fill(tpl, v) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : String(v[k])));
}

const BLAST_VARIANTS = {
  just_listed: [
    'Hi {first}, I just listed {addr}{inHood}: {specs}{atPrice}. Want a private showing before it opens to everyone?',
    '{first}, a new listing of mine just went live at {addr}. {specsCap}{offered}. Happy to walk you through it privately this week.',
    'Hi {first}! Just listed {addr}{inHoodParen}. {specsCap}{atPriceSentence} Want to see it before the weekend?',
  ],
  just_sold: [
    'Hi {first}, I just closed {addr}{inHood}{forPrice}. Curious what yours would sell for today? Happy to run the numbers for you.',
    '{first}, quick note: we just sold {addr}{forPrice}. If you have ever wondered what your home is worth right now, I would be glad to put together a private valuation.',
  ],
  open_house_invite: [
    'Hi {first}, I am hosting an open house at {addr}{whenComma}. Light bites and a private walkthrough, bring a friend. Will you come by?{rsvp}',
    '{first}, you are invited: open house at {addr}{whenComma}. I would love to show you around.{rsvp}',
    'Hi {first}! Open house at {addr}{whenComma}. Come see it in person, bring a friend.{rsvp}',
  ],
  price_improvement: [
    'Hi {first}, heads up: {addr} just had a price improvement to {price}. {specsCap}. Want to take a private tour this week?',
    '{first}, the price on {addr} just came down to {price}{wasPrice}. Worth a second look? I can get you in this week.',
  ],
  market_update: [
    'Hi {first}, quick {hoodOrArea} market update: well-priced homes are getting strong attention right now. Curious what yours would bring today? Happy to put together a private valuation.',
    '{first}, {hoodOrArea} has been active lately. If you would like a complimentary, no-pressure valuation of your home, just say the word.',
  ],
  home_anniversary: [
    'Happy home anniversary, {first}! {yearsSentence}Values around {hoodOrArea} have moved, so if you would like a complimentary equity review, I would be glad to put one together.',
  ],
  coming_soon: [
    'Hi {first}, quiet heads up: I have an off-market home coming soon{inHood}, before it hits the MLS. Want first look?',
    '{first}, something special is coming to market soon{inHood} and I wanted you to hear first. Want the private details?',
  ],
};

const AUTO_VARIANTS = {
  home_anniversary: ['Happy home anniversary, {first}! {yearsSentence}If you are curious what it is worth today, I would be glad to put together a complimentary CMA.'],
  birthday: ['Happy birthday, {first}! Hope you have a wonderful day.', 'Happy birthday {first}! Wishing you a great year ahead.'],
  new_listing_match: ['Hi {first}, a new listing just hit that fits what you are looking for: {addr}{inHood}, {specs}{atPrice}. Want a private showing?'],
  price_drop: ['Hi {first}, the home you have been watching at {addr} just dropped to {price}{wasPrice}. Want to set up a showing?'],
  open_house_invite: ['Hi {first}, thanks for stopping by the open house at {addr}. What did you think? Happy to set up a private second look.'],
  post_closing: [
    'Hi {first}, how is the move-in going? If you need anything at all (contractors, movers, utilities), I am a text away.',
    'One month in, {first}! How are you settling in? Anything need attention?',
    'Hi {first}, six months in the new place already. Values nearby have held up nicely. Always a text away if you need anything.',
    'Happy one year in your home, {first}! If you would like a complimentary equity review, just say the word. And if anyone you know is thinking of buying or selling, I would be grateful for the intro.',
  ],
  lease_expiry: ['Hi {first}, your lease is coming up{leaseDate}. Want a quick buy-versus-renew comparison? Sometimes what you are paying in rent could own something nearby. No pressure either way.'],
  showing_followup: ['Hi {first}, what did you think of {addr} yesterday? Even a quick gut reaction helps me find the right one.'],
};

// "Let them know I just closed X and ask if they're curious" → second person.
function briefToText(brief, first) {
  let t = String(brief || '').trim();
  if (!t) return `Hi ${first}, hope you are doing well.`;
  t = t.replace(/^(please\s+)?(let|tell|remind|ask|invite|text|message|send|share with)\s+(them|everyone|all of them|people|clients|my clients)\s*(know\s+)?(that\s+)?(about\s+)?/i, '');
  t = t.replace(/^(share|send)\s+/i, '');
  t = t.replace(/\bask (them )?(if|whether) they('re| are)\b/gi, 'are you')
    .replace(/\bask (them )?(if|whether) they\b/gi, 'do you')
    .replace(/\bthey're\b/gi, "you're").replace(/\bthey are\b/gi, 'you are').replace(/\bthey'll\b/gi, "you'll")
    .replace(/\bthemselves\b/gi, 'yourself').replace(/\btheirs\b/gi, 'yours').replace(/\btheir\b/gi, 'your')
    .replace(/\bthem\b/gi, 'you').replace(/\bthey\b/gi, 'you');
  t = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^i\b/.test(t)) t = `I${t.slice(1)}`;
  if (!/[.!?]$/.test(t)) t += '.';
  return `Hi ${first}, ${t}`;
}

function templateVars({ client, listing, event, agent, extra = {} }) {
  const first = client.firstName || clientName(client).split(' ')[0] || 'there';
  const L = listingFacts(listing);
  const hood = (L && L.neighborhood) || client.neighborhood || null;
  const when = fmtEventWhen(event, agent.tz);
  return {
    first,
    addr: (event && event.address && !L) ? event.address : (L ? L.address : (event && event.address) || 'the home'),
    inHood: hood ? ` in ${hood}` : '',
    inHoodParen: hood ? ` (${hood})` : '',
    hoodOrArea: hood || 'your neighborhood',
    specs: L && L.specs ? L.specs : 'beautifully done',
    specsCap: L && L.specs ? L.specs.charAt(0).toUpperCase() + L.specs.slice(1) : 'Beautifully done',
    price: L && L.price ? L.price : 'a new price',
    atPrice: L && L.price ? `, ${L.price}` : '',
    atPriceSentence: L && L.price ? ` Offered at ${L.price}.` : '',
    offered: L && L.price ? `, offered at ${L.price}` : '',
    forPrice: L && (L.closePrice || L.price) ? ` for ${L.closePrice || L.price}` : '',
    wasPrice: L && L.wasPrice ? ` (was ${L.wasPrice})` : '',
    whenComma: when ? `, ${when}` : '',
    when,
    rsvp: event && event.rsvp ? ' Just reply yes if you are coming.' : '',
    title: (event && event.title) || 'the open house',
    eventAddr: (event && event.address) || (L && L.address) || '',
    agent: agent.firstName,
    ...extra,
  };
}

function fallbackText({ campaign, client, kind, lane, stepIndex = 0, listing, event, agent, seed, attempt = 0, extra = {} }) {
  const v = templateVars({ client, listing, event, agent, extra });
  const pick = (arr) => arr[(hashPick(seed || client.id, arr.length) + attempt) % arr.length];
  let out;
  if (kind === 'gray_check') {
    out = pick(['Hi {first}, just making sure you saw my last text. No rush at all.', '{first}, circling back in case my last message got buried. No pressure.']);
  } else if (kind === 'close_out') {
    out = pick(['Totally understand, {first}. Thanks for letting me know, I will keep you posted on the next one.', 'No worries at all, {first}. Thanks for getting back to me. I will keep you in mind for the next one.']);
  } else if (kind === 'reminder_step') {
    out = v.when ? 'Quick reminder, {first}: {title} is {when}{atEventAddr}. See you there!' : 'Quick reminder, {first}. Looking forward to it!';
    v.atEventAddr = v.eventAddr ? ` at ${v.eventAddr}` : '';
  } else if (kind === 'lane_step') {
    if (lane === 'green') out = v.when ? 'Looking forward to seeing you {when}, {first}. {eventAddrSentence}' : (listing ? 'Great, {first}! Want me to set up a private showing at {addr}? What day works best?' : 'Great to hear, {first}! What day works best to connect?');
    else if (lane === 'yellow') out = v.when ? 'No pressure at all, {first}. If you can make it {when}, I would love to see you.' : 'No rush at all, {first}. Happy to answer any questions whenever you are ready.';
    else out = 'Thanks again, {first}. I will keep you posted.';
    v.eventAddrSentence = v.eventAddr ? `${v.eventAddr}.` : '';
  } else if (kind === 'auto_step' && campaign && AUTO_VARIANTS[campaign.trigger]) {
    const list = AUTO_VARIANTS[campaign.trigger];
    out = campaign.trigger === 'post_closing' ? list[Math.min(stepIndex, list.length - 1)] : pick(list);
  } else if (campaign && BLAST_VARIANTS[campaign.trigger]) {
    out = pick(BLAST_VARIANTS[campaign.trigger]);
  } else {
    return sanitizeOutbound(briefToText(campaign && campaign.brief, v.first));
  }
  return sanitizeOutbound(fill(out, v));
}

// ── AI path ────────────────────────────────────────────────────────────
const SYSTEM = `You ghost-write ONE text message from a luxury real-estate agent to one specific client, in the agent's exact voice.

VOICE: imitate the agent's sample texts: their length, punctuation, warmth and greeting style. Short and human. Never sound like a marketer, a newsletter, or an assistant.

THE BRIEF IS AN INSTRUCTION TO YOU, NOT COPY TO RELAY. The agent wrote it about a whole list ("tell them X", "if they own nearby, mention Y"). You are writing to ONE person whose facts are below. Resolve every condition against THIS client and write only the resolved side. Never echo a condition, never address them as one of a group, never narrate the brief.

FACTS: the LISTING and EVENT blocks are real; state them exactly as given and never change or invent a price, address, date, time, or feature. If a detail is missing, say nothing about it. Use AT MOST one personal hook from the client context (their home, their search), only if it fits naturally. Never reveal that the agent keeps records ("I see in my notes...").

${FAIR_HOUSING_GUARDRAIL}

HARD RULES:
- Reply with ONLY the text message body. No preamble, no quotes, no sign-off block.
- Never use an em dash or en dash. No emoji. No hashtags.
- One text, two or three sentences at most. No links unless the brief includes one.
- Do not promise anything the brief does not say.`;

function contextBlock(ctx) {
  const lines = [];
  for (const p of ctx.props || []) {
    const where = [p.street, p.neighborhood || p.city].filter(Boolean).join(', ');
    if (p.relationship === 'owns') lines.push(`owns: ${where || 'a home'}${p.purchasedAt ? ` (bought ${new Date(p.purchasedAt).getFullYear()})` : ''}`);
    else if (p.relationship === 'rents') lines.push(`rents: ${where || 'a home'}${p.leaseEndsAt ? ` (lease ends ${new Date(p.leaseEndsAt).toISOString().slice(0, 10)})` : ''}`);
    else lines.push(`watching: ${where}`);
  }
  for (const s of ctx.searches || []) {
    const band = s.priceMax ? `${s.priceMin ? money(s.priceMin) : 'up to'}-${money(s.priceMax)}` : '';
    lines.push(`searching: ${[...(s.neighborhoods || []), ...(s.markets || [])].slice(0, 3).join(', ') || 'open area'}${band ? ` ${band}` : ''}${s.bedsMin ? `, ${s.bedsMin}+ beds` : ''}${(s.waterfront || []).length ? `, waterfront` : ''}`);
  }
  return lines;
}

async function aiDraft({ workspaceId, campaign, client, kind, lane, stepBrief, listing, event, agent, tier, extra = {} }) {
  const ctx = await clientContext(workspaceId, client);
  const voice = await voiceSample(workspaceId);
  const L = listingFacts(listing);
  const when = fmtEventWhen(event, agent.tz);
  const first = client.firstName || clientName(client).split(' ')[0];
  const parts = [];
  parts.push(`AGENT: ${agent.fullName || agent.firstName}${agent.brokerage ? ` (${agent.brokerage})` : ''}`);
  parts.push(`CLIENT: ${first}`);
  const brief = (campaign && campaign.brief) || (campaign && AUTOMATION_DEFS[campaign.trigger] && AUTOMATION_DEFS[campaign.trigger].brief) || '';
  if (kind === 'initial_send' || kind === 'auto_step') {
    parts.push(`TASK: Write the ${kind === 'auto_step' ? 'automated' : 'campaign'} text.\nTHE BRIEF (the agent's words): ${String(stepBrief || brief).slice(0, 900)}`);
    if (tier === 'cold') parts.push('They may not have the agent\'s number saved: open naturally with the agent\'s first name.');
  } else {
    const laneName = kind === 'gray_check' ? 'no reply yet (one gentle nudge)' : kind === 'close_out' ? 'they passed (polite close-out, then stop)' : kind === 'reminder_step' ? 'event reminder' : lane === 'green' ? 'they are interested' : lane === 'yellow' ? 'maybe / unsure' : 'follow-up';
    parts.push(`TASK: This is a follow-up (${laneName}). The agent's instruction for THIS text: ${String(stepBrief || '').slice(0, 500) || 'a short, warm follow-up'}\nCAMPAIGN BRIEF (context only): ${String(brief).slice(0, 500)}`);
  }
  if (L) parts.push(`LISTING (REAL, state exactly; ${L.offMarket ? 'OFF-MARKET: never share the street address' : 'public'}):\naddress: ${L.address}${L.neighborhood ? `\nneighborhood: ${L.neighborhood}` : ''}${L.specs ? `\nspecs: ${L.specs}` : ''}${L.price ? `\nprice: ${L.price}` : ''}${L.wasPrice ? `\nprevious price: ${L.wasPrice}` : ''}${L.headline ? `\nheadline: ${L.headline}` : ''}`);
  if (when || (event && event.address)) parts.push(`EVENT DETAILS (REAL, state exactly as given, never invent a missing one):${event.title ? `\ntitle: ${event.title}` : ''}${when ? `\nwhen: ${when}` : ''}${event.address ? `\nwhere: ${event.address}` : ''}${event.rsvp ? '\nask them to reply to RSVP' : ''}`);
  if (extra && Object.keys(extra).length) parts.push(`TRIGGER FACTS: ${Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  const cl = contextBlock(ctx);
  if (cl.length) parts.push(`CLIENT CONTEXT (the only allowed personal hooks):\n${cl.join('\n')}`);
  if (voice.length) parts.push(`AGENT'S OWN RECENT TEXTS (voice sample, imitate):\n${voice.slice(0, 10).map((v) => `- ${v}`).join('\n')}`);
  if (ctx.thread.length) parts.push(`RECENT THREAD WITH THIS CLIENT (latest last):\n${ctx.thread.slice(-8).join('\n')}`);
  const raw = await ai.text({ system: SYSTEM, prompt: parts.join('\n\n'), effort: 'low', maxTokens: 4000, feature: 'campaign_draft', workspaceId });
  const text = sanitizeOutbound(raw || '');
  if (!text || text.length < 8) return null;
  const citations = [];
  if (L) citations.push('listing');
  if (when) citations.push('event');
  if ((ctx.props || []).length) citations.push('portfolio');
  if ((ctx.searches || []).length) citations.push('search');
  if (ctx.thread.length) citations.push('texts');
  return { text, citations: citations.slice(0, 4), via: 'ai' };
}

// draft({...}) -> { text, citations, via: 'ai'|'template' }
async function draft({ workspaceId, campaign, client, kind = 'initial_send', lane, stepIndex = 0, stepBrief, listing, event, agent, tier, attempt = 0, extra = {} }) {
  const a = agent || await agentInfo(workspaceId);
  if (ai.available() && attempt < 2) {
    try {
      const out = await aiDraft({ workspaceId, campaign, client, kind, lane, stepBrief, listing, event, agent: a, tier, extra });
      if (out) return out;
    } catch (err) {
      if (err.code !== 'ai_unavailable') console.error('[campaigns/drafter] AI draft failed, using template:', err.message);
    }
  }
  const text = fallbackText({ campaign, client, kind, lane, stepIndex, listing, event, agent: a, seed: `${client.id}:${campaign && campaign.id}`, attempt, extra });
  const citations = [];
  if (listing) citations.push('listing');
  if (event && event.startAt) citations.push('event');
  return { text, citations, via: 'template' };
}

module.exports = { draft, fallbackText, sanitizeOutbound, briefToText, listingFacts, fmtEventWhen, agentInfo, money, clientContext, SYSTEM };

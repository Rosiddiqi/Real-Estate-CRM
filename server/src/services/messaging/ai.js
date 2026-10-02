// Inbox AI — every feature has a deterministic fallback so the inbox is fully
// useful with no API key (ai.available() === false) and never waits on a model
// for more than a few seconds.
//   suggestReplies   → 3 reply chips for an unanswered inbound (never auto-sent)
//   summarizeThread  → one-line summary + intent + urgency for long threads
//   inboxCard        → "who needs you first" pinned card
//   briefing         → compact relationship card in the thread header
//   draftText        → QuickText "Draft with AI"
//   demoClientReply  → the demo provider's client voice
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const config = require('../../config');
const { clientName } = require('../../lib/clients');
const { detectIntent } = require('./intent');
const { firstNameOf, stripUrls, truncate, withTimeout } = require('./util');
const { moneyCompact } = require('./listingCard');

const AI_TIMEOUT = 14000;
const FAIR_HOUSING = 'Fair Housing: never mention, ask about, or infer race, color, religion, national origin, sex, disability or familial status (children/family size), and never characterize neighborhoods by who lives there — talk only about property attributes and explicitly named places.';

const STAGE_LABEL = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted',
  under_contract: 'Under contract', closed: 'Closed', lost: 'Lost', seller_lead: 'Seller lead',
  listing_appt: 'Listing appointment', active: 'Active listing', offer_received: 'Offer received',
  unit_selection: 'Unit selection', pricing_received: 'Pricing received', priority_list: 'Priority list',
  reserved: 'Reserved', building_delivered: 'Building delivered',
};

// ── context loaders ───────────────────────────────────────────────────────
async function loadThread(workspaceId, conversationId, take = 16) {
  const rows = await prisma.message.findMany({
    where: { workspaceId, conversationId, status: { notIn: ['scheduled', 'cancelled'] }, kind: { in: ['text', 'attachment', 'listing'] } },
    orderBy: { sentAt: 'desc' },
    take,
    select: { id: true, isFromMe: true, body: true, sentAt: true, kind: true, meta: true, attachments: { select: { kind: true } } },
  });
  return rows.reverse().map((m) => ({
    id: m.id,
    who: m.isFromMe ? 'agent' : 'client',
    text: m.kind === 'listing'
      ? `[shared a listing: ${(m.meta && m.meta.listing && m.meta.listing.address) || 'property'}] ${stripUrls(m.body || '')}`.trim()
      : (m.body ? m.body : `[${(m.attachments[0] && m.attachments[0].kind) || 'attachment'}]`),
    at: m.sentAt,
  }));
}

async function agentFirstName(workspaceId) {
  const u = await prisma.user.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { firstName: true } }).catch(() => null);
  return (u && u.firstName) || '';
}

const PERSONAL_OK = ['birthday', 'pets', 'pet', 'dog', 'cat', 'hobbies', 'hobby', 'interests', 'clubs', 'club', 'wine', 'restaurant', 'restaurants', 'favoriteRestaurant', 'sports', 'team', 'travel', 'boat', 'golf', 'cars', 'art', 'collects', 'charity', 'anniversary', 'coffee', 'drink'];

function personalTouch(personal) {
  if (!personal || typeof personal !== 'object') return null;
  for (const key of PERSONAL_OK) {
    const v = personal[key];
    if (v == null || v === '') continue;
    if (Array.isArray(v) && v.length) return `${label(key)}: ${v.slice(0, 2).join(', ')}`;
    if (typeof v === 'object') {
      const name = v.name || v.title || v.value;
      if (name) return `${label(key)}: ${name}${v.kind ? ` (${v.kind})` : v.breed ? ` (${v.breed})` : ''}`;
      continue;
    }
    if (key === 'birthday') return `Birthday ${fmtBirthday(v)}`;
    return `${label(key)}: ${String(v)}`;
  }
  return null;
}
function label(k) {
  const map = { pets: 'Pet', pet: 'Pet', dog: 'Dog', cat: 'Cat', hobbies: 'Into', hobby: 'Into', interests: 'Into', clubs: 'Member', club: 'Member', favoriteRestaurant: 'Favorite spot', restaurant: 'Favorite spot', restaurants: 'Favorite spots', wine: 'Wine', sports: 'Sports', team: 'Roots for', travel: 'Travel', boat: 'Boat', golf: 'Golf', cars: 'Cars', art: 'Art', collects: 'Collects', charity: 'Cause', anniversary: 'Anniversary', coffee: 'Coffee', drink: 'Drink' };
  return map[k] || k;
}
function fmtBirthday(v) {
  const s = String(v);
  const m = s.match(/(\d{4})?-?(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(2000, +m[2] - 1, +m[3], 12));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return s;
}

function searchLine(s) {
  if (!s) return null;
  const areas = [...(s.neighborhoods || []), ...(s.buildings || []), ...(s.markets || [])].slice(0, 2);
  const bits = [];
  const water = (s.waterfront || []).filter((w) => w && w !== 'any');
  const type = (s.propertyTypes || [])[0];
  bits.push([water.length ? `${water[0].replace(/_/g, ' ')}` : null, type ? type.replace(/_/g, ' ') : 'home'].filter(Boolean).join(' '));
  if (areas.length) bits.push(`in ${areas.join(' / ')}`);
  const specs = [s.bedsMin ? `${s.bedsMin}+ bd` : null, s.priceMax ? `up to ${moneyCompact(s.priceMax)}` : (s.priceMin ? `${moneyCompact(s.priceMin)}+` : null)].filter(Boolean);
  return `${bits.join(' ')}${specs.length ? ` · ${specs.join(' · ')}` : ''}`.replace(/^\w/, (c) => c.toUpperCase());
}

async function clientFacts(workspaceId, clientId) {
  if (!clientId) return null;
  const c = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    include: {
      searches: { where: { status: 'active' }, orderBy: { updatedAt: 'desc' }, take: 2 },
      deals: { where: { archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 4 },
      properties: { orderBy: { updatedAt: 'desc' }, take: 3 },
    },
  }).catch(() => null);
  if (!c) return null;
  const openDeal = c.deals.find((d) => !['closed', 'lost'].includes(d.stage));
  const closed = c.deals.filter((d) => d.stage === 'closed');
  const search = c.searches.find((s) => s.bucket === 'active') || c.searches[0] || null;
  const selling = c.properties.find((p) => p.thinkingOfSelling);
  return {
    id: c.id,
    name: clientName(c),
    first: firstNameOf(c) || clientName(c),
    type: c.type,
    status: c.status,
    isWhale: !!c.isWhale,
    rating: c.rating,
    lastContactedAt: c.lastContactedAt,
    lastInboundAt: c.lastInboundAt,
    lastOutboundAt: c.lastOutboundAt,
    openDeal: openDeal ? { id: openDeal.id, stage: openDeal.stage, label: STAGE_LABEL[openDeal.stage] || openDeal.stage, address: openDeal.propertyLabel || openDeal.propertyAddress || openDeal.title, closingDate: openDeal.closingDate, side: openDeal.side } : null,
    closedCount: closed.length,
    search: search ? searchLine(search) : null,
    selling: selling ? (selling.nickname || selling.street || 'their home') : null,
    personal: personalTouch(c.personal),
    aiSummary: c.aiSummary || null,
    notes: c.notes ? truncate(c.notes, 400) : null,
  };
}

function factsBlock(f) {
  if (!f) return 'Client: unknown number (not in the CRM).';
  return [
    `Client: ${f.name} (${f.type || 'client'}${f.isWhale ? ', VIP' : ''})`,
    f.openDeal ? `Open deal: ${f.openDeal.label}${f.openDeal.address ? ` — ${f.openDeal.address}` : ''}` : null,
    f.search ? `Looking for: ${f.search}` : null,
    f.selling ? `May sell: ${f.selling}` : null,
    f.aiSummary ? `Profile: ${truncate(f.aiSummary, 300)}` : null,
  ].filter(Boolean).join('\n');
}

function threadBlock(thread) {
  return thread.map((m) => `${m.who === 'agent' ? 'AGENT' : 'CLIENT'}: ${truncate(m.text, 400)}`).join('\n');
}

function ago(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.round(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

// ── reply suggestions ─────────────────────────────────────────────────────
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function topicOf(text) {
  const t = String(text || '').toLowerCase();
  const intent = detectIntent(text);
  if (intent) return intent.id;
  if (/\b(thank|thanks|thx|appreciate|amazing|perfect|great news|congrat)/.test(t)) return 'thanks';
  if (/\b(price|asking|how much|cost|reduced|drop)\b/.test(t)) return 'price';
  if (/\b(photo|pics?|pictures|video|floor ?plan)\b/.test(t)) return 'media';
  if (t.includes('?')) return 'question';
  if (/\b(sounds good|ok|okay|works|deal|yes|yep|sure)\b/.test(t)) return 'ack';
  return 'other';
}

function fallbackSuggestions(lastInbound, first) {
  const text = String(lastInbound || '');
  const day = DAYS.find((d) => text.toLowerCase().includes(d));
  const Day = day ? day[0].toUpperCase() + day.slice(1) : null;
  const n = first ? `, ${first}` : '';
  const byTopic = {
    showing: [
      ['warm', `${Day ? `${Day} works` : 'Absolutely'}${n} — I can do 11 or 2. Which is better for you?`],
      ['direct', 'Let me confirm with the listing agent and lock in a time. I’ll text you within the hour.'],
      ['informational', 'Want me to line up one or two others nearby while we’re out? Makes the trip worth it.'],
    ],
    offer: [
      ['direct', 'Let’s talk strategy — do you have 10 minutes this afternoon?'],
      ['informational', 'I’ll pull the latest comps tonight so we go in strong and clean.'],
      ['warm', 'I think there’s room. Let me feel out the listing agent first and report back.'],
    ],
    hoa: [
      ['informational', 'Great question — I’ll pull the exact HOA, taxes and insurance and send the full breakdown shortly.'],
      ['direct', 'Let me confirm the current numbers with the association and get right back to you.'],
      ['warm', 'Happy to walk you through all the carrying costs — want to hop on a quick call?'],
    ],
    valuation: [
      ['warm', `Would love to${n}. I’ll put together a full CMA with recent sales on your street.`],
      ['direct', 'I can have a valuation to you by tomorrow. Any upgrades since you bought I should factor in?'],
      ['informational', 'Values in your area have moved a lot this year — I’ll send the numbers and what’s driving them.'],
    ],
    listing: [
      ['warm', `Exciting${n}! Let’s sit down this week — I’ll bring a pricing strategy and a marketing plan.`],
      ['direct', 'When works for a walkthrough? 30 minutes is all I need to start pricing it.'],
      ['informational', 'I’ll send what similar homes sold for recently so you can see where you’d land.'],
    ],
    financing: [
      ['informational', 'I work with two private-bank lenders who move fast on jumbo — want an intro to both?'],
      ['direct', 'Let me connect you with my lender today so you’re pre-approved before we write anything.'],
      ['warm', 'Smart to get ahead of it. I’ll make the intro and cc you.'],
    ],
    documents: [
      ['direct', 'On it — I’ll send everything over within the hour.'],
      ['informational', 'I’ll request the full package from the listing agent and forward it as soon as it lands.'],
      ['warm', 'Of course. Anything else you want me to grab while I’m at it?'],
    ],
    callback: [
      ['direct', 'Calling you in 5 minutes.'],
      ['warm', 'Of course — is now good, or later this afternoon?'],
      ['informational', 'Tied up for a bit — can I call you at 4?'],
    ],
    thanks: [
      ['warm', `Anytime${n}! Always happy to help.`],
      ['direct', 'My pleasure. Talk soon!'],
      ['informational', 'Of course — let me know if anything else comes up.'],
    ],
    price: [
      ['informational', 'Let me pull the latest numbers and the price history and send them over.'],
      ['direct', 'Good question — I’ll find out where the seller’s head is at and get back to you today.'],
      ['warm', 'Want to talk it through? I have some thoughts on value here.'],
    ],
    media: [
      ['direct', 'I’ll send more photos and the floor plan shortly.'],
      ['informational', 'I can do a quick video walkthrough for you this week if that helps.'],
      ['warm', 'Absolutely — anything specific you want a closer look at?'],
    ],
    question: [
      ['direct', 'Good question — let me check and get right back to you.'],
      ['warm', `Yes${n}, happy to. I’ll send details shortly.`],
      ['informational', 'Easier to explain live — want to jump on a quick call?'],
    ],
    ack: [
      ['warm', `Perfect${n}! I’ll take care of it.`],
      ['direct', 'Great — I’ll send a confirmation shortly.'],
      ['informational', 'Sounds good. I’ll keep you posted on next steps.'],
    ],
    other: [
      ['warm', `Thanks${n}! I’ll follow up shortly.`],
      ['direct', 'Got it — I’m on it.'],
      ['informational', 'Want to hop on a quick call to talk it through?'],
    ],
  };
  const list = byTopic[topicOf(text)] || byTopic.other;
  return list.map(([tone, t], i) => ({ id: `fb${i}`, tone, text: t }));
}

const suggestCache = new Map(); // `${conversationId}:${lastMessageId}` -> { at, value }

async function suggestReplies({ workspaceId, conversationId, refresh = false }) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true, clientId: true } });
  if (!conv) return { suggestions: [], source: 'none' };
  const thread = await loadThread(workspaceId, conversationId, 14);
  const last = thread[thread.length - 1];
  if (!last || last.who !== 'client') return { suggestions: [], source: 'none', reason: 'no_unanswered_inbound' };
  const key = `${conversationId}:${last.id}`;
  const hit = suggestCache.get(key);
  if (hit && !refresh && hit.at > Date.now() - 10 * 60_000) return hit.value;

  const facts = await clientFacts(workspaceId, conv.clientId);
  const first = facts ? facts.first : '';
  let value = { suggestions: fallbackSuggestions(last.text, first), source: 'fallback', forMessageId: last.id };
  if (ai.available()) {
    const agent = await agentFirstName(workspaceId);
    const out = await withTimeout(ai.json({
      system: `You are ${config.brand.assistantName}, the AI co-pilot for a luxury real estate agent${agent ? ` named ${agent}` : ''}. Write exactly 3 short text-message replies the agent could send next. Rules: each under 220 characters; plain text; sound like a polished, warm, human agent; vary the approach (one warm, one direct, one informational); use only facts present in the thread or context — never invent prices, availability, addresses, HOA figures, dates or times the agent didn't offer; when facts are missing, offer to get them; no emoji unless the client used one; at most one exclamation mark per reply; never give legal or tax advice. ${FAIR_HOUSING}`,
      prompt: `${factsBlock(facts)}\n\nTHREAD (oldest first):\n${threadBlock(thread)}\n\nWrite 3 replies to the client's last message.`,
      schema: { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'object', properties: { tone: { type: 'string' }, text: { type: 'string' } } } } } },
      effort: 'low', maxTokens: 1200, feature: 'reply_suggestions', workspaceId,
    }), AI_TIMEOUT, null);
    const list = out && Array.isArray(out.suggestions) ? out.suggestions.filter((s) => s && s.text).slice(0, 3) : [];
    if (list.length === 3) {
      value = { suggestions: list.map((s, i) => ({ id: `ai${i}`, tone: s.tone || 'warm', text: truncate(s.text.trim(), 280) })), source: 'ai', forMessageId: last.id };
    }
  }
  suggestCache.set(key, { at: Date.now(), value });
  return value;
}

// ── thread summary ────────────────────────────────────────────────────────
function fallbackSummary(thread, facts) {
  const lastIn = [...thread].reverse().find((m) => m.who === 'client');
  const topic = lastIn ? topicOf(lastIn.text) : 'other';
  const first = facts ? facts.first : 'They';
  const map = {
    showing: `${first} wants to schedule a showing`, offer: `${first} is weighing an offer`, hoa: `${first} asked about HOA / carrying costs`,
    valuation: `${first} wants to know what their home is worth`, listing: `${first} is thinking about selling`,
    financing: `${first} asked about financing`, documents: `${first} asked for documents`, callback: `${first} asked for a call`,
    thanks: `${first} said thanks`, price: `${first} asked about price`, media: `${first} asked for more photos`,
    question: `${first} asked a question`, ack: `${first} confirmed`, other: lastIn ? `Latest from ${first}: ${truncate(lastIn.text, 90)}` : 'No messages from them yet',
  };
  const urgency = { showing: 8, offer: 9, callback: 8, hoa: 6, valuation: 6, listing: 8, financing: 6, documents: 6, price: 6, question: 6, media: 5, thanks: 2, ack: 3, other: 4 }[topic] || 4;
  const intent = { showing: 'scheduling', offer: 'offer', callback: 'callback_request', question: 'question', hoa: 'question', price: 'question', thanks: 'small_talk', ack: 'informational' }[topic] || 'other';
  return { summary: map[topic], intent, urgency, topic };
}

async function summarizeThread({ workspaceId, conversationId, refresh = false }) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId } });
  if (!conv) return null;
  if (!refresh && conv.aiSummary && conv.aiSummaryAt && conv.lastMessageAt && new Date(conv.aiSummaryAt) >= new Date(conv.lastMessageAt)) {
    return { summary: conv.aiSummary, source: 'cache' };
  }
  const thread = await loadThread(workspaceId, conversationId, 40);
  const facts = await clientFacts(workspaceId, conv.clientId);
  let out = { ...fallbackSummary(thread, facts), source: 'fallback' };
  if (ai.available() && thread.length >= 4) {
    const res = await withTimeout(ai.json({
      system: `Summarize a text thread between a luxury real estate agent and a client for the agent's inbox. summary: one sentence, max 140 chars, sentence case, no trailing period, state where things stand and what the client wants next. intent: one of question|scheduling|offer|callback_request|objection|informational|small_talk|other. urgency: 1-10 (higher for showing/offer timing pressure, unanswered questions, frustration). Never invent facts. ${FAIR_HOUSING}`,
      prompt: `${factsBlock(facts)}\n\nTHREAD:\n${threadBlock(thread)}`,
      schema: { type: 'object', properties: { summary: { type: 'string' }, intent: { type: 'string' }, urgency: { type: 'number' } } },
      effort: 'low', maxTokens: 800, feature: 'thread_summary', workspaceId,
    }), AI_TIMEOUT, null);
    if (res && res.summary) out = { summary: truncate(res.summary, 160), intent: res.intent || out.intent, urgency: Math.max(1, Math.min(10, Math.round(res.urgency || out.urgency))), source: 'ai' };
  }
  if (out.source === 'ai') {
    await prisma.conversation.update({ where: { id: conv.id }, data: { aiSummary: out.summary, aiSummaryAt: new Date() } }).catch(() => {});
  }
  return out;
}

// ── inbox pinned AI card ──────────────────────────────────────────────────
const cardCache = new Map(); // workspaceId -> { key, at, value }

async function inboxCard({ workspaceId }) {
  const convs = await prisma.conversation.findMany({
    where: { workspaceId, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active', lastMessageFromMe: false },
    orderBy: { lastMessageAt: 'desc' },
    take: 25,
    include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true, isWhale: true, rating: true, contactKind: true, lifetimeVolume: true } } },
  });
  if (!convs.length) return { card: null };
  const key = convs.map((c) => `${c.id}:${new Date(c.lastMessageAt || 0).getTime()}`).join('|');
  const hit = cardCache.get(workspaceId);
  if (hit && hit.key === key && hit.at > Date.now() - 3 * 60_000) return hit.value;

  const scored = [];
  for (const c of convs) {
    const lastIn = await prisma.message.findFirst({
      where: { workspaceId, conversationId: c.id, isFromMe: false },
      orderBy: { sentAt: 'desc' },
      select: { body: true, sentAt: true },
    });
    const text = (lastIn && lastIn.body) || c.lastMessagePreview || '';
    const topic = topicOf(text);
    const waitedMin = lastIn ? (Date.now() - new Date(lastIn.sentAt).getTime()) / 60000 : 0;
    let score = Math.min(6, waitedMin / 60); // up to +6 for 6h of waiting
    if (text.includes('?')) score += 3;
    if (['showing', 'offer', 'callback', 'listing'].includes(topic)) score += 4;
    else if (['hoa', 'valuation', 'financing', 'documents', 'price', 'question'].includes(topic)) score += 2;
    if (c.client && (c.client.isWhale || (c.client.lifetimeVolume || 0) >= 10_000_000)) score += 3;
    if (c.client && c.client.rating) score += c.client.rating * 0.4;
    if (c.client && c.client.contactKind && c.client.contactKind !== 'client') score -= 1;
    const name = c.client ? clientName(c.client) : (c.displayName || c.handle);
    const first = c.client ? (firstNameOf(c.client) || name) : name;
    scored.push({ c, text, topic, score, name, first, at: lastIn ? lastIn.sentAt : c.lastMessageAt });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const reasonFor = (s) => {
    const fb = fallbackSummary([{ who: 'client', text: s.text }], { first: s.first });
    return `${fb.summary} · ${ago(s.at)}`;
  };
  let items = top.map((s) => ({
    conversationId: s.c.id,
    clientId: s.c.clientId,
    name: s.name,
    isWhale: !!(s.c.client && s.c.client.isWhale),
    reason: reasonFor(s),
    quote: truncate(s.text, 120),
    urgency: Math.max(1, Math.min(10, Math.round(s.score))),
  }));
  let source = 'fallback';
  if (ai.available()) {
    const res = await withTimeout(ai.json({
      system: `You help a luxury real estate agent triage unread texts. For each thread, write a reason under 70 characters that says what the client needs (e.g. "Wants to see 41 Indian Creek Saturday"). Keep the given order. Never invent facts. ${FAIR_HOUSING}`,
      prompt: top.map((s, i) => `${i + 1}. ${s.name}: "${truncate(s.text, 300)}"`).join('\n'),
      schema: { type: 'object', properties: { reasons: { type: 'array', items: { type: 'string' } } } },
      effort: 'low', maxTokens: 600, feature: 'inbox_triage', workspaceId,
    }), 9000, null);
    if (res && Array.isArray(res.reasons) && res.reasons.length === items.length) {
      items = items.map((it, i) => ({ ...it, reason: `${truncate(String(res.reasons[i] || '').trim(), 80)} · ${ago(top[i].at)}` }));
      source = 'ai';
    }
  }
  const lead = top[0];
  const value = {
    card: {
      label: 'Needs you first',
      title: top.length === 1 ? `${lead.first} is waiting on you` : `${lead.first} and ${top.length - 1} more are waiting on you`,
      items,
      unreadThreads: convs.length,
      source,
    },
  };
  cardCache.set(workspaceId, { key, at: Date.now(), value });
  return value;
}

// ── relationship briefing (thread header) ─────────────────────────────────
async function briefing({ workspaceId, clientId }) {
  const f = await clientFacts(workspaceId, clientId);
  if (!f) return { briefing: null };
  const lastTouch = f.lastContactedAt
    ? `${ago(f.lastContactedAt)}${f.lastInboundAt && f.lastOutboundAt ? (new Date(f.lastInboundAt) > new Date(f.lastOutboundAt) ? ' · they texted last' : ' · you texted last') : ''}`
    : 'No contact yet';
  const stage = f.openDeal
    ? `${f.openDeal.label}${f.openDeal.address ? ` · ${f.openDeal.address}` : ''}`
    : (f.closedCount ? `${f.closedCount} closed deal${f.closedCount === 1 ? '' : 's'} with you` : (f.status ? f.status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null));
  const lookingFor = f.search || (f.selling ? `Thinking of selling ${f.selling}` : null);
  let nextStep = null;
  if (f.openDeal && f.openDeal.stage === 'under_contract' && f.openDeal.closingDate) {
    nextStep = `Closing ${new Date(f.openDeal.closingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — keep the timeline tight`;
  } else if (f.openDeal && ['touring', 'consultation'].includes(f.openDeal.stage)) {
    nextStep = 'Line up the next round of showings';
  } else if (f.selling) {
    nextStep = 'Offer a fresh valuation';
  }
  return {
    briefing: {
      clientId: f.id,
      name: f.name,
      isWhale: f.isWhale,
      lastTouch,
      stage,
      lookingFor,
      personalTouch: f.personal,
      nextStep,
      summary: f.aiSummary ? truncate(f.aiSummary, 220) : null,
    },
    source: 'data',
  };
}

// ── QuickText "Draft with AI" ─────────────────────────────────────────────
function fallbackDraft({ first, context, facts }) {
  const n = first || 'there';
  const ctx = String(context || '').toLowerCase();
  if (/listing|match|came up|just listed|new to market|pocket/.test(ctx)) return `Hi ${n}, a home just came up that fits what you're looking for — want me to send you the details?`;
  if (/price (drop|reduc)|reduced/.test(ctx)) return `Hi ${n}, quick heads up: the price just came down on a home you liked. Want to take another look?`;
  if (/birthday/.test(ctx)) return `Happy birthday, ${n}! Hope it's a great one.`;
  if (/anniversar/.test(ctx)) return `Hi ${n}, happy home anniversary! Hard to believe it's been a year — hope you're loving it.`;
  if (/showing|tour/.test(ctx)) return `Hi ${n}, confirming our showing — let me know if the time still works for you.`;
  if (/closing|closed|keys/.test(ctx)) return `Hi ${n}, just checking in after closing — how are you settling in?`;
  if (/follow.?up|check.?in/.test(ctx) || !ctx) {
    if (facts && facts.search) return `Hi ${n}, checking in — still keeping an eye out for ${facts.search.toLowerCase()}. Anything new on your end?`;
    return `Hi ${n}, just checking in — anything I can help with this week?`;
  }
  return `Hi ${n}, ${truncate(String(context), 140)}`;
}

async function draftText({ workspaceId, clientId, conversationId, context, instruction }) {
  let cid = clientId;
  if (!cid && conversationId) {
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { clientId: true } });
    cid = conv && conv.clientId;
  }
  const facts = await clientFacts(workspaceId, cid);
  const first = facts ? facts.first : '';
  const fallback = { text: fallbackDraft({ first, context: instruction || context, facts }), source: 'fallback' };
  if (!ai.available()) return fallback;
  let thread = [];
  if (conversationId) thread = await loadThread(workspaceId, conversationId, 10);
  else if (cid) {
    const conv = await prisma.conversation.findFirst({ where: { workspaceId, clientId: cid }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });
    if (conv) thread = await loadThread(workspaceId, conv.id, 10);
  }
  const agent = await agentFirstName(workspaceId);
  const out = await withTimeout(ai.json({
    system: `You draft ONE text message from a luxury real estate agent${agent ? ` named ${agent}` : ''} to a client. 1–2 sentences, under 240 characters, warm and confident, start with the client's first name, no emoji, no exclamation marks unless celebrating, one clear ask at most, plain text, no URLs unless provided. Never invent prices, addresses or dates. ${FAIR_HOUSING}`,
    prompt: `${factsBlock(facts)}\n${thread.length ? `\nRECENT THREAD:\n${threadBlock(thread)}\n` : ''}\nWHAT THE TEXT IS ABOUT: ${instruction || context || 'a friendly check-in'}`,
    schema: { type: 'object', properties: { text: { type: 'string' } } },
    effort: 'medium', maxTokens: 1200, feature: 'quick_text_draft', workspaceId,
  }), AI_TIMEOUT, null);
  if (out && out.text) return { text: truncate(out.text.trim(), 320), source: 'ai' };
  return fallback;
}

// ── demo provider: the client's side of the conversation ─────────────────
const CANNED = {
  listing: ['Wow. That kitchen. Can we see it this weekend?', 'Love the light in that one. Is the dock deep enough for our boat?', 'Very interesting — what do you think it would actually trade at?', 'Send me the floor plan? I want to see the layout.'],
  showing: ['Saturday at 11 works for us.', 'Can we do 2pm instead? Morning is packed.', 'Perfect, see you there. Should we meet out front?', 'Works! Thanks for setting it up so fast.'],
  offer: ['What do you think they’d take? We’re thinking closer to asking minus 5.', 'Let’s talk tonight. I want to move before someone else does.', 'Okay. Let’s write it — clean, quick close.'],
  price: ['That’s a little more than we wanted, but I’m open if it’s the one.', 'Has it come down at all since it listed?', 'Fair. What are the carrying costs looking like?'],
  question: ['Yes, that works for me.', 'Let me check my calendar and get back to you tonight.', 'Good question — I’d say yes, as long as the timing works.', 'Honestly not sure yet. Can we talk tomorrow?'],
  thanks: ['Thank you! Couldn’t have done it without you.', 'You’re the best. Talk soon.', 'Appreciate you!'],
  checkin: ['Hi! All good here. Still thinking about the waterfront place honestly.', 'Busy week but yes, still looking. Anything new?', 'Hey! Doing well. Let’s catch up next week.'],
  docs: ['Perfect, got it. Will review tonight.', 'Thanks — the survey is exactly what I needed.', 'Great, I’ll forward to our attorney.'],
  other: ['Sounds good, thanks!', 'Perfect. Talk soon.', 'Got it 👍', 'Great — keep me posted.', 'Love it. Let’s do it.'],
};

function cannedReply(lastOutbound) {
  const t = String((lastOutbound && lastOutbound.body) || '').toLowerCase();
  let bucket = 'other';
  if (lastOutbound && lastOutbound.kind === 'listing') bucket = 'listing';
  else if (/\b(showing|tour|see it|walk ?through|saturday|sunday|tomorrow|this weekend|available|works for you|what time|\d{1,2}(:\d{2})?\s?(am|pm))\b/.test(t)) bucket = 'showing';
  else if (/\b(offer|counter|comps|strategy|asking)\b/.test(t)) bucket = 'offer';
  else if (/\b(price|reduced|dropped|\$\d|million|carrying)\b/.test(t)) bucket = 'price';
  else if (/\b(attached|sent|here('s| is| are) the|disclosures?|survey|floor ?plan|documents?)\b/.test(t)) bucket = 'docs';
  else if (/\b(congrat|thank|welcome home|keys)\b/.test(t)) bucket = 'thanks';
  else if (/\b(checking in|how are|hope you|how's|hows)\b/.test(t)) bucket = 'checkin';
  else if (t.includes('?')) bucket = 'question';
  else if (/https?:\/\//.test(t)) bucket = 'listing';
  const list = CANNED[bucket];
  return list[Math.floor(Math.random() * list.length)];
}

async function demoClientReply({ workspaceId, conversationId, client, lastOutbound }) {
  const fallback = cannedReply(lastOutbound);
  if (!ai.available()) return fallback;
  const facts = client ? await clientFacts(workspaceId, client.id) : null;
  const thread = await loadThread(workspaceId, conversationId, 10);
  const agent = await agentFirstName(workspaceId);
  const out = await withTimeout(ai.json({
    system: `You are role-playing ${facts ? facts.name : 'a client'}, a client of a luxury real estate agent${agent ? ` named ${agent}` : ''}. Reply to the agent's latest text with ONE short, natural text (under 160 characters), in a believable voice — casual, sometimes brief, may ask one follow-up question or propose a time. Stay consistent with the thread and the client's situation. Plain text; at most one emoji and usually none. Never mention being an AI. ${FAIR_HOUSING}`,
    prompt: `${factsBlock(facts)}\n\nTHREAD (oldest first; you are CLIENT):\n${threadBlock(thread)}\n\nWrite the client's next text.`,
    schema: { type: 'object', properties: { text: { type: 'string' } } },
    effort: 'low', maxTokens: 600, feature: 'demo_client_reply', workspaceId,
  }), 12000, null);
  if (out && out.text && out.text.length < 400) return out.text.trim();
  return fallback;
}

module.exports = {
  suggestReplies, summarizeThread, inboxCard, briefing, draftText, demoClientReply,
  fallbackSuggestions, fallbackSummary, cannedReply, topicOf, clientFacts, loadThread, STAGE_LABEL,
};

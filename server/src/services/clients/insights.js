// Client insights — the AI contact summary (markdown, feeds the planner +
// the card's status line) and the relationship briefing (card Profile tab).
// Both are co-pilot outputs with deterministic fallbacks: the card always has
// something useful to show, with or without an Anthropic key.
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const { HttpError } = require('../../lib/http');
const S = require('./serialize');
const { moneyShort } = require('./text');

const FAIR_HOUSING = `FAIR HOUSING (non-negotiable): never state, infer, or speculate about protected characteristics — race, color, religion, national origin, sex, gender identity, sexual orientation, disability, familial status, age, marital status — and never describe or recommend neighborhoods by who lives there, schools-as-proxy, or demographics. Talk only about property attributes, explicitly named locations, timing, money and the relationship. Personal touch points may only repeat facts the agent explicitly recorded.`;

// ── bundle ───────────────────────────────────────────────────────────────
async function bundleFor(workspaceId, clientId) {
  const tz = await S.workspaceTz(workspaceId);
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    include: {
      properties: true,
      searches: { where: { status: { not: 'found' } } },
      links: { include: { relatedClient: { select: S.MINI_SELECT } } },
      linkedFrom: { include: { client: { select: S.MINI_SELECT } } },
    },
  });
  if (!client) throw new HttpError(404, 'Client not found');
  const now = new Date();
  const [messages, calls, notes, deals, nextAppt, lastAppt, tasks] = await Promise.all([
    prisma.message.findMany({ where: { workspaceId, clientId }, orderBy: { sentAt: 'desc' }, take: 40, select: { body: true, isFromMe: true, sentAt: true, service: true } }),
    prisma.phoneCall.findMany({ where: { workspaceId, clientId }, orderBy: { startedAt: 'desc' }, take: 5, select: { direction: true, status: true, durationSec: true, summary: true, startedAt: true } }),
    prisma.note.findMany({ where: { workspaceId, clientId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 8, select: { body: true, createdAt: true, pinned: true } }),
    prisma.deal.findMany({ where: { workspaceId, clientId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 6, select: { title: true, side: true, stage: true, price: true, contractPrice: true, salePrice: true, propertyLabel: true, propertyAddress: true, closingDate: true, closedAt: true } }),
    prisma.appointment.findFirst({ where: { workspaceId, clientId, startAt: { gte: now }, status: { notIn: ['cancelled'] } }, orderBy: { startAt: 'asc' }, select: { title: true, type: true, startAt: true, location: true } }),
    prisma.appointment.findFirst({ where: { workspaceId, clientId, startAt: { lt: now } }, orderBy: { startAt: 'desc' }, select: { title: true, type: true, startAt: true, outcome: true } }),
    prisma.task.findMany({ where: { workspaceId, clientId, status: 'pending' }, orderBy: { dueAt: 'asc' }, take: 5, select: { title: true, dueAt: true, dueDate: true } }),
  ]);
  const properties = client.properties.map((p) => S.serializeProperty(p, tz));
  const lastTouch = [client.lastContactedAt, client.lastInboundAt, client.lastOutboundAt, messages[0]?.sentAt, calls[0]?.startedAt]
    .filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
  return { tz, client, properties, searches: client.searches.map(S.serializeSearch), messages: messages.reverse(), calls, notes, deals, nextAppt, lastAppt, tasks, lastTouch };
}

const STAGE_LABEL = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted', under_contract: 'Under contract',
  closed: 'Closed', seller_lead: 'Seller lead', listing_appt: 'Listing appointment', active: 'Listed', offer_received: 'Offer received', lost: 'Lost',
  unit_selection: 'Unit selection', pricing_received: 'Pricing received', priority_list: 'Priority list', reserved: 'Reserved', building_delivered: 'Building delivered',
};
const TYPE_LABEL = { buyer: 'Buyer', seller: 'Seller', buyer_seller: 'Buyer & seller', investor: 'Investor', renter: 'Renter', landlord: 'Landlord', developer: 'Developer', sphere: 'Sphere' };

function first(c) { return c.firstName || S.displayNameOf(c).split(' ')[0]; }
function daysAgo(d) { return d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : null; }
function agoLabel(d) {
  const n = daysAgo(d);
  if (n == null) return null;
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n}d ago`;
}

function portfolioLine(b) {
  const owned = b.properties.filter((p) => ['owns', 'leased_out'].includes(p.relationship));
  const rents = b.properties.filter((p) => p.relationship === 'rents');
  const parts = [];
  if (owned.length) {
    const desc = owned.slice(0, 2).map((p) => [p.neighborhood || p.city, p.occupancy ? p.occupancy.replace('_', ' ') : null].filter(Boolean).join(' ')).filter(Boolean);
    parts.push(`Owns ${owned.length}${desc.length ? ` (${desc.join(', ')})` : ''}`);
  }
  if (rents.length) parts.push(`rents in ${rents[0].neighborhood || rents[0].city || 'town'}`);
  const arm = owned.map((p) => p.derived.daysToReset).filter((d) => d != null && d >= 0 && d <= 365).sort((a, z) => a - z)[0];
  if (arm != null) parts.push(`ARM resets in ${arm} days`);
  const lease = rents.map((p) => p.derived.daysToLeaseEnd).filter((d) => d != null && d >= 0 && d <= 180).sort((a, z) => a - z)[0];
  if (lease != null) parts.push(`lease ends in ${lease} days`);
  const active = b.searches.filter((s) => s.bucket !== 'dream' && s.status === 'active');
  if (active.length) {
    const s = active[0];
    parts.push(`searching ${s.title.toLowerCase()}${s.priceMax ? ` ≤ ${moneyShort(s.priceMax)}` : ''}`);
  } else if (b.searches.length) parts.push(`dreams of ${b.searches[0].title.toLowerCase()}`);
  return parts.join(' · ') || null;
}

function dealLine(b) {
  const open = b.deals.filter((d) => !['closed', 'lost'].includes(d.stage));
  if (!open.length) return null;
  const d = open[0];
  const label = d.propertyLabel || d.propertyAddress || d.title || (d.side === 'listing' ? 'their listing' : 'a purchase');
  const price = d.contractPrice || d.price || d.salePrice;
  return `${STAGE_LABEL[d.stage] || d.stage} · ${label}${price ? ` · ${moneyShort(price)}` : ''}`;
}

// Any personal value (string · list · {name, age} · [{name, lengthFt}]) → text.
function fmtPersonal(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(fmtPersonal).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.name && v.lengthFt) return `${v.name} (${v.lengthFt}′${v.kind ? ` ${v.kind}` : ''})`;
    if (v.name && v.age != null) return `${v.name} (${v.age})`;
    if (v.name) return v.name;
    return Object.values(v).filter((x) => typeof x === 'string' || typeof x === 'number').join(' · ');
  }
  return String(v);
}
const firstOf = (v) => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? firstOf(v[0]) : null;
  if (typeof v === 'object') return v.name || null;
  return String(v).split(/[,;—–]/)[0].trim() || null;
};

// Fair Housing: origin / nationality / religion never leave the record.
const PERSONAL_KEYS = [
  ['spouse', 'Spouse'], ['kids', 'Kids'], ['pets', 'Pets'], ['hobbies', 'Hobbies'], ['clubs', 'Clubs'],
  ['favoriteRestaurants', 'Restaurants'], ['restaurants', 'Restaurants'], ['wine', 'Wine'], ['boats', 'Boats'], ['art', 'Art'],
  ['coffee', 'Coffee'], ['anniversary', 'Anniversary'], ['other', 'Notes'],
];

function personalPoints(c, links, { forAi = false } = {}) {
  const p = (c.personal && typeof c.personal === 'object') ? c.personal : {};
  const out = [];
  const { PROTECTED } = require('./reparse');
  const spouseLink = (links || []).find((l) => ['spouse', 'partner'].includes(l.relation));
  if (!p.spouse && spouseLink) out.push(`Spouse: ${S.displayNameOf(spouseLink.client)}`);
  for (const [key, label] of PERSONAL_KEYS) {
    if (forAi && key === 'kids') continue; // familial status never goes to the model
    const s = fmtPersonal(p[key]);
    if (s) out.push(`${label}: ${s}`);
  }
  const facts = (c.aiFacts && Array.isArray(c.aiFacts.touchPoints)) ? c.aiFacts.touchPoints : [];
  for (const t of facts) if (out.length < 10 && !(forAi && PROTECTED.test(String(t)))) out.push(String(t));
  return out.slice(0, 10);
}

function iceBreakersFrom(c) {
  const p = (c.personal && typeof c.personal === 'object') ? c.personal : {};
  const out = [];
  const boat = firstOf(p.boats);
  const hobby = firstOf(p.hobbies);
  const resto = firstOf(p.favoriteRestaurants || p.restaurants);
  if (boat) out.push(`How’s ${boat} running this season?`);
  if (p.wine) out.push(`Opened anything good lately? Still on ${firstOf(p.wine)}?`);
  if (resto) out.push(`Been back to ${resto} recently?`);
  if (hobby) out.push(`Getting much ${hobby.toLowerCase()} in lately?`);
  if (p.art) out.push(`Any new work since we last talked about ${firstOf(p.art).toLowerCase()}?`);
  if (p.clubs) out.push(`See you at ${firstOf(p.clubs)} soon?`);
  const pet = firstOf(p.pets);
  if (pet) out.push(`How’s ${pet.split(' ')[0]} doing?`);
  return out.slice(0, 3);
}

function recommendedMove(b) {
  const c = b.client;
  const name = first(c);
  const open = b.deals.filter((d) => !['closed', 'lost'].includes(d.stage));
  const uc = open.find((d) => d.stage === 'under_contract');
  if (uc) return `Keep ${name}’s closing on rails — confirm inspection, appraisal and the closing date this week.`;
  const offer = open.find((d) => ['offer_submitted', 'offer_received'].includes(d.stage));
  if (offer) return `Offer is live — update ${name} today, even if there’s no news.`;
  const owned = b.properties.filter((p) => ['owns', 'leased_out'].includes(p.relationship));
  const arm = owned.filter((p) => p.derived.daysToReset != null && p.derived.daysToReset >= 0 && p.derived.daysToReset <= 180).sort((a, z) => a.derived.daysToReset - z.derived.daysToReset)[0];
  if (arm) return `${name}’s ARM on ${arm.title} resets in ${arm.derived.daysToReset} days — open the refi-or-sell conversation.`;
  const lease = b.properties.find((p) => p.relationship === 'rents' && p.derived.daysToLeaseEnd != null && p.derived.daysToLeaseEnd >= 0 && p.derived.daysToLeaseEnd <= 120);
  if (lease) return `Lease ends in ${lease.derived.daysToLeaseEnd} days — start the buy-vs-renew conversation with ${name}.`;
  const anniv = owned.find((p) => p.derived.anniversaryInDays != null && p.derived.anniversaryInDays <= 30);
  if (anniv) return `${anniv.derived.anniversaryYears} years at ${anniv.title} — send ${name} an equity check-in.`;
  if (owned.some((p) => p.thinkingOfSelling)) return `${name} is thinking of selling — offer a private valuation before another agent does.`;
  const silent = daysAgo(b.lastTouch);
  const active = b.searches.find((s) => s.bucket !== 'dream' && s.status === 'active');
  if (active && (silent == null || silent >= 3)) return `Send ${name} the two or three best new matches for “${active.title}”.`;
  if (b.nextAppt) return `Prep for ${b.nextAppt.title.toLowerCase()} — have comps and the route ready.`;
  if (silent != null && silent >= 21) return `Silent ${silent} days — reconnect with a personal note and one relevant market insight.`;
  return `Keep ${name} warm — share one listing or market note that fits what they care about.`;
}

function statusLine(b) {
  const c = b.client;
  const parts = [];
  const type = TYPE_LABEL[c.type] || null;
  const status = { lead: 'Lead', active: 'Active', past_client: 'Past client', sphere: 'Sphere', inactive: 'Inactive' }[c.status];
  if (c.contactKind === 'vendor' || c.contactKind === 'partner') parts.push(c.vendorRole ? c.vendorRole.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase()) : (c.contactKind === 'vendor' ? 'Vendor' : 'Partner'));
  else parts.push([status === 'Active' ? null : status, type].filter(Boolean).join(' ') || 'Client');
  const deal = dealLine(b);
  if (deal) parts.push(deal);
  else {
    const pl = portfolioLine(b);
    if (pl) parts.push(pl.split(' · ').slice(0, 2).join(' · '));
  }
  const ago = agoLabel(b.lastTouch);
  if (ago) parts.push(daysAgo(b.lastTouch) >= 21 ? `silent ${daysAgo(b.lastTouch)} days` : `last touch ${ago}`);
  return parts.join(' · ');
}

function lastContactSummary(b) {
  const lastMsg = b.messages[b.messages.length - 1];
  const lastCall = b.calls[0];
  const msgAt = lastMsg ? new Date(lastMsg.sentAt) : null;
  const callAt = lastCall ? new Date(lastCall.startedAt) : null;
  if (!msgAt && !callAt) return b.lastTouch ? `Last contact ${agoLabel(b.lastTouch)}.` : 'No conversations logged yet.';
  if (callAt && (!msgAt || callAt > msgAt)) return `Last contact ${agoLabel(callAt)} — ${lastCall.direction === 'inbound' ? 'they called' : 'you called'}${lastCall.summary ? `: ${lastCall.summary.slice(0, 140)}` : '.'}`;
  return `Last contact ${agoLabel(msgAt)} — ${lastMsg.isFromMe ? 'you texted' : 'they texted'}: “${(lastMsg.body || '').slice(0, 120)}”`;
}

function fallbackBriefing(b) {
  return {
    statusLine: statusLine(b),
    recommendedMove: recommendedMove(b),
    iceBreakers: iceBreakersFrom(b.client),
    personalTouchPoints: personalPoints(b.client, [...(b.client.links || []).map((l) => ({ relation: l.relation, client: l.relatedClient })), ...(b.client.linkedFrom || []).map((l) => ({ relation: l.relation, client: l.client }))]),
    portfolioContext: portfolioLine(b),
    dealContext: dealLine(b),
    toneNotes: (b.client.aiFacts && typeof b.client.aiFacts.style === 'string') ? b.client.aiFacts.style : null,
    lastContactSummary: lastContactSummary(b),
    generatedAt: new Date().toISOString(),
    source: 'fallback',
  };
}

function contextText(b) {
  const c = b.client;
  const lines = [];
  lines.push(`CLIENT: ${S.displayNameOf(c)} (${c.contactKind}${c.type ? `, ${c.type}` : ''}, status ${c.status}, rating ${c.rating}/5${c.isWhale ? ', WHALE' : ''})`);
  if (c.company || c.jobTitle) lines.push(`Work: ${[c.jobTitle, c.company].filter(Boolean).join(' at ')}`);
  lines.push(`Lifetime volume ${moneyShort(c.lifetimeVolume || 0)} across ${c.transactionsCount || 0} closings. Lead source: ${c.leadSource || 'unknown'}.`);
  if (c.financing || c.timeline || c.motivation) lines.push(`Financing: ${c.financing || '—'}${c.preApprovalAmount ? ` (pre-approved ${moneyShort(c.preApprovalAmount)})` : ''} · Timeline: ${c.timeline || '—'} · Motivation: ${c.motivation || '—'}`);
  const pp = personalPoints(c, [], { forAi: true });
  if (pp.length) lines.push(`Agent-recorded personal notes: ${pp.join('; ')}`);
  if (c.aiFacts && typeof c.aiFacts === 'object') {
    if (Array.isArray(c.aiFacts.mustHaves) && c.aiFacts.mustHaves.length) lines.push(`Known must-haves: ${c.aiFacts.mustHaves.join('; ')}`);
    if (c.aiFacts.style) lines.push(`Communication style: ${c.aiFacts.style}`);
  }
  if (c.aiSummary) lines.push(`Previous summary: ${String(c.aiSummary).slice(0, 600)}`);
  if (b.properties.length) {
    lines.push('PORTFOLIO:');
    for (const p of b.properties.slice(0, 8)) {
      const bits = [p.relationship, p.title, p.neighborhood || p.city, p.estValue ? `est ${moneyShort(p.estValue)}` : null,
        p.derived.daysToReset != null ? `ARM reset in ${p.derived.daysToReset}d` : null, p.derived.daysToLeaseEnd != null ? `lease ends in ${p.derived.daysToLeaseEnd}d` : null,
        p.thinkingOfSelling ? 'thinking of selling' : null].filter(Boolean);
      lines.push(`- ${bits.join(' · ')}`);
    }
  }
  if (b.searches.length) {
    lines.push('SEARCHES:');
    for (const s of b.searches.slice(0, 4)) lines.push(`- [${s.bucket}] ${s.title}${s.priceMax ? ` ≤ ${moneyShort(s.priceMax)}` : ''}${s.bedsMin ? ` · ${s.bedsMin}+ bd` : ''}`);
  }
  if (b.deals.length) {
    lines.push('DEALS:');
    for (const d of b.deals) lines.push(`- ${d.side} · ${STAGE_LABEL[d.stage] || d.stage} · ${d.propertyLabel || d.propertyAddress || d.title || ''}${d.price ? ` · ${moneyShort(d.price)}` : ''}`);
  }
  if (b.nextAppt) lines.push(`NEXT APPOINTMENT: ${b.nextAppt.title} (${b.nextAppt.type}) on ${new Date(b.nextAppt.startAt).toISOString().slice(0, 10)}`);
  if (b.tasks.length) lines.push(`OPEN TASKS: ${b.tasks.map((t) => t.title).join('; ')}`);
  if (b.notes.length) {
    lines.push('NOTES (newest first):');
    for (const n of b.notes) lines.push(`- ${new Date(n.createdAt).toISOString().slice(0, 10)}: ${n.body.slice(0, 400)}`);
  }
  if (b.calls.length) {
    lines.push('RECENT CALLS:');
    for (const k of b.calls) lines.push(`- ${new Date(k.startedAt).toISOString().slice(0, 10)} ${k.direction} ${k.status}${k.summary ? `: ${k.summary.slice(0, 300)}` : ''}`);
  }
  if (b.messages.length) {
    lines.push('RECENT MESSAGES (oldest → newest):');
    for (const m of b.messages.slice(-30)) lines.push(`- ${new Date(m.sentAt).toISOString().slice(0, 16).replace('T', ' ')} ${m.isFromMe ? 'AGENT' : 'CLIENT'}: ${(m.body || '[attachment]').slice(0, 280)}`);
  }
  lines.push(`Last touch: ${b.lastTouch ? b.lastTouch.toISOString().slice(0, 10) : 'never'}. Today: ${new Date().toISOString().slice(0, 10)}.`);
  return lines.join('\n');
}

// ── Briefing ─────────────────────────────────────────────────────────────
const BRIEFING_SYSTEM = `You write relationship briefings for a luxury real-estate agent's personal CRM (KeyMatch). The agent glances at this on the client card right before calling or texting. Be specific, warm and commercially sharp; no filler, no clichés, no emoji.

Return JSON with:
- statusLine: one line (≤ 110 chars) — who they are right now and where things stand (e.g. "Active buyer · touring bay-front in Coral Gables · last touch 3d ago").
- recommendedMove: ONE concrete next action, one sentence, first name.
- iceBreakers: up to 3 short, natural openers grounded ONLY in facts present in the context.
- personalTouchPoints: up to 6 short "Label: fact" items repeated from agent-recorded facts only.
- portfolioContext: one line about what they own / rent / want (or null).
- dealContext: one line about open deals (or null).
- toneNotes: one line on how they like to communicate (or null if unknown).
- lastContactSummary: one line on the last interaction.
Never invent facts, prices, dates or names.

${FAIR_HOUSING}`;

const BRIEFING_SCHEMA = {
  type: 'object',
  properties: {
    statusLine: { type: 'string' },
    recommendedMove: { type: 'string' },
    iceBreakers: { type: 'array', items: { type: 'string' } },
    personalTouchPoints: { type: 'array', items: { type: 'string' } },
    portfolioContext: { type: ['string', 'null'] },
    dealContext: { type: ['string', 'null'] },
    toneNotes: { type: ['string', 'null'] },
    lastContactSummary: { type: 'string' },
  },
};

const inflight = new Map();

async function generateAiBriefing(workspaceId, clientId, b) {
  const key = `${workspaceId}:${clientId}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const out = await ai.json({ system: BRIEFING_SYSTEM, prompt: `${contextText(b)}\n\nWrite the briefing JSON.`, schema: BRIEFING_SCHEMA, effort: 'low', maxTokens: 4000, feature: 'client_briefing', workspaceId });
    if (!out || !out.statusLine) return null;
    const fb = fallbackBriefing(b);
    const briefing = {
      statusLine: String(out.statusLine).slice(0, 160),
      recommendedMove: String(out.recommendedMove || fb.recommendedMove).slice(0, 300),
      iceBreakers: (out.iceBreakers || []).filter(Boolean).slice(0, 3),
      personalTouchPoints: (out.personalTouchPoints || []).filter(Boolean).slice(0, 6),
      portfolioContext: out.portfolioContext || fb.portfolioContext,
      dealContext: out.dealContext || fb.dealContext,
      toneNotes: out.toneNotes || null,
      lastContactSummary: out.lastContactSummary || fb.lastContactSummary,
      generatedAt: new Date().toISOString(),
      source: 'ai',
    };
    await prisma.aiInsight.create({ data: { workspaceId, clientId, type: 'briefing', title: briefing.statusLine, body: briefing.recommendedMove, data: briefing, status: 'new' } });
    // Keep only the latest few briefings per client.
    const old = await prisma.aiInsight.findMany({ where: { workspaceId, clientId, type: 'briefing' }, orderBy: { createdAt: 'desc' }, skip: 3, select: { id: true } });
    if (old.length) await prisma.aiInsight.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    return briefing;
  })().catch((err) => {
    if (err && err.code !== 'ai_unavailable') console.error('[clients] briefing failed:', err.message);
    return null;
  }).finally(() => { setTimeout(() => inflight.delete(key), 0); });
  inflight.set(key, p);
  return p;
}

async function getBriefing({ workspaceId, clientId, refresh = false }) {
  const b = await bundleFor(workspaceId, clientId);
  const cached = await prisma.aiInsight.findFirst({ where: { workspaceId, clientId, type: 'briefing' }, orderBy: { createdAt: 'desc' } });
  let latestActivity = null;
  if (cached) {
    const la = await prisma.activity.findFirst({ where: { workspaceId, clientId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
    latestActivity = la ? la.occurredAt : null;
  }
  const fresh = cached && (Date.now() - cached.createdAt.getTime() < 12 * 3600e3)
    && (!latestActivity || latestActivity <= cached.createdAt)
    && (!b.lastTouch || b.lastTouch <= cached.createdAt);
  if (cached && fresh && !refresh) return { ...cached.data, cached: true };

  if (ai.available()) {
    if (refresh) {
      const out = await Promise.race([generateAiBriefing(workspaceId, clientId, b), new Promise((r) => setTimeout(() => r(null), 45000))]);
      if (out) return out;
    } else {
      generateAiBriefing(workspaceId, clientId, b);
      const base = cached ? { ...cached.data, stale: true } : fallbackBriefing(b);
      return { ...base, pending: true };
    }
  }
  return fallbackBriefing(b);
}

// ── Contact summary (markdown) ───────────────────────────────────────────
const SUMMARY_SYSTEM = `You are summarizing ONE client for a luxury real-estate agent's daily plan. Be specific, actionable and tight.

Write markdown with exactly these sections, in order:
**Status:** one sentence (may quote the client).
**Recent activity:** 2–5 bullets with relative timestamps ("2d ago").
**Portfolio:** owns / searching / sold — one line each, at most 3 lines.
**Open threads:** promises and unanswered questions as noun-led bullets (or "None").
**Signals:** urgency, hesitation, objections, sentiment.
**Recommended move:** ONE sentence, or "Wait — ball is in their court until X."

Rules: ≤ 220 words, use the first name, no filler, lead the Status with "Silent for N days…" when they have been silent 14+ days, never invent facts.

${FAIR_HOUSING}`;

function fallbackSummary(b) {
  const c = b.client;
  const name = first(c);
  const silent = daysAgo(b.lastTouch);
  const lines = [];
  lines.push(`**Status:** ${silent != null && silent >= 14 ? `Silent for ${silent} days. ` : ''}${statusLine(b)}.`);
  const recent = [];
  for (const m of b.messages.slice(-3)) recent.push(`- ${agoLabel(m.sentAt)}: ${m.isFromMe ? 'You' : name} — “${(m.body || '').slice(0, 90)}”`);
  for (const k of b.calls.slice(0, 2)) recent.push(`- ${agoLabel(k.startedAt)}: ${k.direction === 'inbound' ? `${name} called` : `You called ${name}`}${k.summary ? ` — ${k.summary.slice(0, 90)}` : ''}`);
  lines.push('**Recent activity:**');
  lines.push(recent.length ? recent.slice(0, 5).join('\n') : '- Nothing logged in the last few days.');
  lines.push(`**Portfolio:** ${portfolioLine(b) || 'Nothing captured yet.'}`);
  const threads = b.tasks.map((t) => `- ${t.title}`);
  lines.push('**Open threads:**');
  lines.push(threads.length ? threads.join('\n') : '- None');
  const signals = [];
  if (c.timeline) signals.push(`timeline ${c.timeline}`);
  if (c.financing) signals.push(`financing ${c.financing.replace(/_/g, ' ')}`);
  if (b.properties.some((p) => p.thinkingOfSelling)) signals.push('thinking of selling');
  lines.push(`**Signals:** ${signals.length ? signals.join(' · ') : 'No strong signals yet.'}`);
  lines.push(`**Recommended move:** ${recommendedMove(b)}`);
  return lines.join('\n');
}

async function generateSummary({ workspaceId, clientId }) {
  const b = await bundleFor(workspaceId, clientId);
  let summary = null;
  let source = 'fallback';
  if (ai.available()) {
    try {
      summary = await ai.text({ system: SUMMARY_SYSTEM, prompt: `${contextText(b)}\n\nWrite the summary.`, effort: 'low', maxTokens: 3000, feature: 'contact_summary', workspaceId });
      if (summary) source = 'ai';
    } catch (err) {
      if (err && err.code !== 'ai_unavailable') console.error('[clients] summary failed:', err.message);
    }
  }
  if (!summary) summary = fallbackSummary(b);
  const at = new Date();
  if (source === 'ai' || !b.client.aiSummary) {
    await prisma.client.update({ where: { id: clientId }, data: { aiSummary: summary, aiSummaryAt: at } });
  }
  return { summary, aiSummaryAt: at, source };
}

module.exports = { getBriefing, generateSummary, fallbackBriefing, bundleFor, FAIR_HOUSING };

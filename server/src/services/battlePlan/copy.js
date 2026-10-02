// Plan copy: the ONLY place an LLM touches plan generation. The placer has
// already decided WHAT happens and WHEN; the model writes the human words
// (title / sub / why / tone + a one-line summary and a short narrative).
// Every field has a deterministic fallback so the plan renders fully with no
// AI key, and model output is schema-checked, length-trimmed and scrubbed of
// platitudes before it reaches the agent.
const { z } = require('zod');
const ai = require('../../ai/claude');
const prisma = require('../../lib/prisma');

// Reason chip per src (the "where it came from" tag).
const REASONS = {
  reply: { label: 'THEY ASKED', sentence: 'They asked you something' },
  match: { label: 'NEW MATCH', sentence: 'A new listing fits their search' },
  offmarket: { label: 'OFF-MARKET', sentence: "Another client's home fits what they want" },
  lease: { label: 'LEASE ENDING', sentence: 'Their lease is ending — buy vs. renew' },
  equity: { label: 'EQUITY WINDOW', sentence: 'Their loan is resetting or maturing' },
  anniversary: { label: 'HOME ANNIVERSARY', sentence: 'Home-purchase anniversary — annual value check' },
  birthday: { label: 'BIRTHDAY', sentence: 'Birthday on file' },
  search: { label: 'STILL SEARCHING', sentence: 'Still searching — nothing has clicked yet' },
  pipeline: { label: 'GONE QUIET', sentence: 'Their deal has gone quiet' },
  showing: { label: 'SHOWING FEEDBACK', sentence: 'Showing ended — no feedback logged yet' },
  silence: { label: 'CHECK-IN', sentence: 'No contact in a while' },
  content: { label: 'CONTENT', sentence: 'Daily listing media / social block' },
  lunch: { label: 'LUNCH', sentence: 'Protected lunch' },
  internal: { label: 'FOLLOW-UP', sentence: 'Suggested follow-up' },
};

const SRC_FOR_KIND = {
  'respond.text': 'reply',
  'listing.match.call': 'match',
  'listing.match.send': 'match',
  'offmarket.match.call': 'offmarket',
  'lease.expiry.call': 'lease',
  'equity.milestone.call': 'equity',
  'anniversary.text': 'anniversary',
  'birthday.text': 'birthday',
  'search.nudge': 'search',
  'deal.unstick': 'pipeline',
  'showing.feedback': 'showing',
  'soi.checkin.text': 'silence',
  'content.block': 'content',
  'personal.lunch': 'lunch',
};

const BLACKLIST = [
  /great\s+opportunity/i, /high[\s-]?value\s+client/i, /important\s+next\s+step/i, /hot\s+lead!/i,
  /strong\s+fit\s+for\s+our\s+(inventory|listings)/i, /worth\s+reaching\s+out\s+today/i,
  /be\s+sure\s+to\s+follow\s+up/i, /circle\s+back/i, /touch\s+base/i,
];

function scrub(text, fallback) {
  if (!text) return fallback;
  return BLACKLIST.some((re) => re.test(text)) ? fallback : text;
}

const money = (n) => {
  if (!n) return null;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
};
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// Deterministic copy per kind. `c.ctx` carries the signal facts.
function fallbackCopy(c) {
  const x = c.ctx || {};
  const first = x.first || 'them';
  const sig = (c.signal && c.signal.summary) || '';
  switch (c.kind) {
    case 'content.block':
      return { title: 'Content block', sub: `${c.durationMin}-min listing media & social`, why: 'Slotted into the day\'s biggest open window — film the reel, post the market update, publish the listing story.', tone: 'neutral', action: 'Start', actionIcon: 'camera' };
    case 'personal.lunch':
      return { title: 'Lunch', sub: `${c.durationMin}-min protected block`, why: 'Standing rule: a real lunch unless a client appointment covers it — then it slides after.', tone: 'cool', action: null, actionIcon: null };
    case 'respond.text':
      return { title: clip(`Reply to ${first}`, 50), sub: x.preview ? clip(`“${x.preview}”`, 80) : 'Unanswered question', why: clip(`${x.name || first} asked${x.agoLabel ? ` ${x.agoLabel}` : ''}: “${clip(x.preview, 110)}” — still waiting on you.`, 220), tone: 'urgent', action: 'Open chat', actionIcon: 'message' };
    case 'listing.match.call':
      return { title: clip(`Call ${first} — ${x.matchScore}% match`, 50), sub: clip([x.listingLabel, money(x.listingPrice)].filter(Boolean).join(' · '), 80), why: clip(`${x.listingLabel || 'A new listing'} scores ${x.matchScore} against ${x.searchName || 'their search'}${x.matchReason ? ` — ${x.matchReason}` : ''}. Strong enough for a call, not a text.`, 220), tone: 'urgent', action: 'Call', actionIcon: 'phone' };
    case 'listing.match.send':
      return { title: clip(`Send ${first} ${x.listingShort || 'a new match'}`, 50), sub: clip([x.listingLabel, money(x.listingPrice), x.matchScore ? `${x.matchScore}% match` : null].filter(Boolean).join(' · '), 80), why: clip(`${x.listingLabel || 'A new listing'} scores ${x.matchScore} against ${x.searchName || 'their search'}. Send it with one line on why it fits.`, 220), tone: 'warm', action: 'Send', actionIcon: 'send' };
    case 'offmarket.match.call':
      return { title: clip(`Call ${first} — off-market fit`, 50), sub: clip(x.listingLabel ? `${x.listingLabel}${x.ownerFirst ? ` · ${x.ownerFirst}'s home` : ''}` : 'Client-owned home', 80), why: clip(`${x.ownerFirst ? `${x.ownerFirst}'s home` : 'A client-owned home'} scores ${x.matchScore} against ${first}'s search — a private pairing no portal has.`, 220), tone: 'urgent', action: 'Call', actionIcon: 'phone' };
    case 'lease.expiry.call':
      return { title: clip(`Call ${first} — lease ends ${x.dateLabel}`, 50), sub: clip(`${x.address || 'Their rental'} · ${x.daysUntil} days left`, 80), why: clip(`Their lease ${x.address ? `at ${x.address} ` : ''}ends in ${x.daysUntil} days. Open the buy-vs-renew conversation before they sign another year.`, 220), tone: 'urgent', action: 'Call', actionIcon: 'phone' };
    case 'equity.milestone.call':
      return { title: clip(`Call ${first} — ${x.milestone || 'loan milestone'}`, 50), sub: clip(`${x.address || 'Their home'} · ${x.daysUntil} days`, 80), why: clip(`${x.milestoneSentence || 'Their loan hits a milestone'} in ${x.daysUntil} days${x.address ? ` on ${x.address}` : ''}. Natural moment for an equity review and a move-up conversation.`, 220), tone: 'urgent', action: 'Call', actionIcon: 'phone' };
    case 'anniversary.text':
      return { title: clip(`Text ${first} — ${x.years}-year home anniversary`, 50), sub: clip(`${x.address || 'Their home'} · ${x.dateLabel}`, 80), why: clip(`${x.years} year${x.years === 1 ? '' : 's'} since they bought ${x.address || 'their home'}. Send a warm note and offer an updated value read.`, 220), tone: 'warm', action: 'Send', actionIcon: 'send' };
    case 'birthday.text':
      return { title: clip(x.daysUntil === 0 ? `Wish ${first} happy birthday` : `${first}'s birthday ${x.dateLabel}`, 50), sub: x.daysUntil === 0 ? 'Birthday today' : `Birthday in ${x.daysUntil} day${x.daysUntil === 1 ? '' : 's'}`, why: clip(x.daysUntil === 0 ? `It's ${first}'s birthday today. A personal text beats any card.` : `${first}'s birthday is ${x.dateLabel}. Queue a personal note so it lands on the day.`, 220), tone: 'warm', action: 'Send', actionIcon: 'send' };
    case 'search.nudge':
      return { title: clip(`Re-engage ${first} on their search`, 50), sub: clip([x.searchName, x.searchDays ? `${x.searchDays} days searching` : null].filter(Boolean).join(' · '), 80), why: clip(`${x.searchName || 'Their search'} has run ${x.searchDays} days with no new match or showing. Re-qualify the criteria or send a curated short list.`, 220), tone: 'warm', action: 'Send', actionIcon: 'send' };
    case 'deal.unstick':
      return { title: clip(`Unstick ${first}'s deal`, 50), sub: clip([x.stageLabel, x.property, x.stageDays ? `${x.stageDays}d in stage` : null].filter(Boolean).join(' · '), 80), why: clip(`${x.stageLabel || 'Deal'}${x.property ? ` on ${x.property}` : ''} hasn't moved in ${x.stageDays} days and ${first} has been quiet ${x.silenceDays ?? x.stageDays} days. A call resets the clock.`, 220), tone: 'urgent', action: 'Call', actionIcon: 'phone' };
    case 'showing.feedback':
      return { title: clip(`Get ${first}'s take on ${x.address || 'the showing'}`, 50), sub: clip(`${x.typeLabel || 'Showing'} ${x.whenLabel || ''}`.trim(), 80), why: clip(`${x.typeLabel || 'Showing'} at ${x.address || 'the property'} wrapped ${x.whenLabel || 'recently'} with no feedback logged. Capture it while it's fresh.`, 220), tone: 'warm', action: 'Call', actionIcon: 'phone' };
    case 'soi.checkin.text':
      return { title: clip(`Check in with ${first}`, 50), sub: x.silenceDays ? `${x.silenceDays} days since you last spoke` : 'Sphere check-in', why: clip(`${x.name || first} is ${x.statusLabel || 'in your sphere'} and it's been ${x.silenceDays} days. A no-ask check-in keeps you their agent.`, 220), tone: 'neutral', action: 'Send', actionIcon: 'send' };
    default:
      return { title: clip(`Follow up with ${first}`, 50), sub: clip(sig, 80), why: clip(sig || 'Queued follow-up.', 220), tone: 'neutral', action: 'Open chat', actionIcon: 'message' };
  }
}

function fallbackSummary(moves, { offDay } = {}) {
  const tasks = moves.filter((m) => !m.mandatory);
  if (offDay) return { summary: 'Day off — outreach is paused.', narrative: 'You\'re off today, so the planner is holding every outreach suggestion. Your content block stays in case you come in.' };
  if (!tasks.length) return { summary: 'Clear runway today.', narrative: 'No signals need you today. Use the open time for content, your sphere, or tomorrow\'s showings.' };
  const top = tasks.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const calls = tasks.filter((m) => m.channel === 'call').length;
  const texts = tasks.length - calls;
  const parts = [];
  if (calls) parts.push(`${calls} call${calls === 1 ? '' : 's'}`);
  if (texts) parts.push(`${texts} text${texts === 1 ? '' : 's'}`);
  return {
    summary: clip(`${parts.join(' and ')} queued — start with ${(top.meta && top.meta.ctx && top.meta.ctx.first) || (top.ctx && top.ctx.first) || 'the top one'}.`, 90),
    narrative: clip(`Start with **${top.title}**. ${top.why || 'It scores highest today.'} ${tasks.length > 1 ? `Then work down the list — ${tasks.length - 1} more ${tasks.length - 1 === 1 ? 'is' : 'are'} ranked behind it.` : ''}`.trim(), 280),
  };
}

// ── LLM copy pass ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You write the human-facing copy for a luxury real estate agent's daily Battle Plan inside a personal CRM.

The plan has ALREADY been built and scheduled by a deterministic planner — every move has a fixed time, channel and duration. Your ONLY job is to write words: a one-line summary, a short hero narrative, and per-move title / sub / why / tone. You MUST NOT change times, invent moves, merge moves, or drop moves. Echo back every move id you are given exactly once, and write items ONLY for those ids.

Rules for each item:
- title: at most 50 characters, action-first and specific ("Call Elena — Palm Beach match", "Reply to Marcus about the inspection").
- sub: at most 80 characters, the stakes or the key fact (address, price, days left). May be empty.
- why: at most 220 characters. Cite at least one REAL signal from the data you were given (their exact question, the match score and listing, the lease end date, days in stage, the showing address). For content/lunch blocks, describe the placement logic.
- tone: one of urgent | warm | cool | neutral.
Never use these phrases: "great opportunity", "high-value client", "important next step", "hot lead!", "strong fit for our listings", "worth reaching out today", "touch base", "circle back", "be sure to follow up".
Fair Housing: never mention or infer race, color, religion, national origin, sex, familial status, disability or any other protected characteristic, and never describe neighborhoods by who lives there — only property attributes and explicitly named places.

The user message may include a REP FEEDBACK block — the agent's verdicts on past suggestions ([GOOD] = endorsed, [BAD] = rejected and why). Treat it as standing coaching: match the tone and emphasis they endorse, avoid patterns they rejected, and never re-pitch an idea they called already handled. It changes HOW you write, never WHAT is scheduled.

summary: at most 90 characters. narrative: at most 280 characters, conversational, may bold 1–3 phrases with **double asterisks**, names the #1 move first, acknowledges the content block.`;

const OUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    narrative: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          sub: { type: 'string' },
          why: { type: 'string' },
          tone: { type: 'string', enum: ['urgent', 'warm', 'cool', 'neutral'] },
        },
      },
    },
  },
};

const ItemZ = z.object({
  id: z.string(),
  title: z.string().optional(),
  sub: z.string().optional(),
  why: z.string().optional(),
  tone: z.enum(['urgent', 'warm', 'cool', 'neutral']).optional(),
}).passthrough();
const OutZ = z.object({ summary: z.string().optional(), narrative: z.string().optional(), items: z.array(z.unknown()).optional() });

async function loadRepFeedback(workspaceId) {
  try {
    const since = new Date(Date.now() - 45 * 86400e3);
    const rows = await prisma.aiFeedback.findMany({
      where: { workspaceId, kind: { in: ['move', 'todo_suggestion'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => `- [${r.isCorrect ? 'GOOD' : 'BAD'}] ${clip(r.feedback || '', 220)}`);
  } catch { return []; }
}

// moves: [{ id, kind, channel, startMin, durationMin, contactId, ctx, signal, impactDollars, matchScore, fallback }]
async function writeCopyWithAI({ workspaceId, date, tz, moves, advisories = [] }) {
  if (!ai.available() || !moves.length) return null;
  const feedback = await loadRepFeedback(workspaceId);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const payload = {
    date,
    timeZone: tz,
    plannedMoves: moves.map((m) => ({
      id: m.id,
      kind: m.kind,
      channel: m.channel,
      at: m.startMin != null ? fmt(m.startMin) : null,
      durationMin: m.durationMin,
      contact: m.ctx && m.ctx.name ? m.ctx.name : null,
      signal: m.signal ? m.signal.summary : null,
      facts: m.ctx || {},
      matchScore: m.matchScore || undefined,
      expectedGciDollars: m.impactDollars || undefined,
      draftTitle: m.fallback.title,
    })),
  };
  let prompt = `Here is the plan — already scheduled. Write the copy.\n\n${JSON.stringify(payload)}`;
  if (advisories.length) prompt += `\n\nAGENT'S STANDING NOTES (context only):\n${advisories.map((a) => `- ${clip(a, 200)}`).join('\n')}`;
  if (feedback.length) prompt += `\n\nREP FEEDBACK ON PAST AI SUGGESTIONS ([BAD] = rejected and why, [GOOD] = endorsed):\n${feedback.join('\n')}`;

  let raw;
  try {
    raw = await ai.json({ system: SYSTEM_PROMPT, prompt, schema: OUT_SCHEMA, effort: 'low', maxTokens: 6000, feature: 'battle_plan_copy', workspaceId });
  } catch (err) {
    if (err.code !== 'ai_unavailable') console.warn('[battlePlan] copy pass failed:', err.message);
    return null;
  }
  const top = OutZ.safeParse(raw);
  if (!top.success) return null;
  const ids = new Set(moves.map((m) => m.id));
  const byId = new Map();
  for (const it of top.data.items || []) {
    const r = ItemZ.safeParse(it);
    if (!r.success || !ids.has(r.data.id) || byId.has(r.data.id)) continue;
    const fb = moves.find((m) => m.id === r.data.id).fallback;
    byId.set(r.data.id, {
      title: clip(scrub(r.data.title, fb.title) || fb.title, 50),
      sub: r.data.sub != null ? clip(scrub(r.data.sub, fb.sub), 80) : fb.sub,
      why: clip(scrub(r.data.why, fb.why) || fb.why, 220),
      tone: r.data.tone || fb.tone,
    });
  }
  return {
    summary: top.data.summary ? clip(scrub(top.data.summary, ''), 90) || null : null,
    narrative: top.data.narrative ? clip(scrub(top.data.narrative, ''), 280) || null : null,
    items: byId,
  };
}

module.exports = { fallbackCopy, fallbackSummary, writeCopyWithAI, scrub, REASONS, SRC_FOR_KIND, BLACKLIST, clip, money };

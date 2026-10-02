// Offline Serena — a deterministic intent router that keeps her genuinely
// useful with no AI key (or when the API is down). It understands the core
// operator commands, runs the SAME tools as the AI path (so receipts, undo
// and approval cards are identical) and writes grounded replies from tool
// results only — it never invents anything.
const prisma = require('../../lib/prisma');
const { dayKey } = require('../../lib/dates');
const U = require('./util');
const T = require('./time');
const { cleanCopy } = require('./tools/propose');

const SUGGEST = {
  day: 'What’s my day?',
  call: 'Who should I call first?',
  pipeline: 'Show my pipeline',
  unread: 'Who’s waiting on a reply?',
  matches: 'Any hot matches?',
  gci: 'How’s my GCI this month?',
  signals: 'Birthdays and anniversaries coming up',
};

// ── text helpers ───────────────────────────────────────────────────────────
const lc = (s) => String(s || '').toLowerCase();
const COMMON_WORDS = new Set(['will', 'mark', 'bill', 'grant', 'may', 'june', 'rose', 'summer', 'chase', 'hunter', 'faith', 'hope', 'joy', 'lane', 'dawn', 'jack', 'art', 'rich', 'sunny', 'park', 'brown', 'green', 'white', 'king', 'young', 'hall', 'wood', 'day', 'new', 'call', 'text', 'note', 'drew', 'sky', 'reed', 'case', 'love', 'price', 'west', 'north', 'south', 'cash', 'gates', 'banks', 'rivers', 'hill', 'stone', 'bay', 'sun', 'star', 'island', 'beach', 'monday', 'friday']);

function wordsOf(text) {
  return lc(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}

// Who does the message mention? Scores every client name against the text.
async function mentionedClients(workspaceId, text, ctx) {
  const raw = String(text || '');
  const ws = wordsOf(raw);
  const set = new Set(ws);
  const joined = ` ${ws.join(' ')} `;
  const clients = await prisma.client.findMany({ where: { workspaceId, archivedAt: null }, select: { ...U.CLIENT_LITE, _count: { select: { deals: true } } } });
  const hits = [];
  for (const c of clients) {
    const fn = U.norm(c.firstName);
    const ln = U.norm(c.lastName);
    const dn = U.norm(c.displayName);
    let score = 0;
    let via = null;
    if (fn && ln && joined.includes(` ${fn} ${ln} `)) { score = 6; via = 'full'; }
    else if (dn && dn.length > 3 && joined.includes(` ${dn} `)) { score = 5; via = 'display'; }
    else if (ln && ln.length >= 3 && (set.has(ln) || set.has(`${ln}s`) || set.has(`${ln}es`)) && !(COMMON_WORDS.has(ln) && !new RegExp(`\\b${c.lastName}`, '').test(raw))) {
      score = 3; via = set.has(ln) ? 'last' : 'plural';
    } else if (fn && fn.length >= 3 && set.has(fn)) {
      const cap = new RegExp(`(^|[^A-Za-z])${c.firstName.replace(/[^A-Za-z]/g, '')}([^A-Za-z]|$)`).test(raw);
      if (!COMMON_WORDS.has(fn) || cap) { score = 2; via = 'first'; }
    }
    if (score) hits.push({ client: c, score, via });
  }
  hits.sort((a, b) => b.score - a.score || Number(b.client.isWhale) - Number(a.client.isWhale) || b.client.rating - a.client.rating || b.client._count.deals - a.client._count.deals);
  if (ctx && ctx.names) for (const h of hits) ctx.names.set(h.client.id, U.nameOf(h.client));
  return hits;
}

// Pick one client from mentions. Same household (shared last name, plural
// "the Delacroixs") → the primary contact. Otherwise ambiguity → ask.
function pickClient(hits) {
  if (!hits.length) return { client: null };
  const top = hits[0].score;
  const best = hits.filter((h) => h.score === top);
  if (best.length === 1) return { client: best[0].client };
  const lnSet = new Set(best.map((h) => U.norm(h.client.lastName)));
  if (lnSet.size === 1 && (best.some((h) => h.via === 'plural') || top >= 3)) return { client: best[0].client, household: best.map((h) => h.client) };
  return { client: null, ambiguous: best.map((h) => h.client).slice(0, 4) };
}

async function focusClient(turn, context) {
  if (!context || !context.clientId) return null;
  return U.getClientLite(turn.ctx.workspaceId, context.clientId);
}

// "Tomorrow · 2:00 PM" → "tomorrow at 2:00 PM" for use mid-sentence.
function lowerDay(when) {
  return String(when || '').replace(' · ', ' at ').replace(/^(Today|Tomorrow|Yesterday)\b/, (m) => m.toLowerCase());
}

function stripLeading(text, rx) {
  return String(text || '').replace(rx, '').trim();
}

function oxford(list) {
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} or ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, or ${list[list.length - 1]}`;
}

async function askWhich(turn, candidates, what = 'Which one') {
  const names = candidates.map((c) => `**${U.nameOf(c)}**`);
  turn.say(`${what} — ${oxford(names)}?`);
  turn.entities.push(...candidates.map((c) => ({ type: 'client', id: c.id, name: U.nameOf(c), sub: [U.titleCase(c.type), c.neighborhood || c.city].filter(Boolean).join(' · '), phone: c.phone })));
}

// ── listings in text ───────────────────────────────────────────────────────
async function mentionedListing(workspaceId, text) {
  const m = /\b(\d{1,6})\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})/.exec(text);
  const candidates = [];
  if (m) {
    const num = m[1];
    const firstWord = m[2].split(/\s+/)[0].replace(/[^A-Za-z]/g, '');
    const rows = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null, street: { contains: `${num} ${firstWord}`, mode: 'insensitive' } }, take: 3 });
    candidates.push(...rows);
    if (!rows.length) {
      const rows2 = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null, street: { startsWith: num } }, take: 5 });
      candidates.push(...rows2.filter((r) => lc(r.street).includes(lc(firstWord).slice(0, 4))));
    }
  }
  if (!candidates.length) {
    // building / development names ("the Faena penthouse")
    const words = wordsOf(text).filter((w) => w.length > 3);
    if (words.length) {
      const rows = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null, OR: words.slice(0, 8).flatMap((w) => [{ buildingName: { contains: w, mode: 'insensitive' } }, { developmentName: { contains: w, mode: 'insensitive' } }]) }, take: 3 });
      candidates.push(...rows);
    }
  }
  return candidates[0] || null;
}

function listingFacts(l) {
  const baths = l.bathsTotal || (l.bathsFull != null ? l.bathsFull + (l.bathsHalf ? 0.5 * l.bathsHalf : 0) : null);
  const spec = [l.beds ? `${l.beds} bed` : null, baths ? `${String(baths).replace(/\.0$/, '')} bath` : null, l.livingAreaSqft ? `${Number(l.livingAreaSqft).toLocaleString('en-US')} sq ft` : null].filter(Boolean).join(', ');
  const feature = l.dockLengthFt ? `${l.dockLengthFt} ft of dockage` : l.waterfront ? `${lc(l.waterfront).replace(/_/g, ' ')} frontage` : (l.views && l.views[0]) ? `${lc(l.views[0])} views` : (l.amenities && l.amenities[0]) ? lc(l.amenities[0]) : null;
  return { spec, feature };
}

function justListedCopy(l, first) {
  const { spec, feature } = listingFacts(l);
  const where = [U.addressOf(l), l.neighborhood && l.neighborhood !== U.addressOf(l) ? `in ${l.neighborhood}` : null].filter(Boolean).join(' ');
  const price = l.listPrice ? `, offered at ${U.moneyCompact(l.listPrice)}` : '';
  const body = `${first ? `Hi ${first}, ` : ''}just listed: ${where}. ${spec ? `${spec}${feature ? ` with ${feature}` : ''}` : (feature ? U.titleCase(feature) : '')}${price}. Want a private look before it opens to the public?`;
  return cleanCopy(body.replace(/\.\s*,/g, ',').replace(/\s+\./g, '.').replace(/^just/, 'Just'));
}

// ── intents ────────────────────────────────────────────────────────────────
async function intentDay(turn, text) {
  const { ctx } = turn;
  const asked = T.parseDay(text, ctx.tz);
  const day = asked || dayKey(new Date(), ctx.tz);
  const isToday = day === dayKey(new Date(), ctx.tz);
  const { result: s } = await turn.call('todays_schedule', { date: day });
  const lines = [];
  const dayLabel = U.fmtDayKey(day, ctx.tz);
  const [y, m, d] = day.split('-').map(Number);
  const long = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  let unread = null;
  if (isToday) ({ result: unread } = await turn.call('unread_conversations', { limit: 3 }));
  const counts = [
    `${s.appointments.length} appointment${s.appointments.length === 1 ? '' : 's'}`,
    `${s.todos_due.length} to-do${s.todos_due.length === 1 ? '' : 's'} due`,
    unread ? `${unread.count} unread` : null,
  ].filter(Boolean).join(' · ');
  lines.push(`**${dayLabel === 'Today' || dayLabel === 'Tomorrow' ? `${dayLabel}, ${long.split(', ').slice(1).join(', ')}` : long}** — ${counts}`);
  if (s.appointments.length) {
    lines.push('', '**On the calendar**');
    for (const a of s.appointments) lines.push(`- **${a.start_local}** · ${a.title}${a.location && !a.title.includes(a.location.split(',')[0]) ? ` — ${a.location.split(',')[0]}` : ''}`);
  } else lines.push('', isToday ? 'Nothing on the calendar — a clean runway for prospecting.' : 'Nothing booked that day yet.');
  if (s.todos_due.length || (s.overdue_todos && s.overdue_todos.length)) {
    lines.push('', '**To-dos**');
    for (const t of (s.overdue_todos || []).slice(0, 3)) lines.push(`- ${t.title}${t.client ? ` (${t.client})` : ''} · _overdue_`);
    for (const t of s.todos_due.slice(0, 6)) lines.push(`- ${t.title}${t.client ? ` (${t.client})` : ''}`);
  }
  if (unread && unread.threads.length) {
    lines.push('', '**Waiting on you**');
    for (const u of unread.threads.slice(0, 3)) lines.push(`- **${u.name}** · ${u.when}: “${U.clip(u.last_message, 90)}”`);
    turn.entities.push(...unread.threads.slice(0, 3).map((u) => ({ type: 'thread', id: u.conversation_id, clientId: u.client_id, name: u.name, sub: `“${U.clip(u.last_message, 60)}”`, action: 'reply' })));
  }
  if (isToday) {
    const hot = await prisma.deal.findFirst({ where: { workspaceId: ctx.workspaceId, archivedAt: null, stage: 'under_contract' }, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ closingDate: 'asc' }] });
    if (hot) {
      const dl = [['inspection', hot.inspectionDeadline], ['appraisal', hot.appraisalDeadline], ['financing', hot.financingDeadline]].filter(([, at]) => at && new Date(at) > Date.now()).sort((a, b) => new Date(a[1]) - new Date(b[1]))[0];
      lines.push('', `**Closest to the money:** ${hot.title || hot.propertyAddress || 'a deal'}${hot.client ? ` (${U.nameOf(hot.client)})` : ''} is under contract${dl ? ` — ${dl[0]} deadline ${U.fmtDate(dl[1], ctx.tz)}` : ''}${hot.closingDate ? `, closing ${U.fmtDate(hot.closingDate, ctx.tz)}` : ''}.`);
    }
  }
  turn.say(lines.join('\n'));
  turn.suggest(SUGGEST.call, SUGGEST.pipeline, isToday ? 'What’s tomorrow look like?' : SUGGEST.day);
}

async function intentCall(turn) {
  const { result } = await turn.call('who_to_call', { limit: 4 });
  const list = result.suggestions || [];
  if (!list.length) {
    turn.say('Nobody is waiting on a call right now — no unanswered questions, missed calls or deadline deals. A good window to call a past client or two and ask for referrals.');
    turn.suggest(SUGGEST.signals, SUGGEST.matches);
    return;
  }
  const lines = [list.length > 1 ? 'Here’s who I’d call, in order:' : 'Call this one first:', ''];
  list.forEach((s, i) => lines.push(`${i + 1}. **${s.name}** — ${s.reason.replace(/[.]$/, '')}${i === 0 && s.why ? `. ${s.why}` : ''}`));
  turn.say(lines.join('\n'));
  turn.entities.push(...list.map((s) => ({ type: 'client', id: s.client_id, name: s.name, sub: s.reason, phone: s.phone, action: 'call' })));
  turn.suggest(SUGGEST.unread, SUGGEST.day);
}

async function intentUnread(turn) {
  const { result } = await turn.call('unread_conversations', { limit: 6 });
  if (!result.count) { turn.say('Inbox zero — nobody is waiting on a reply.'); turn.suggest(SUGGEST.call, SUGGEST.day); return; }
  const lines = [`**${result.count} thread${result.count === 1 ? '' : 's'} waiting on you:**`, ''];
  for (const u of result.threads) lines.push(`- **${u.name}** · ${u.when}: “${U.clip(u.last_message, 110)}”`);
  turn.say(lines.join('\n'));
  turn.entities.push(...result.threads.map((u) => ({ type: 'thread', id: u.conversation_id, clientId: u.client_id, name: u.name, sub: `“${U.clip(u.last_message, 60)}”`, action: 'reply' })));
  turn.suggest(SUGGEST.call);
}

async function intentPipeline(turn) {
  const { result: p } = await turn.call('pipeline_summary', {});
  if (!p.open_deals) { turn.say('No open deals in the pipeline yet. Want me to start one? Tell me the client and the side (buyer or listing).'); return; }
  const lines = [`**Pipeline** — ${p.open_deals} open deal${p.open_deals === 1 ? '' : 's'} · ${p.volume} volume · ${p.est_gci} est. GCI (${p.weighted_gci} weighted)`, ''];
  for (const s of p.stages) lines.push(`- **${s.label}** · ${s.count} · ${s.volume}`);
  if (p.closing_next_30_days.length) {
    lines.push('', '**Closing in the next 30 days**');
    for (const d of p.closing_next_30_days.slice(0, 4)) lines.push(`- ${d.title || d.property || 'Deal'} — ${d.client}${d.price_label ? ` · ${d.price_label}` : ''}${d.closing_date_local ? ` · ${d.closing_date_local}` : ''}`);
  }
  if (p.stale_deals.length) lines.push('', `**Gone quiet:** ${p.stale_deals.slice(0, 3).map((d) => `${d.client} (${d.stage_label}, ${d.days_in_stage}d)`).join(', ')}.`);
  turn.say(lines.join('\n'));
  turn.entities.push({ type: 'pipeline', id: 'pipeline', name: 'Open the pipeline board', sub: `${p.open_deals} open deals`, action: 'open' });
  turn.suggest(SUGGEST.gci, SUGGEST.call);
}

const sides = (n) => `${n} side${n === 1 ? '' : 's'}`;

async function intentGci(turn) {
  const { result: g } = await turn.call('commission_summary', {});
  const lines = [
    `**This month:** ${g.mtd.gci} GCI · ${sides(g.mtd.sides)} · ${g.mtd.volume} volume`,
    `**Year to date:** ${g.ytd.gci} GCI · ${sides(g.ytd.sides)} · ${g.ytd.volume} volume${g.ytd_pct_of_goal != null ? ` — ${g.ytd_pct_of_goal}% of your ${g.annual_gci_goal} goal` : ''}`,
    `**Last month:** ${g.last_month.gci} GCI · ${sides(g.last_month.sides)}`,
    `**Pipeline (weighted):** ${g.projected_weighted_gci} still to come`,
  ];
  turn.say(lines.join('\n'));
  turn.entities.push({ type: 'commissions', id: 'commissions', name: 'Open commissions', sub: 'Pay plan, cap and goals', action: 'open' });
  turn.suggest(SUGGEST.pipeline);
}

async function intentMatches(turn, text) {
  const pick = pickClient(await mentionedClients(turn.ctx.workspaceId, text, turn.ctx));
  if (pick.client) {
    const { result } = await turn.call('matches_for_client', { client_id: pick.client.id, limit: 5 });
    if (!result.count) { turn.say(`No strong matches for **${U.nameOf(pick.client)}** right now${result.note ? ` — ${lc(result.note).replace(/\.$/, '')}` : ''}.`); return; }
    const lines = [`**Best matches for ${U.nameOf(pick.client)}:**`, ''];
    for (const m of result.matches) lines.push(`- **${m.score}** · ${m.listing.address}${m.listing.neighborhood ? `, ${m.listing.neighborhood}` : ''} · ${m.listing.price_label || '—'}${m.summary ? ` — ${U.clip(m.summary, 80)}` : ''}`);
    turn.say(lines.join('\n'));
    turn.entities.push(...result.matches.slice(0, 3).map((m) => ({ type: 'listing', id: m.listing.listing_id, name: m.listing.address, sub: `${m.score} match · ${m.listing.price_label || ''}`, action: 'open' })));
    return;
  }
  const { result } = await turn.call('hottest_matches', { limit: 6 });
  if (!result.count) { turn.say('No 88+ matches right now. I’ll surface them here (and on the Matchmaker page) the moment a listing fits one of your buyers.'); return; }
  const lines = ['**Hottest matches in your book:**', ''];
  for (const m of result.matches) lines.push(`- **${m.score}** · ${m.client} ↔ ${m.listing ? `${m.listing.address}${m.listing.price_label ? ` (${m.listing.price_label})` : ''}` : 'a property'}`);
  turn.say(lines.join('\n'));
  turn.entities.push(...result.matches.slice(0, 3).map((m) => ({ type: 'client', id: m.client_id, name: m.client, sub: `${m.score} match · ${m.listing ? m.listing.address : ''}`, action: 'text' })));
}

async function intentSignals(turn, text) {
  const t = lc(text);
  const kinds = [
    /birthday/.test(t) && 'birthdays', /anniversar/.test(t) && 'anniversaries', /\barm\b|reset|matur/.test(t) && 'arm_resets',
    /lease/.test(t) && 'lease_expiries', /equity/.test(t) && 'equity', /silent|quiet|gone dark/.test(t) && 'silent',
  ].filter(Boolean);
  const { result } = await turn.call('client_signals', { kinds: kinds.length ? kinds : ['all'], within_days: 30 });
  const rows = result.signals || [];
  if (!rows.length) { turn.say('Nothing coming up in the next 30 days on that front.'); return; }
  const lines = ['**Coming up:**', ''];
  for (const s of rows.slice(0, 8)) lines.push(`- **${s.client}** — ${s.detail}${s.in_days === 0 && !/today/i.test(s.detail) ? ' · _today_' : ''}`);
  turn.say(lines.join('\n'));
  turn.entities.push(...rows.slice(0, 3).map((s) => ({ type: 'client', id: s.client_id, name: s.client, sub: s.detail, action: 'text' })));
}

async function intentTask(turn, text, context) {
  const { ctx } = turn;
  const hits = await mentionedClients(ctx.workspaceId, text, ctx);
  let pick = pickClient(hits);
  if (!pick.client && !pick.ambiguous) { const f = await focusClient(turn, context); if (f && /\b(him|her|them|this client|they)\b/i.test(text)) pick = { client: f }; }
  let title = stripLeading(text, /^\s*(please\s+)?(add (a |an )?(task|to-?do|reminder)( to| for)?:?|remind me( to)?|don'?t let me forget( to)?|make sure i|i need to|i have to|i owe|to-?do:?|task:?)\s*/i);
  // Strip the when-phrase from the title ("…tomorrow at 2", "…on Friday").
  title = title.replace(/\b(by|on|at|for|before)?\s*(today|tonight|tomorrow( morning| afternoon| evening)?|this (morning|afternoon|evening|weekend)|next week|(next )?(mon|tues|wednes|thurs|fri|satur|sun)day|in \d+ (days?|weeks?)|\d{1,2}\/\d{1,2})\b.*$/i, '')
    .replace(/\s+(at|by)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s*$/i, '').replace(/[.!]+$/, '').trim();
  if (!title) { turn.say('What should the to-do say?'); return; }
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (/^owe /i.test(title)) title = `Send ${title.slice(4)}`;
  const day = T.parseDay(text, ctx.tz);
  const tm = T.parseTime(text.replace(/\b\d{1,6}\s+[A-Za-z]/g, ''));
  const input = { title, client_id: pick.client ? pick.client.id : undefined };
  if (day) input.due_date = day;
  if (tm) { input.due_time = `${String(tm.h).padStart(2, '0')}:${String(tm.m).padStart(2, '0')}`; if (!day) input.due_date = 'today'; }
  if (/\b(urgent|asap|right away)\b/i.test(text)) input.priority = 'urgent';
  const { result } = await turn.call('create_task', input);
  turn.say(`Done — it’s on your list${result.due_local ? ` for **${lowerDay(result.due_local)}**` : ''}.`);
}

const APPT_RX = [
  [/\bopen house\b/i, 'open_house'], [/\bbroker'?s?\s+open\b/i, 'broker_open'],
  [/\b(listing (appointment|appt|presentation)|pre-?listing|cma meeting)\b/i, 'listing_presentation'],
  [/\b(buyer\s+)?consult(ation)?\b/i, 'buyer_consult'], [/\bfinal walk[- ]?through\b/i, 'final_walkthrough'],
  [/\binspection\b/i, 'inspection'], [/\bappraisal\b/i, 'appraisal'], [/\bclosing\b/i, 'closing'],
  [/\b(private )?tour\b/i, 'private_tour'], [/\bshowings?\b|\bshow (them|him|her)\b/i, 'showing'],
  [/\b(video|zoom|facetime)\b/i, 'video'], [/\b(phone )?call\b/i, 'call'], [/\b(coffee|lunch|dinner|drinks|meeting|meet)\b/i, 'meeting'],
];
function apptTypeOf(text) {
  for (const [rx, t] of APPT_RX) if (rx.test(text)) return t;
  return null;
}

async function intentAppointment(turn, text, context) {
  const { ctx } = turn;
  const type = apptTypeOf(text) || 'meeting';
  const hits = await mentionedClients(ctx.workspaceId, text, ctx);
  let pick = pickClient(hits);
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous, 'With which client');
  if (!pick.client) { const f = await focusClient(turn, context); if (f) pick = { client: f }; }
  const listing = await mentionedListing(ctx.workspaceId, text);
  const day = T.parseDay(text, ctx.tz);
  const tm = T.parseTime(text.replace(/\b\d{1,6}\s+(?!am\b|pm\b)[A-Za-z]{3,}/gi, ''));
  if (!day && !tm) { turn.say(`When should I book the ${(require('./effects').APPT_LABEL[type] || 'appointment').toLowerCase()}${pick.client ? ` with **${U.nameOf(pick.client)}**` : ''}? Give me a day and time.`); return; }
  if (!pick.client && !listing && !['meeting', 'call', 'video'].includes(type)) {
    turn.say('Who is it with? Give me the client’s name and I’ll book it.');
    return;
  }
  const input = {
    type,
    date: day || 'today',
    time: tm ? `${String(tm.h).padStart(2, '0')}:${String(tm.m).padStart(2, '0')}` : '10:00',
    client_id: pick.client ? pick.client.id : undefined,
    listing_id: listing ? listing.id : undefined,
  };
  const dm = /\bfor (\d{2,3}) ?(min|minutes)\b|\b(\d(?:\.5)?) ?(hour|hours|hr|hrs)\b/i.exec(text);
  if (dm) input.duration_minutes = dm[1] ? Number(dm[1]) : Math.round(Number(dm[3]) * 60);
  if (pick.household && pick.household.length > 1 && pick.client.lastName) {
    const label = require('./effects').APPT_LABEL[type] || 'Appointment';
    input.title = `${label}${listing ? ` · ${U.addressOf(listing)}` : ''} with the ${pick.client.lastName} family`;
  }
  const { result } = await turn.call('create_appointment', input);
  turn.say(`Booked — **${result.title}**, ${lowerDay(result.when_local)}.${tm ? '' : ' I put it at 10:00 AM; tell me if you want a different time.'}`);
  if (pick.client) turn.suggest(`Draft a confirmation text to ${U.firstOf(pick.client)}`);
}

async function intentReschedule(turn, text, cancel = false) {
  const { ctx } = turn;
  const pick = pickClient(await mentionedClients(ctx.workspaceId, text, ctx));
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous, 'Whose appointment');
  const type = apptTypeOf(text);
  const where = { workspaceId: ctx.workspaceId, status: { not: 'cancelled' }, startAt: { gte: new Date(Date.now() - 3600e3) } };
  if (pick.client) where.clientId = pick.client.id;
  if (type && type !== 'meeting') where.type = type === 'showing' ? { in: ['showing', 'private_tour'] } : type;
  const appts = await prisma.appointment.findMany({ where, orderBy: { startAt: 'asc' }, take: 3 });
  if (!appts.length) { turn.say(`I couldn’t find an upcoming ${type ? type.replace(/_/g, ' ') : 'appointment'}${pick.client ? ` with **${U.nameOf(pick.client)}**` : ''}.`); return; }
  const a = appts[0];
  if (cancel) {
    await turn.call('cancel_appointment', { appointment_id: a.id });
    turn.say(`Cancelled **${a.title}** (${lowerDay(U.fmtWhen(a.startAt, ctx.tz))}). Undo is on the card if that was a mistake.`);
    if (a.clientId) turn.suggest(`Draft a text to ${pick.client ? U.firstOf(pick.client) : 'them'} to reschedule`);
    return;
  }
  const day = T.parseDay(text.replace(/\b(from|was)\b.*?\bto\b/i, ''), ctx.tz);
  const tm = T.parseTime(text.split(/\bto\b/i).pop());
  if (!day && !tm) { turn.say(`When should **${a.title}** move to?`); return; }
  const input = { appointment_id: a.id };
  if (day) input.date = day;
  if (tm) input.time = `${String(tm.h).padStart(2, '0')}:${String(tm.m).padStart(2, '0')}`;
  const { result } = await turn.call('reschedule_appointment', input);
  turn.say(`Moved **${a.title}** to ${lowerDay(result.new_when_local)}.`);
}

async function intentNote(turn, text, context) {
  const { ctx } = turn;
  const hits = await mentionedClients(ctx.workspaceId, text, ctx);
  let pick = pickClient(hits);
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous, 'Which client is the note for');
  if (!pick.client) { const f = await focusClient(turn, context); if (f) pick = { client: f }; }
  if (!pick.client) { turn.say('Which client should I put that note on?'); return; }
  let body = stripLeading(text, /^\s*(please\s+)?(add (a )?note|note|log( that)?|jot down)\s*(to|for|on|about)?\s*/i);
  const nm = [U.nameOf(pick.client), pick.client.firstName, pick.client.lastName].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of nm) body = body.replace(new RegExp(`^(the\\s+)?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['’]s)?\\s*[:,-]?\\s*`, 'i'), '');
  body = body.replace(/^(that|:)\s*/i, '').trim();
  if (!body) { turn.say(`What should the note on **${U.nameOf(pick.client)}** say?`); return; }
  body = body.charAt(0).toUpperCase() + body.slice(1);
  ctx.names.set(pick.client.id, U.nameOf(pick.client));
  await turn.call('add_note', { client_id: pick.client.id, text: body });
  turn.say(`Saved to **${U.nameOf(pick.client)}**’s timeline.`);
}

async function intentRate(turn, text, context) {
  const { ctx } = turn;
  let pick = pickClient(await mentionedClients(ctx.workspaceId, text, ctx));
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous);
  if (!pick.client) { const f = await focusClient(turn, context); if (f) pick = { client: f }; }
  if (!pick.client) { turn.say('Which client?'); return; }
  const input = { client_id: pick.client.id };
  const sm = /(\d)\s*[- ]?\s*(star|★)/i.exec(text) || /\b(one|two|three|four|five)[- ]star/i.exec(text);
  if (sm) input.rating = Number(sm[1]) || { one: 1, two: 2, three: 3, four: 4, five: 5 }[lc(sm[1])];
  if (/\bwhale\b/i.test(text)) input.is_whale = !/\b(not|no longer|un-?)\s*(a\s+)?whale\b/i.test(text);
  const st = /\b(past client|sphere|inactive|active client|lead)\b/i.exec(text);
  if (st && /\b(mark|make|set|move)\b/i.test(text) && !sm) input.status = lc(st[1]).replace('active client', 'active').replace(' ', '_');
  if (Object.keys(input).length === 1) { turn.say('What should I change on their record?'); return; }
  const { result } = await turn.call('update_client', input);
  if (result.note) { turn.say(result.note); return; }
  turn.say(`Updated **${U.nameOf(pick.client)}**.`);
}

const STAGE_WORDS = [
  [/under contract|in contract|escrow|pending/i, 'under_contract'], [/\boffer( submitted| out)?\b/i, 'offer'],
  [/\btouring|showings?\b/i, 'touring'], [/\bconsult(ation)?\b/i, 'consultation'], [/\blisted|active|on the market\b/i, 'active'],
  [/\blisting appointment|listing appt\b/i, 'listing_appt'], [/\bclosed|sold|funded\b/i, 'closed'], [/\blost|dead|fell through\b/i, 'lost'],
];
async function intentMoveDeal(turn, text) {
  const { ctx } = turn;
  const pick = pickClient(await mentionedClients(ctx.workspaceId, text, ctx));
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous, 'Whose deal');
  if (!pick.client) { turn.say('Whose deal should I move?'); return; }
  const target = (text.split(/\bto\b/i).pop() || '');
  const st = STAGE_WORDS.find(([rx]) => rx.test(target));
  if (!st) { turn.say('Which stage — consultation, touring, offer, under contract, closed or lost?'); return; }
  const deals = await prisma.deal.findMany({ where: { workspaceId: ctx.workspaceId, clientId: pick.client.id, archivedAt: null, stage: { notIn: ['closed', 'lost'] } }, orderBy: { updatedAt: 'desc' }, take: 2 });
  if (!deals.length) { turn.say(`**${U.nameOf(pick.client)}** has no open deal. Want me to start one?`); turn.suggest(`Start a buyer deal for ${U.nameOf(pick.client)}`); return; }
  const deal = deals[0];
  let stage = st[1];
  if (stage === 'offer') stage = ['listing', 'dual', 'lease_landlord'].includes(deal.side) ? 'offer_received' : 'offer_submitted';
  const confirm = /\b(confirm|it closed|we closed|officially|funded|recorded)\b/i.test(text);
  const { result } = await turn.call('move_deal_stage', { deal_id: deal.id, stage, confirm_close: confirm });
  if (result.needs_confirmation) { turn.say(`Moving **${deal.title || U.nameOf(pick.client)}** to Closed books the commission. Did it actually close? Say “confirm ${U.firstOf(pick.client)} closed” and I’ll move it.`); return; }
  if (result.note) { turn.say(result.note); return; }
  turn.say(`Moved **${deal.title || U.nameOf(pick.client)}** forward.`);
}

async function intentDraftText(turn, text, context) {
  const { ctx } = turn;
  const lower = lc(text);
  const listing = await mentionedListing(ctx.workspaceId, text);
  const streetWords = listing ? String(listing.street || '').split(' ').slice(1).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const hits = await mentionedClients(ctx.workspaceId, streetWords ? text.replace(new RegExp(streetWords, 'i'), '') : text, ctx);
  let pick = pickClient(hits);
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous, 'Who should it go to');
  if (!pick.client && /\b(him|her|them|this client)\b/i.test(text)) { const f = await focusClient(turn, context); if (f) pick = { client: f }; }

  // Just-listed: draft for the best-matched buyers (or a recipient-less draft).
  if (/just[- ]?listed|new listing|coming soon|price (drop|reduction|improve)/.test(lower) && listing) {
    let recipients = pick.client ? [pick.client] : [];
    if (!recipients.length) {
      const matches = await prisma.match.findMany({ where: { workspaceId: ctx.workspaceId, listingId: listing.id, score: { gte: 70 }, status: { not: 'dismissed' } }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { score: 'desc' }, take: 3 });
      recipients = matches.map((m) => m.client).filter((c) => c && !c.textOptOut && c.phone);
    }
    if (!recipients.length && listing.neighborhood) {
      const searches = await prisma.buyerSearch.findMany({ where: { workspaceId: ctx.workspaceId, status: 'active', OR: [{ neighborhoods: { has: listing.neighborhood } }, ...(listing.city ? [{ markets: { has: listing.city } }] : [])] }, include: { client: { select: U.CLIENT_LITE } }, take: 6 });
      recipients = searches.filter((s) => !listing.listPrice || !s.priceMax || s.priceMax >= listing.listPrice * 0.9).map((s) => s.client).filter((c) => c && !c.textOptOut && c.phone).slice(0, 3);
    }
    const isDrop = /price (drop|reduction|improve)/.test(lower);
    const copyFor = (first) => (isDrop && listing.previousPrice
      ? cleanCopy(`${first ? `Hi ${first}, ` : ''}${U.addressOf(listing)} just improved from ${U.moneyCompact(listing.previousPrice)} to ${U.moneyCompact(listing.listPrice)}. ${listingFacts(listing).spec}. Worth a second look this week?`)
      : justListedCopy(listing, first));
    if (recipients.length) {
      for (const c of recipients) {
        ctx.names.set(c.id, U.nameOf(c));
        await turn.call('draft_text', { client_id: c.id, body: copyFor(U.firstOf(c)), listing_id: listing.id, reason: pick.client ? 'Just listed' : 'Best-matched buyer' });
      }
      const who = recipients.length === 1 ? `**${U.nameOf(recipients[0])}**${pick.client ? '' : ', your best-matched buyer'}` : `your ${recipients.length} best-matched buyers`;
      turn.say(`Drafted ${recipients.length === 1 ? 'a just-listed text' : `${recipients.length} just-listed texts`} for **${U.addressOf(listing)}** to ${who}. Review, tweak and send when you’re happy — nothing goes out until you tap Send.`);
    } else {
      turn.addProposal({ kind: 'text', tool: 'draft_text', summary: `Just-listed text · ${U.addressOf(listing)}`, clientId: null, clientName: null, body: copyFor(null), listingId: listing.id, listingLabel: U.addressOf(listing), channel: 'imessage', reason: 'Pick a recipient' });
      turn.say(`Here’s a just-listed text for **${U.addressOf(listing)}**. None of your active buyers is a strong fit yet, so pick who it goes to — nothing sends until you tap Send.`);
    }
    turn.suggest(`Draft a just-listed campaign for ${U.addressOf(listing)}`);
    return;
  }

  if (!pick.client) { turn.say('Who should the text go to?'); return; }
  const c = pick.client;
  ctx.names.set(c.id, U.nameOf(c));
  // "text Elena that the inspection is Monday at 10" → content after that/saying/about.
  const m = /\b(?:that|saying|to say|letting (?:him|her|them) know|let (?:him|her|them) know)\b\s+(.+)$/i.exec(text) || /\babout\b\s+(.+)$/i.exec(text);
  let body;
  if (m && !/^(the )?(listing|home|house|property)$/i.test(m[1].trim())) {
    let content = m[1].trim().replace(/[.!]+$/, '');
    content = content.replace(/\b(he|she|they)\b/gi, 'you').replace(/\bhis\b|\bher\b|\btheir\b/gi, 'your');
    body = cleanCopy(`Hi ${U.firstOf(c)}, ${content.charAt(0).toLowerCase()}${content.slice(1)}.`);
  } else if (/confirm/i.test(text)) {
    const next = await prisma.appointment.findFirst({ where: { workspaceId: ctx.workspaceId, clientId: c.id, startAt: { gte: new Date() }, status: { not: 'cancelled' } }, orderBy: { startAt: 'asc' } });
    body = next
      ? cleanCopy(`Hi ${U.firstOf(c)}, confirming ${next.title.replace(/ with .*/, '').toLowerCase()} ${U.fmtWhen(next.startAt, ctx.tz).replace(' · ', ' at ').replace(/^Today/, 'today').replace(/^Tomorrow/, 'tomorrow')}${next.location ? ` at ${next.location.split(',')[0]}` : ''}. See you there.`)
      : cleanCopy(`Hi ${U.firstOf(c)}, just confirming our plans. Does the time still work for you?`);
  } else if (/\b(follow|check)[- ]?(up|in)\b/i.test(text)) {
    body = cleanCopy(`Hi ${U.firstOf(c)}, checking in. Any new thoughts since we last spoke? Happy to set up a few private showings this week if you’re up for it.`);
  } else if (listing) {
    body = justListedCopy(listing, U.firstOf(c));
  } else {
    body = cleanCopy(`Hi ${U.firstOf(c)}, `);
  }
  await turn.call('draft_text', { client_id: c.id, body, listing_id: listing ? listing.id : undefined, reason: 'Your request' });
  turn.say(`Here’s a draft for **${U.nameOf(c)}** — edit it if you like, then tap Send.`);
}

async function intentCampaign(turn, text) {
  const listing = await mentionedListing(turn.ctx.workspaceId, text);
  const trigger = /just[- ]?listed|new listing/i.test(text) ? 'just_listed' : /just[- ]?sold/i.test(text) ? 'just_sold' : /open house/i.test(text) ? 'open_house_invite' : /price (drop|reduction)/i.test(text) ? 'price_drop' : /market (update|report)/i.test(text) ? 'market_update' : 'none';
  const audience = listing
    ? `Active buyers whose search fits ${U.addressOf(listing)}${listing.neighborhood ? ` (${listing.neighborhood}` : ''}${listing.listPrice ? `${listing.neighborhood ? ', ' : ' ('}around ${U.moneyCompact(listing.listPrice)})` : listing.neighborhood ? ')' : ''}`
    : (/\bto (.+)$/i.exec(text) || [])[1] || 'Clients you choose in the builder';
  const brief = listing ? `${trigger === 'price_drop' ? 'Price improvement' : 'Just listed'}: ${U.addressOf(listing)}. ${listingFacts(listing).spec}${listing.listPrice ? `, ${U.moneyCompact(listing.listPrice)}` : ''}. Invite a private showing.` : stripLeading(text, /^\s*(please\s+)?(draft|create|set up|start|make)\s+(a|an)?\s*/i);
  await turn.call('draft_campaign', { name: listing ? `${trigger === 'price_drop' ? 'Price improved' : 'Just listed'} · ${U.addressOf(listing)}` : undefined, brief, audience, trigger, listing_id: listing ? listing.id : undefined });
  turn.say('Campaign draft is ready — open it in the builder to check the audience and messages. Nothing launches until you launch it there.');
}

const FINANCING = { cash_pof: 'Cash (proof of funds)', cash: 'Cash', preapproved: 'Pre-approved', prequalified: 'Pre-qualified', contingent: 'Contingent on a sale', unknown: null };
const TIMELINE = { asap: 'ASAP', '30d': '~30 days', '90d': '~90 days', '6mo': '~6 months', '12mo': '~12 months', someday: 'Someday' };

async function intentClient(turn, text, context) {
  const { ctx } = turn;
  let pick = pickClient(await mentionedClients(ctx.workspaceId, text, ctx));
  if (pick.ambiguous) return askWhich(turn, pick.ambiguous);
  if (!pick.client) { const f = await focusClient(turn, context); if (f && /\b(this client|him|her|them|they)\b/i.test(text)) pick = { client: f }; }
  if (!pick.client) {
    const q = stripLeading(text, /^\s*(tell me about|who is|who's|pull up|look up|find|open|show me|search( for)?)\s+/i).replace(/[?.!]+$/, '');
    const { result } = await turn.call('search_clients', { query: q, limit: 5 });
    if (result.count === 1) pick = { client: { id: result.clients[0].client_id } };
    else if (result.count > 1) { turn.say(`A few people match “${q}”:`); turn.entities.push(...result.clients.map((c) => ({ type: 'client', id: c.client_id, name: c.name, sub: [U.titleCase(c.type), c.neighborhood].filter(Boolean).join(' · '), phone: c.phone }))); return; }
    else { turn.say(`I don’t see “${q}” in your book. Want me to add them as a new client?`); return; }
  }
  const { result: c } = await turn.call('get_client', { client_id: pick.client.id });
  const lines = [];
  const head = [c.whale ? 'Whale' : null, c.rating ? '★'.repeat(c.rating) : null, U.titleCase(c.status), U.titleCase(c.type)].filter(Boolean).join(' · ');
  lines.push(`**${c.name}** — ${head}`);
  const contact = [c.phone, c.email, c.home_area].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  const fin = c.financing ? (FINANCING[c.financing] === undefined ? U.titleCase(c.financing) : FINANCING[c.financing]) : null;
  const money = [fin ? `Financing: ${fin}${c.pre_approval ? ` (${c.pre_approval})` : ''}` : null, c.timeline ? `Timeline: ${TIMELINE[c.timeline] || c.timeline}` : null, c.lifetime_volume ? `Lifetime volume ${c.lifetime_volume}` : null].filter(Boolean).join(' · ');
  if (money) lines.push(money);
  if (c.buyer_searches.length) {
    lines.push('', '**Looking for**');
    for (const s of c.buyer_searches.slice(0, 2)) lines.push(`- ${[[...(s.neighborhoods || []), ...(s.markets || [])].slice(0, 3).join(', '), s.beds_min ? `${s.beds_min}+ bd` : null, s.price, (s.must_haves || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'Open search'}`);
  }
  if (c.portfolio.length) {
    lines.push('', '**Portfolio**');
    for (const p of c.portfolio.slice(0, 3)) lines.push(`- ${U.titleCase(p.relationship)} · ${p.address || p.neighborhood || 'Property'}${p.neighborhood && p.address ? `, ${p.neighborhood}` : ''}${p.est_value ? ` · est ${p.est_value}` : ''}${p.loan && /arm/.test(p.loan) ? ` · ${p.loan}` : ''}`);
  }
  const open = c.deals.filter((d) => !['closed', 'lost'].includes(d.stage));
  if (open.length) {
    lines.push('', '**Deals**');
    for (const d of open.slice(0, 3)) lines.push(`- ${d.title || d.property || 'Deal'} · ${d.stage_label}${d.price_label ? ` · ${d.price_label}` : ''}${d.closing_date_local ? ` · closing ${d.closing_date_local}` : ''}`);
  }
  if (c.upcoming_appointments.length) lines.push('', `**Next:** ${c.upcoming_appointments[0].title} · ${c.upcoming_appointments[0].when_local.replace(' · ', ' at ')}`);
  const lastText = c.recent_texts[c.recent_texts.length - 1];
  lines.push('', `**Last touch:** ${c.last_contacted}${lastText ? ` — ${lastText.from === 'agent' ? 'you' : 'they'} texted “${U.clip(lastText.text, 80)}”` : ''}`);
  if (c.open_todos.length) lines.push(`**Open to-dos:** ${c.open_todos.slice(0, 3).map((t) => t.title).join('; ')}`);
  turn.say(lines.join('\n'));
  turn.entities.push({ type: 'client', id: c.client_id, name: c.name, sub: head, phone: c.phone ? c.phone : null, action: 'open' });
  turn.suggest(`Draft a check-in text to ${c.name.split(' ')[0]}`, `Remind me to call ${c.name.split(' ')[0]} tomorrow`);
}

async function intentListings(turn, text) {
  const t = lc(text);
  const input = { limit: 6 };
  const beds = /(\d+)\s*\+?\s*(bed|bd|br|bedroom)/.exec(t);
  if (beds) input.beds_min = Number(beds[1]);
  const price = /\b(under|below|less than|max|up to|<)\s*\$?\s*([\d.]+)\s*(m|mm|million|k)?\b/.exec(t);
  if (price) input.max_price = Math.round(Number(price[2]) * (/m/.test(price[3] || '') ? 1e6 : /k/.test(price[3] || '') ? 1e3 : Number(price[2]) < 100 ? 1e6 : 1));
  const over = /\b(over|above|more than|at least|min)\s*\$?\s*([\d.]+)\s*(m|mm|million|k)?\b/.exec(t);
  if (over) input.min_price = Math.round(Number(over[2]) * (/m/.test(over[3] || '') ? 1e6 : /k/.test(over[3] || '') ? 1e3 : Number(over[2]) < 100 ? 1e6 : 1));
  if (/waterfront|on the water|dock|oceanfront|bayfront/.test(t)) input.waterfront = true;
  if (/price (drop|cut|reduction|improve)/.test(t)) input.price_drops_only = true;
  if (/\bmy listings\b|\bour listings\b/.test(t)) input.own_only = true;
  const types = { condo: 'condo', penthouse: 'penthouse', estate: 'estate', townhouse: 'townhouse', villa: 'villa', land: 'land', lot: 'land' };
  for (const [w, v] of Object.entries(types)) if (new RegExp(`\\b${w}s?\\b`).test(t)) input.property_type = v;
  const inPlace = /\bin\s+([A-Z][A-Za-z.' ]+?)(?:\s+(?:under|below|over|with|for|that|priced)\b|[?.!,]|$)/.exec(text);
  if (inPlace) input.neighborhood = inPlace[1].trim();
  const { result } = await turn.call('find_listings', input);
  if (!result.count) { turn.say('No listings match that right now.'); return; }
  const lines = [`**${result.count} listing${result.count === 1 ? '' : 's'}:**`, ''];
  for (const l of result.listings) lines.push(`- **${l.address}**${l.neighborhood ? `, ${l.neighborhood}` : ''} · ${l.price_label || '—'} · ${[l.beds ? `${l.beds} bd` : null, l.baths ? `${l.baths} ba` : null, l.sqft ? `${Number(l.sqft).toLocaleString('en-US')} sf` : null].filter(Boolean).join(' / ')}${l.own_listing ? ' · _yours_' : l.origin === 'pocket' ? ' · _pocket_' : l.origin === 'whisper' ? ' · _whisper_' : ''}`);
  turn.say(lines.join('\n'));
  turn.entities.push(...result.listings.slice(0, 3).map((l) => ({ type: 'listing', id: l.listing_id, name: l.address, sub: [l.neighborhood, l.price_label].filter(Boolean).join(' · '), action: 'open' })));
}

async function intentOwners(turn, text) {
  const t = lc(text);
  const input = { limit: 6 };
  const inPlace = /\b(?:in|on)\s+([A-Z][A-Za-z.' ]+?)(?:\s+(?:worth|over|with|that)\b|[?.!,]|$)/.exec(text);
  if (inPlace) input.neighborhood = inPlace[1].trim();
  if (/waterfront|on the water|dock/.test(t)) input.waterfront = true;
  const v = /\b(worth|over|above)\s*\$?\s*([\d.]+)\s*(m|million)?/.exec(t);
  if (v) input.min_value = Math.round(Number(v[2]) * (Number(v[2]) < 100 ? 1e6 : 1));
  if (/thinking of selling|might sell|want(s)? to sell/.test(t)) input.thinking_of_selling = true;
  const { result } = await turn.call('find_owners', input);
  if (!result.count) { turn.say('Nobody in your book owns a property like that (that I have on file).'); return; }
  const lines = ['**Owners in your book:**', ''];
  for (const o of result.owners) lines.push(`- **${o.client}** — ${o.address || 'property'}${o.neighborhood ? `, ${o.neighborhood}` : ''}${o.est_value ? ` · est ${o.est_value}` : ''}${o.thinking_of_selling ? ' · _thinking of selling_' : ''}`);
  turn.say(lines.join('\n'));
  turn.entities.push(...result.owners.slice(0, 3).map((o) => ({ type: 'client', id: o.client_id, name: o.client, sub: o.address, action: 'open' })));
}

async function intentCompleteTask(turn, text) {
  const { ctx } = turn;
  const tasks = await prisma.task.findMany({ where: { workspaceId: ctx.workspaceId, status: 'pending' }, include: { client: { select: U.CLIENT_LITE } }, take: 200 });
  const q = new Set(wordsOf(text).filter((w) => w.length > 2 && !['mark', 'done', 'complete', 'completed', 'finished', 'the', 'task', 'todo', 'check', 'off', 'and', 'already', 'did'].includes(w)));
  let best = null;
  for (const t of tasks) {
    const tw = wordsOf(`${t.title} ${t.client ? U.nameOf(t.client) : ''}`);
    const overlap = tw.filter((w) => q.has(w)).length;
    const score = overlap / Math.max(2, Math.min(q.size, tw.length));
    if (overlap >= 2 && (!best || score > best.score)) best = { t, score };
  }
  if (!best) { turn.say('Which to-do? I couldn’t match that to anything on your list.'); turn.suggest('Show my to-dos'); return; }
  await turn.call('complete_task', { task_id: best.t.id });
  turn.say(`Checked off **${best.t.title}**.`);
}

async function intentTasksList(turn) {
  const { result } = await turn.call('list_tasks', { limit: 10 });
  if (!result.count) { turn.say('Your list is clear.'); return; }
  const lines = [`**${result.count} open to-do${result.count === 1 ? '' : 's'}:**`, ''];
  for (const t of result.tasks) lines.push(`- ${t.title}${t.client ? ` (${t.client})` : ''}${t.due_local ? ` · ${t.due_local}` : ''}${t.overdue ? ' · _overdue_' : ''}`);
  turn.say(lines.join('\n'));
}

async function intentCalls(turn, text) {
  const missedOnly = /missed|voicemail/i.test(text);
  const { result } = await turn.call('recent_calls', { missed_only: missedOnly, limit: 6 });
  if (!result.calls.length) { turn.say(missedOnly ? 'No missed calls. ' : 'No calls logged yet.'); return; }
  const lines = [`**${missedOnly ? 'Missed calls' : 'Recent calls'}:**`, ''];
  for (const k of result.calls) lines.push(`- **${k.client}** · ${k.direction === 'inbound' ? (k.status === 'voicemail' ? 'voicemail' : k.status === 'completed' ? 'incoming' : 'missed') : 'outgoing'} · ${k.when_local}${k.voicemail ? ` — “${U.clip(k.voicemail, 80)}”` : k.summary ? ` — ${U.clip(k.summary, 80)}` : ''}`);
  turn.say(lines.join('\n'));
  turn.entities.push(...result.calls.filter((k) => k.client_id).slice(0, 3).map((k) => ({ type: 'client', id: k.client_id, name: k.client, sub: k.when_local, action: 'call' })));
}

async function intentRemember(turn, text) {
  const body = stripLeading(text, /^\s*(please\s+)?(remember|note to self|keep in mind|fyi)[:,]?\s+(that\s+)?/i).replace(/[.!]+$/, '');
  if (!body) { turn.say('What should I remember?'); return; }
  const fact = body.replace(/^i\b/i, 'The agent').replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them');
  const { result } = await turn.call('remember', { text: fact.charAt(0).toUpperCase() + fact.slice(1), kind: /goal|target/i.test(body) ? 'goal' : 'preference' });
  turn.say(result.note || 'Got it — I’ll keep that in mind.');
}

async function intentNewClient(turn, text) {
  const phone = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.exec(text);
  const email = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(text);
  const nameM = /(?:client|buyer|seller|investor|contact|lead)[,:]?\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2})/.exec(text) || /\badd\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2})/.exec(text);
  if (!nameM && !phone && !email) { turn.say('Who should I add? Give me a name and a phone or email.'); return; }
  const [first, ...rest] = (nameM ? nameM[1] : '').split(/\s+/);
  const type = /\bseller\b/i.test(text) ? 'seller' : /\binvestor\b/i.test(text) ? 'investor' : /\brenter|tenant\b/i.test(text) ? 'renter' : 'buyer';
  const { result } = await turn.call('create_client', { first_name: first || '', last_name: rest.join(' '), phone: phone ? phone[1] : undefined, email: email ? email[1] : undefined, type });
  turn.say(result.existing ? result.note : `Added **${[first, ...rest].join(' ')}** to your book as a ${type}.`);
  if (!result.existing) turn.suggest(`Draft a welcome text to ${first || 'them'}`);
}

function intentHelp(turn, offline) {
  turn.say([
    offline ? 'I’m running in **offline mode** right now (no AI key on the server), so I stick to commands I can carry out exactly. Try:' : 'Here’s what I can do:',
    '',
    '- **Your day** — “What’s my day?”, “What’s tomorrow look like?”',
    '- **Who to call** — “Who should I call first?”',
    '- **To-dos** — “Remind me to send the Tavernier comps tomorrow”',
    '- **Calendar** — “Add a showing with the Delacroixs tomorrow at 2”, “Move Elena’s showing to 4”',
    '- **Drafts** — “Draft a just-listed text for 128 Sunset Dr”, “Text Elena that the inspection is Monday at 10”',
    '- **Clients** — “Tell me about Marcus”, “Make Elena a 5-star whale”, “Note for Priya: wants a dock”',
    '- **Pipeline & GCI** — “Show my pipeline”, “Move the Delacroix deal to under contract”, “How’s my GCI?”',
    '- **Book intel** — “Unread texts”, “Hot matches”, “Birthdays this month”, “Who owns waterfront in Coral Gables?”',
  ].join('\n'));
  turn.suggest(SUGGEST.day, SUGGEST.call, SUGGEST.pipeline);
}

async function intentGreeting(turn) {
  const { result: s } = await turn.call('todays_schedule', {});
  const { result: u } = await turn.call('unread_conversations', { limit: 1 });
  const h = Number(new Date().toLocaleString('en-US', { timeZone: turn.ctx.tz, hour: 'numeric', hour12: false }));
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const next = s.appointments.find((a) => true);
  turn.say(`${g}${turn.ctx.agentFirst ? `, ${turn.ctx.agentFirst}` : ''}. ${s.appointments.length ? `You have ${s.appointments.length} appointment${s.appointments.length === 1 ? '' : 's'} today${next ? ` — first up, **${next.title}** at ${next.start_local}` : ''}.` : 'Your calendar is open today.'}${u.count ? ` ${u.count} thread${u.count === 1 ? ' is' : 's are'} waiting on a reply.` : ''} What do you need?`);
  turn.suggest(SUGGEST.day, SUGGEST.call, SUGGEST.unread);
}

// ── router ─────────────────────────────────────────────────────────────────
const RX = {
  help: /^\s*(help|\?|what can you do|commands|how do you work|what do you do)\b/i,
  remember: /^\s*(please\s+)?(remember|note to self|keep in mind)\b/i,
  greeting: /^\s*(hi|hey|hello|yo|hiya|good (morning|afternoon|evening)|morning|evening)\b[\s!.,]*(serena)?[\s!.]*$/i,
  campaign: /\b(campaign|blast|automation)\b/i,
  draft: /\b(draft|write|compose)\b.*\b(text|message|note|sms|imessage|reply)\b|^\s*(text|message)\s+[A-Z]|\b(just[- ]?listed|price (drop|reduction|improvement))\b.*\b(text|message|draft)\b|\bsend\b.*\b(text|message)\b|^\s*(draft|write)\b/i,
  cancel: /\bcancel\b.*\b(showing|appointment|appt|consult|meeting|closing|tour|call|inspection|walk-?through|presentation)\b/i,
  reschedule: /\b(move|reschedule|push|bump|shift)\b.*\b(showing|appointment|appt|consult(ation)?|meeting|closing|tour|call|inspection|walk-?through|presentation)\b/i,
  appointment: /\b(add|book|schedule|set up|put|create|make)\b.*\b(showing|tour|consult(ation)?|listing (appointment|appt|presentation)|closing|inspection|appraisal|walk-?through|meeting|call|coffee|lunch|dinner|open house|appointment|appt|zoom|facetime)\b/i,
  moveDeal: /\bmove\b.*\bto\b.*\b(under contract|in contract|escrow|offer|touring|consultation|listed|closed|lost|pending)\b|\b(confirm)\b.*\bclosed\b/i,
  task: /^\s*(please\s+)?(add (a |an )?(task|to-?do|reminder)|remind me|don'?t let me forget|make sure i|i need to|i have to|i owe|to-?do:|task:)/i,
  completeTask: /^\s*(mark|check off|complete|finished|done with|i (already )?(finished|did|sent|called|emailed))\b/i,
  note: /^\s*(please\s+)?(add (a )?note|note( for| to| on)?|log( that)?|jot down)\b/i,
  rate: /\b(\d|one|two|three|four|five)[- ]?star\b|\b(make|mark|flag|set)\b.*\b(whale|past client|sphere|inactive)\b/i,
  newClient: /\b(add|create|new)\b.*\b(client|buyer|seller|investor|contact|lead)\b.*(\d{3}.*\d{4}|@)/i,
  call: /\b(who (should|do|to) i call|call (first|next)|who to call|call list|who needs a call|who should i (phone|ring))\b/i,
  unread: /\b(unread|who texted|new (texts|messages)|who'?s waiting|waiting on (a )?(reply|me)|inbox)\b/i,
  pipeline: /\b(pipeline|my deals|open deals|deals in|under contract|escrows?)\b/i,
  gci: /\b(gci|commissions?|how much (have i|did i|i'?ve) (made|make|earn|earned)|income|earned|paycheck|production)\b/i,
  matches: /\b(match|matches|matchmaker|fits? for)\b/i,
  signals: /\b(birthdays?|anniversar(y|ies)|arm|resets?|lease(s)? (end|expir)|loan matur|maturities)\b/i,
  owners: /\bwho owns\b|\bowners? (of|in)\b|\bwho in my book owns\b/i,
  calls: /\b(missed calls?|recent calls|voicemails?|call log|who called)\b/i,
  tasksList: /\b(my (to-?dos|tasks|list)|show (my )?(to-?dos|tasks)|open (to-?dos|tasks)|what'?s on my list)\b/i,
  listings: /\b(listings?|homes?|houses?|condos?|propert(y|ies)|estates?|penthouses?|villas?|on the market|for sale|inventory)\b/i,
  day: /\b(my day|today|tonight|tomorrow|schedule|agenda|calendar|what'?s on|what do i have|this morning|this afternoon|(mon|tues|wednes|thurs|fri|satur|sun)day)\b/i,
  client: /^\s*(tell me about|who is|who's|pull up|look up|find|open|show me|search( for)?|what do (we|i) know about)\b/i,
};

async function route(turn, text, context) {
  const t = String(text || '').trim();
  try {
    if (RX.help.test(t)) return intentHelp(turn, turn.ctx.offline);
    if (RX.remember.test(t)) return await intentRemember(turn, t);
    if (RX.greeting.test(t)) return await intentGreeting(turn);
    if (RX.campaign.test(t) && /\b(draft|create|set up|start|make|build)\b/i.test(t)) return await intentCampaign(turn, t);
    if (RX.newClient.test(t)) return await intentNewClient(turn, t);
    if (RX.task.test(t)) return await intentTask(turn, t, context);
    if (RX.draft.test(t)) return await intentDraftText(turn, t, context);
    if (RX.cancel.test(t)) return await intentReschedule(turn, t, true);
    if (RX.reschedule.test(t)) return await intentReschedule(turn, t, false);
    if (RX.moveDeal.test(t)) return await intentMoveDeal(turn, t);
    if (RX.appointment.test(t)) return await intentAppointment(turn, t, context);
    if (RX.completeTask.test(t)) return await intentCompleteTask(turn, t);
    if (RX.note.test(t)) return await intentNote(turn, t, context);
    if (RX.rate.test(t)) return await intentRate(turn, t, context);
    if (RX.call.test(t)) return await intentCall(turn);
    if (RX.tasksList.test(t)) return await intentTasksList(turn);
    if (RX.unread.test(t)) return await intentUnread(turn);
    if (RX.gci.test(t)) return await intentGci(turn);
    if (RX.owners.test(t)) return await intentOwners(turn, t);
    if (RX.signals.test(t)) return await intentSignals(turn, t);
    if (RX.calls.test(t)) return await intentCalls(turn, t);
    if (RX.matches.test(t)) return await intentMatches(turn, t);
    if (RX.pipeline.test(t)) return await intentPipeline(turn);
    if (RX.client.test(t)) return await intentClient(turn, t, context);
    if (RX.listings.test(t) && !(await mentionedClients(turn.ctx.workspaceId, t, turn.ctx)).length) return await intentListings(turn, t);
    if (RX.day.test(t)) return await intentDay(turn, t);
    // A bare name ("Elena Vasquez") → their file.
    const hits = await mentionedClients(turn.ctx.workspaceId, t, turn.ctx);
    if (hits.length && hits[0].score >= 3 && wordsOf(t).length <= 6) return await intentClient(turn, t, context);
    if (RX.listings.test(t)) return await intentListings(turn, t);
    return intentHelp(turn, turn.ctx.offline);
  } catch (err) {
    if (err && err.code === 'ambiguous' && err.candidates) return askWhich(turn, err.candidates);
    turn.say(`I couldn’t finish that: ${err.message || 'something went wrong'}.`);
    return null;
  }
}

module.exports = { route, mentionedClients, pickClient, justListedCopy };

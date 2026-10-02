// Sender Guard — the limits every automated text obeys so the ONE phone number
// a workspace texts from never gets blocked by Apple or flagged by a carrier.
// Ported from RevMatch (CLAUDE.md §21, LOCKED). Nothing here is optional per
// campaign, and no UI setting loosens it. The answer to more reach is more
// days, never a higher cap on the agent's number.
//
// Two tiers:
//   COLD      never replied to us, ever (no inbound in the thread)
//   EXISTING  has replied at least once
// and one flag across both:
//   NEW       no message either way in the last 30 days (counts against the
//             daily new-conversation budget)
//
// Enforcement points (engine.processRow):
//   checkSend()    before drafting  — breaker, opt-out, hours, budgets, per-person caps, tiers, pacing
//   checkContent() after drafting   — duplicate text / duplicate photo
//   recordSend()   after hand-off   — counters, warm-up, pacing clock
// plus optOut() / tripBreaker() / recordFailure() from the reply + failure paths
// and planLaunch() to lay out a launch. State lives in Workspace.settings.senderGuard.
//
// The decision logic is PURE (evaluateSend / computeBudget / evaluateContent)
// so the rules are unit-tested without a database (senderGuard.test.js).
const prisma = require('../../lib/prisma');
const { tzForPhone, normalizePhone } = require('../../lib/phone');
const { partsIn, zonedTime } = require('../../lib/dates');
const store = require('./settingsStore');

// ── The rules (all in one place; RevMatch CLAUDE.md §21 documents them) ──
const RULES = Object.freeze({
  LINE_DAILY_AUTOMATED: 100,      // automated texts a day, new + existing
  LINE_DAILY_TOTAL: 150,          // manual + automated: past this, automated stops for the day
  NEW_DAILY_HARD_CAP: 50,         // never more new conversations than this
  NEW_DAILY_TARGET_MIN: 15,       // today's target is drawn between these…
  NEW_DAILY_TARGET_MAX: 25,       // …so no two days look alike
  NEW_HOURLY_CAP: 8,
  DAY_RESET_HOUR: 3,              // counts reset at 3 AM local, not midnight
  NEW_RECENCY_DAYS: 30,           // "new" = nothing either way in 30 days
  COLD_MAX_UNANSWERED: 2,         // automated texts to a cold contact with no reply
  GAP_NEW_MIN_MS: 5 * 60000,      // new conversation: 5 min + long-tailed 0-10 min
  GAP_NEW_JITTER_MS: 10 * 60000,
  GAP_EXISTING_MIN_MS: 60000,     // existing thread: 60 s + random 0-130 s
  GAP_EXISTING_JITTER_MS: 130000,
  NOW_MAX_RECIPIENTS: 5,          // "All now" only for ≤5 EXISTING contacts
  DUP_TEXT_MAX_PER_DAY: 3,        // same text to at most 3 different people a day
  DUP_PHOTO_COLD_MAX_PER_DAY: 20, // same photo to at most 20 cold contacts a day
  PER_PERSON_24H: 1,              // automated texts WE start, per person…
  PER_PERSON_7D: 2,
  PER_PERSON_30D: 6,
  PER_PERSON_ANY_24H: 3,          // any texts (agent's included) to one person in 24 h
  HOURS_START: 9,                 // recipient's local time, by area code
  HOURS_END: 20,                  // 8 PM
  REPLY_RATE_MIN: 0.30,           // reply rate below this halves the new target…
  REPLY_RATE_MIN_SENDS: 30,       // …once at least this many sends in 7 days
  GREEN_DAILY: 100,               // SMS/MMS (green bubbles) a day
  GREEN_GAP_MS: 60000,
  BREAKER_FAILURES: 2,            // consecutive undelivered → breaker
  BREAKER_UNDELIVERED_PCT: 0.05,  // >5% of the last 20 undelivered → breaker
  BREAKER_SAMPLE: 20,
  CAUTION_DAYS: 7,                // after a trip: half budget for a week
  WARMUP_IDLE_RESET_DAYS: 30,
});

// Warm-up ladder for a fresh number (or one idle 30 days): new conversations
// a day at each step, and the days spent there before it can climb.
const WARMUP = Object.freeze([
  { limit: 2, days: 2 },
  { limit: 5, days: 2 },
  { limit: 10, days: 3 },
  { limit: 20, days: 7 },
  { limit: 30, days: 7 },
  { limit: null, days: Infinity }, // fully warm: the normal daily target applies
]);
const WARM_STEP = WARMUP.length - 1;

// Texts WE start (blasts, the no-reply nudge, automation triggers) carry the
// per-person automated caps and the new-conversation budget. A follow-up that
// answers their reply (lane step, close-out), an approved reply, or an event
// reminder is a conversation, not a blast: line-wide limits only.
const WE_START = new Set(['initial_send', 'gray_check', 'auto_step']);
const OPENS_THREAD = new Set(['initial_send', 'auto_step']);

// ── Opt-out language ───────────────────────────────────────────────────
// The FCC per-se keywords plus the phrasings people actually use. A HARD stop
// gets one fixed confirmation; a SOFT no just stops us, silently.
const HARD_STOP_RE = /^\s*(stop|stopall|stop all|quit|revoke|opt[\s-]?out|cancel|unsubscribe|end|remove me|don'?t text me|do not text me|cancel texts)\b/i;
const SOFT_NO_RE = /\b(not interested|no thanks?|no thank you|wrong number|who is this\??|who'?s this\??|leave me alone|stop texting|stop messaging|take me off|remove me|do not contact|don'?t contact|never text|lose my number|spam|scam|unsubscribe|go away)\b/i;
const START_RE = /^\s*(start|unstop|resume|subscribe|yes,? (text|message) me)\b/i;

function isHardStop(text) { return HARD_STOP_RE.test(String(text || '')); }
function isSoftNo(text) { return SOFT_NO_RE.test(String(text || '')); }
function isOptIn(text) { return START_RE.test(String(text || '')); }

// Fixed, plain, never AI-written, never marketing.
const OPT_OUT_CONFIRMATION = "Got it, you won't get any more texts from me. Reply START if you ever change your mind.";

// ── Time helpers (guard day runs 3 AM → 3 AM local) ────────────────────
const DAY = 86400000;
function localDate(date, tz) {
  const p = partsIn(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
function hourIn(date, tz) { return partsIn(date, tz).hour; }
function dayKeyFor(date, tz) { return localDate(new Date(date.getTime() - RULES.DAY_RESET_HOUR * 3600000), tz); }
function hourKeyFor(date, tz) { return `${localDate(date, tz)}T${hourIn(date, tz)}`; }
function dayStartFor(date, tz) { return zonedTime(dayKeyFor(date, tz), RULES.DAY_RESET_HOUR, 0, tz); }
function inHours(date, tz) { const h = hourIn(date, tz); return h >= RULES.HOURS_START && h < RULES.HOURS_END; }
// Next moment the window opens where they are, plus a random 0-45 min so the
// day never starts like clockwork.
function nextWindowOpen(from, tz, rand = Math.random) {
  const d = new Date(from);
  for (let i = 0; i < 200; i += 1) {
    if (hourIn(d, tz) === RULES.HOURS_START) {
      const start = zonedTime(localDate(d, tz), RULES.HOURS_START, 0, tz);
      return new Date(start.getTime() + Math.floor(rand() * 45 * 60000));
    }
    d.setTime(d.getTime() + 15 * 60000);
  }
  return new Date(from.getTime() + 12 * 3600000);
}

// ── Pacing ─────────────────────────────────────────────────────────────
// Long-tailed random gaps: most a few minutes apart, a few much longer,
// never machine-regular, never on :00 / :15 / :30 / :45.
function expJitter(meanMs, capMs, rand = Math.random) {
  const u = Math.max(1e-6, rand());
  return Math.min(capMs, Math.round(-Math.log(u) * meanMs));
}
function gapForTier(isNew, rand = Math.random) {
  return isNew
    ? RULES.GAP_NEW_MIN_MS + expJitter(RULES.GAP_NEW_JITTER_MS * 0.45, RULES.GAP_NEW_JITTER_MS, rand)
    : RULES.GAP_EXISTING_MIN_MS + expJitter(RULES.GAP_EXISTING_JITTER_MS * 0.5, RULES.GAP_EXISTING_JITTER_MS, rand);
}
function avoidRoundMinute(ms, rand = Math.random) {
  const d = new Date(ms);
  if (d.getUTCMinutes() % 15 === 0) return ms + 60000 + Math.floor(rand() * 180000);
  return ms;
}

function fmtWhen(d, tz) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d)); } catch { return new Date(d).toISOString(); }
}

function normText(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// ── PURE: today's new-conversation budget ──────────────────────────────
// -> { target, newToday, newThisHour, hourKey, dayKey, caution, governed,
//      replyRate, warmupStep, statePatch }
function computeBudget({ state = {}, now = new Date(), tz = 'America/New_York', replyRate = null, rand = Math.random }) {
  const s = { ...state };
  const patch = {};
  const dayKey = dayKeyFor(now, tz);
  if (s.dayKey !== dayKey) {
    const span = RULES.NEW_DAILY_TARGET_MAX - RULES.NEW_DAILY_TARGET_MIN + 1;
    s.dailyNewTarget = RULES.NEW_DAILY_TARGET_MIN + Math.floor(rand() * span);
    s.dayKey = dayKey; s.newToday = 0; s.hourKey = hourKeyFor(now, tz); s.newThisHour = 0;
    Object.assign(patch, { dayKey, dailyNewTarget: s.dailyNewTarget, newToday: 0, hourKey: s.hourKey, newThisHour: 0 });
  }
  // Idle 30 days → back to the bottom of the ladder.
  if (s.lastAutomatedSendAt && (now.getTime() - new Date(s.lastAutomatedSendAt).getTime()) > RULES.WARMUP_IDLE_RESET_DAYS * DAY && (s.warmupStep || 0) > 0) {
    s.warmupStep = 0; s.warmupStepStartedAt = now.toISOString();
    Object.assign(patch, { warmupStep: 0, warmupStepStartedAt: s.warmupStepStartedAt });
  }
  const warmupStep = Math.max(0, Math.min(Number(s.warmupStep) || 0, WARM_STEP));
  let target = Number(s.dailyNewTarget) || RULES.NEW_DAILY_TARGET_MIN;
  const step = WARMUP[warmupStep];
  if (step.limit != null) target = Math.min(target, step.limit);
  const governed = replyRate != null && replyRate < RULES.REPLY_RATE_MIN;
  if (governed) target = Math.max(1, Math.floor(target / 2));
  const caution = !!(s.cautionUntil && new Date(s.cautionUntil) > now);
  if (caution) target = Math.max(1, Math.floor(target / 2));
  target = Math.min(target, RULES.NEW_DAILY_HARD_CAP);
  const hourKey = hourKeyFor(now, tz);
  const newThisHour = s.hourKey === hourKey ? (Number(s.newThisHour) || 0) : 0;
  return { target, newToday: Number(s.newToday) || 0, newThisHour, hourKey, dayKey, caution, governed, replyRate, warmupStep, statePatch: patch };
}

// ── PURE: may this text go out right now? ──────────────────────────────
// counts: { automated, total, green, lastGreenAt }
// facts:  { cold, isNew, unansweredAutomated, auto24h, auto7d, auto30d, any24h, green }
// -> { allow: true, tier, isNew, stripAttachment, green, countsNew }
// -> { allow: false, code, reason, deferUntil }  (deferUntil null = never for this send)
function evaluateSend({ kind = 'initial_send', optedOut = false, state = {}, now = new Date(), tz = 'America/New_York', recipientTz, counts, facts, budget, rand = Math.random }) {
  const rtz = recipientTz || tz;
  const weStarted = WE_START.has(kind);

  // 1. The whole number is paused (breaker).
  if (state.breakerUntil && new Date(state.breakerUntil) > now) {
    return { allow: false, code: 'breaker', reason: `Paused for safety until ${fmtWhen(state.breakerUntil, tz)}: ${state.breakerReason || 'a warning sign'}`, deferUntil: new Date(new Date(state.breakerUntil).getTime() + 60000) };
  }
  // 2. Opted out / declined: never, on any path.
  if (optedOut) return { allow: false, code: 'opted_out', reason: 'This person asked not to be texted', deferUntil: null };
  // 3. 9 AM to 8 PM in THEIR local time.
  if (!inHours(now, rtz)) {
    return { allow: false, code: 'hours', reason: `Outside ${RULES.HOURS_START} AM to ${RULES.HOURS_END - 12} PM where they are`, deferUntil: nextWindowOpen(now, rtz, rand) };
  }
  const tomorrow = nextWindowOpen(new Date(dayStartFor(now, tz).getTime() + DAY), tz, rand);
  // 4. Line-wide ceilings.
  if ((counts.automated || 0) >= RULES.LINE_DAILY_AUTOMATED) {
    return { allow: false, code: 'daily_automated', reason: `Daily limit of ${RULES.LINE_DAILY_AUTOMATED} automated texts reached`, deferUntil: tomorrow };
  }
  if ((counts.total || 0) >= RULES.LINE_DAILY_TOTAL) {
    return { allow: false, code: 'daily_total', reason: `Your number sent ${counts.total} texts today (limit ${RULES.LINE_DAILY_TOTAL} with your own)`, deferUntil: tomorrow };
  }
  // 5. Per person, every campaign + automation together.
  if ((facts.any24h || 0) >= RULES.PER_PERSON_ANY_24H) {
    return { allow: false, code: 'per_person', reason: 'Already texted 3 times in 24 hours', deferUntil: new Date(now.getTime() + DAY) };
  }
  if (weStarted) {
    if ((facts.auto24h || 0) >= RULES.PER_PERSON_24H) return { allow: false, code: 'per_person', reason: 'Already got an automated text today', deferUntil: new Date(now.getTime() + DAY) };
    if ((facts.auto7d || 0) >= RULES.PER_PERSON_7D) return { allow: false, code: 'per_person', reason: 'Already got 2 automated texts this week', deferUntil: new Date(now.getTime() + 3 * DAY) };
    if ((facts.auto30d || 0) >= RULES.PER_PERSON_30D) return { allow: false, code: 'per_person', reason: 'Already got 6 automated texts this month', deferUntil: new Date(now.getTime() + 7 * DAY) };
  }
  // 6. Cold tier: at most 2 unanswered automated texts.
  if (facts.cold && (facts.unansweredAutomated || 0) >= RULES.COLD_MAX_UNANSWERED) {
    return { allow: false, code: 'cold_unanswered', reason: 'They have not replied to 2 texts. Waiting for them, or for you to text them yourself', deferUntil: null };
  }
  // 7. Green bubbles have their own meter.
  if (facts.green) {
    if ((counts.green || 0) >= RULES.GREEN_DAILY) return { allow: false, code: 'green_daily', reason: `Daily limit of ${RULES.GREEN_DAILY} SMS reached`, deferUntil: tomorrow };
    const lastGreen = counts.lastGreenAt ? new Date(counts.lastGreenAt).getTime() : 0;
    if (lastGreen && now.getTime() - lastGreen < RULES.GREEN_GAP_MS) {
      return { allow: false, code: 'pacing', reason: 'Spacing out SMS sends', deferUntil: new Date(lastGreen + RULES.GREEN_GAP_MS + Math.floor(rand() * 30000)) };
    }
  }
  // 8. New-conversation budget (sends that open or re-open a thread).
  const countsNew = !!(facts.isNew && OPENS_THREAD.has(kind));
  if (countsNew && budget) {
    if (budget.newToday >= budget.target) {
      return { allow: false, code: 'new_daily', reason: `Today's new-conversation budget (${budget.target}) is used up`, deferUntil: tomorrow };
    }
    if (budget.newThisHour >= RULES.NEW_HOURLY_CAP) {
      return { allow: false, code: 'new_hourly', reason: `${RULES.NEW_HOURLY_CAP} new conversations this hour already`, deferUntil: new Date(now.getTime() + (61 + Math.floor(rand() * 10)) * 60000) };
    }
  }
  // 9. Pacing since the last automated send on the number.
  if (state.lastAutomatedSendAt) {
    const since = now.getTime() - new Date(state.lastAutomatedSendAt).getTime();
    const need = facts.isNew ? RULES.GAP_NEW_MIN_MS : RULES.GAP_EXISTING_MIN_MS;
    if (since < need) {
      return { allow: false, code: 'pacing', reason: 'Spacing out sends so they look human', deferUntil: new Date(now.getTime() + (need - since) + expJitter(60000, 4 * 60000, rand)) };
    }
  }
  return {
    allow: true,
    tier: facts.cold ? 'cold' : 'existing',
    isNew: !!facts.isNew,
    // Cold + first text: no photo, no calendar file. A stranger who gets a
    // flyer first is exactly who taps Report Junk.
    stripAttachment: !!(facts.cold && OPENS_THREAD.has(kind)),
    green: !!facts.green,
    countsNew,
  };
}

// ── PURE: duplicate text / photo ───────────────────────────────────────
// rows: today's automated sends [{ body, conversationId, attachments:[{url,mimeType}] }]
function evaluateContent({ check = {}, text, attachments = [], rows = [], now = new Date() }) {
  const norm = normText(text);
  if (norm) {
    const same = new Set(rows.filter((r) => normText(r.body) === norm).map((r) => r.conversationId || r.id));
    if (same.size >= RULES.DUP_TEXT_MAX_PER_DAY) {
      return { allow: false, code: 'dup_text', reason: `The same text already went to ${same.size} people today. Redrafting`, redraft: true };
    }
  }
  const photo = (attachments || []).find((a) => a && a.url && /^image\//i.test(String(a.mimeType || '')));
  if (photo && check.tier === 'cold') {
    const samePhoto = rows.filter((r) => Array.isArray(r.attachments) && r.attachments.some((a) => a && a.url === photo.url)).length;
    if (samePhoto >= RULES.DUP_PHOTO_COLD_MAX_PER_DAY) {
      return { allow: false, code: 'dup_photo', reason: `That photo already went to ${samePhoto} people today`, deferUntil: new Date(now.getTime() + 6 * 3600000) };
    }
  }
  return { allow: true };
}

// ── State ──────────────────────────────────────────────────────────────
// A number with real history (an established book) starts fully warm; a fresh
// number starts at the bottom of the ladder.
async function inferWarmup(workspaceId, now) {
  try {
    const [count, oldest] = await Promise.all([
      prisma.message.count({ where: { workspaceId, isFromMe: true } }),
      prisma.message.findFirst({ where: { workspaceId, isFromMe: true }, orderBy: { sentAt: 'asc' }, select: { sentAt: true } }),
    ]);
    const ageDays = oldest ? (now.getTime() - new Date(oldest.sentAt).getTime()) / DAY : 0;
    return (count >= 25 || ageDays >= 14) ? WARM_STEP : 0;
  } catch { return 0; }
}

async function getState(workspaceId, now = new Date()) {
  const { settings, timezone } = await store.readSettings(workspaceId);
  let s = settings.senderGuard;
  if (!s || typeof s !== 'object' || !s.initializedAt) {
    const step = await inferWarmup(workspaceId, now);
    s = { initializedAt: now.toISOString(), warmupStep: step, warmupStepStartedAt: now.toISOString(), consecutiveFailures: 0, ...(s || {}) };
    await store.mergeKey(workspaceId, 'senderGuard', s);
  }
  return { state: s, tz: timezone || 'America/New_York', aiPausedAt: settings.aiTextingPausedAt || null };
}

const SENT_STATUSES = { notIn: ['failed', 'cancelled', 'scheduled'] };

// Everything counted today (guard day), in one pass.
async function todayCounts({ workspaceId, tz, now }) {
  const dayStart = dayStartFor(now, tz);
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where: { workspaceId, isFromMe: true, campaignId: { not: null }, sentAt: { gte: dayStart }, status: SENT_STATUSES },
      select: { id: true, body: true, service: true, conversationId: true, sentAt: true, attachments: { select: { url: true, mimeType: true } } },
    }),
    prisma.message.count({ where: { workspaceId, isFromMe: true, sentAt: { gte: dayStart }, status: SENT_STATUSES } }),
  ]);
  const greenRows = rows.filter((r) => /^(sms|mms|rcs)$/i.test(String(r.service || '')));
  const lastGreenAt = greenRows.map((r) => new Date(r.sentAt).getTime()).sort((a, b) => b - a)[0] || null;
  return { dayStart, rows, automated: rows.length, green: greenRows.length, lastGreenAt, total: Math.max(total, rows.length) };
}

async function clientConversationIds(workspaceId, client) {
  const phone = normalizePhone(client.phone || '');
  const convs = await prisma.conversation.findMany({
    where: { workspaceId, isGroup: false, OR: [{ clientId: client.id }, ...(phone ? [{ handle: phone }] : [])] },
    select: { id: true, channel: true, lastMessageAt: true },
    orderBy: { lastMessageAt: 'desc' },
  });
  return convs;
}

// Cold / new / per-person facts about one recipient.
async function recipientFacts({ workspaceId, client, now = new Date() }) {
  const convs = await clientConversationIds(workspaceId, client);
  const greenPref = client.deviceMode === 'sms' || (convs[0] && convs[0].channel === 'sms');
  if (!convs.length) {
    return { convIds: [], cold: !client.lastInboundAt, isNew: true, unansweredAutomated: 0, auto24h: 0, auto7d: 0, auto30d: 0, any24h: 0, green: !!greenPref };
  }
  const ids = convs.map((c) => c.id);
  const since24h = new Date(now.getTime() - DAY);
  const since7d = new Date(now.getTime() - 7 * DAY);
  const since30d = new Date(now.getTime() - RULES.NEW_RECENCY_DAYS * DAY);
  const auto = { conversationId: { in: ids }, isFromMe: true, campaignId: { not: null }, status: SENT_STATUSES };
  const [inbound, auto24h, auto7d, auto30d, any24h, lastInbound, lastAny] = await Promise.all([
    prisma.message.count({ where: { conversationId: { in: ids }, isFromMe: false } }),
    prisma.message.count({ where: { ...auto, sentAt: { gte: since24h } } }),
    prisma.message.count({ where: { ...auto, sentAt: { gte: since7d } } }),
    prisma.message.count({ where: { ...auto, sentAt: { gte: since30d } } }),
    prisma.message.count({ where: { conversationId: { in: ids }, isFromMe: true, sentAt: { gte: since24h }, status: SENT_STATUSES } }),
    prisma.message.findFirst({ where: { conversationId: { in: ids }, isFromMe: false }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
    prisma.message.findFirst({ where: { conversationId: { in: ids }, status: SENT_STATUSES }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ]);
  const unansweredAutomated = await prisma.message.count({
    where: { ...auto, ...(lastInbound ? { sentAt: { gt: lastInbound.sentAt } } : {}) },
  });
  const cold = inbound === 0 && !client.lastInboundAt;
  const isNew = !lastAny || new Date(lastAny.sentAt).getTime() < since30d.getTime();
  return { convIds: ids, cold, isNew, unansweredAutomated, auto24h, auto7d, auto30d, any24h, green: !!greenPref };
}

// Reply rate over the last 7 days of campaign sends (the governor).
async function replyRate(workspaceId, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const [sent, replied] = await Promise.all([
    prisma.campaignRecipient.count({ where: { workspaceId, lastSentAt: { gte: since } } }),
    prisma.campaignRecipient.count({ where: { workspaceId, lastSentAt: { gte: since }, repliedAt: { not: null } } }),
  ]);
  if (sent < RULES.REPLY_RATE_MIN_SENDS) return null;
  return replied / sent;
}

async function loadBudget({ workspaceId, state, tz, now }) {
  const rate = await replyRate(workspaceId, now);
  const budget = computeBudget({ state, now, tz, replyRate: rate });
  if (Object.keys(budget.statePatch).length) {
    await store.mergeKey(workspaceId, 'senderGuard', budget.statePatch);
    Object.assign(state, budget.statePatch);
  }
  return budget;
}

// ── checkSend: before drafting ─────────────────────────────────────────
// client: the Client row (id, phone, textOptOut, blocked, lastInboundAt, deviceMode)
async function checkSend({ workspaceId, client, kind = 'initial_send', now = new Date() }) {
  const { state, tz } = await getState(workspaceId, now);
  const fresh = await prisma.client.findUnique({ where: { id: client.id }, select: { textOptOut: true, blocked: true, archivedAt: true } }).catch(() => null);
  const optedOut = !!(fresh ? (fresh.textOptOut || fresh.blocked || fresh.archivedAt) : (client.textOptOut || client.blocked));
  const recipientTz = tzForPhone(client.phone, tz);
  // Cheap checks first: breaker / opt-out / hours need no counting.
  const early = evaluateSend({ kind, optedOut, state, now, tz, recipientTz, counts: {}, facts: {} , budget: null });
  if (!early.allow && ['breaker', 'opted_out', 'hours'].includes(early.code)) return early;
  const [counts, facts] = await Promise.all([
    todayCounts({ workspaceId, tz, now }),
    recipientFacts({ workspaceId, client, now }),
  ]);
  const budget = facts.isNew && OPENS_THREAD.has(kind) ? await loadBudget({ workspaceId, state, tz, now }) : null;
  const decision = evaluateSend({ kind, optedOut, state, now, tz, recipientTz, counts, facts, budget });
  if (!decision.allow) return decision;
  return { ...decision, budget, _rows: counts.rows, tz, counts: { automated: counts.automated, total: counts.total, green: counts.green } };
}

// ── checkContent: after drafting ───────────────────────────────────────
async function checkContent({ check, text, attachments, now = new Date() }) {
  return evaluateContent({ check, text, attachments, rows: (check && check._rows) || [], now });
}

// ── recordSend: after the hand-off ─────────────────────────────────────
async function recordSend({ workspaceId, check = {}, service, now = new Date() }) {
  const { state, tz } = await getState(workspaceId, now);
  const patch = { lastAutomatedSendAt: now.toISOString(), consecutiveFailures: 0 };
  if (/^(sms|mms|rcs)$/i.test(String(service || ''))) patch.lastGreenAt = now.toISOString();
  if (check.countsNew) {
    const hourKey = hourKeyFor(now, tz);
    const dayKey = dayKeyFor(now, tz);
    patch.dayKey = dayKey;
    patch.newToday = (state.dayKey === dayKey ? (Number(state.newToday) || 0) : 0) + 1;
    patch.hourKey = hourKey;
    patch.newThisHour = (state.hourKey === hourKey ? (Number(state.newThisHour) || 0) : 0) + 1;
  }
  await store.mergeKey(workspaceId, 'senderGuard', patch);
  await maybeAdvanceWarmup({ ...state, ...patch }, workspaceId, now);
}

async function maybeAdvanceWarmup(s, workspaceId, now) {
  const step = Number(s.warmupStep) || 0;
  if (step >= WARM_STEP) return;
  const started = s.warmupStepStartedAt ? new Date(s.warmupStepStartedAt).getTime() : now.getTime();
  if ((now.getTime() - started) / DAY < WARMUP[step].days) return;
  if (s.cautionUntil && new Date(s.cautionUntil) > now) return; // no climbing while in caution
  const rate = await replyRate(workspaceId, now);
  if (rate != null && rate < RULES.REPLY_RATE_MIN) return;
  await store.mergeKey(workspaceId, 'senderGuard', { warmupStep: step + 1, warmupStepStartedAt: now.toISOString() });
}

// ── Breakers ───────────────────────────────────────────────────────────
// Pause every automated send on the number until 3 AM tomorrow, drop a
// warm-up step, and run at half budget for a week.
async function tripBreaker({ workspaceId, reason, now = new Date() }) {
  const { state, tz } = await getState(workspaceId, now);
  const until = new Date(dayStartFor(now, tz).getTime() + DAY);
  await store.mergeKey(workspaceId, 'senderGuard', {
    breakerUntil: until.toISOString(),
    breakerReason: String(reason || '').slice(0, 200),
    cautionUntil: new Date(now.getTime() + RULES.CAUTION_DAYS * DAY).toISOString(),
    warmupStep: Math.max(0, (Number(state.warmupStep) || 0) - 1),
    warmupStepStartedAt: now.toISOString(),
    consecutiveFailures: 0,
  });
  console.warn(`[senderGuard] breaker tripped for workspace ${workspaceId}: ${reason}`);
  try {
    const { notify } = require('../../lib/notify');
    await notify({ workspaceId, type: 'system', title: 'Campaign texts paused', body: `${reason}. Paused until tomorrow morning to protect your number.`, data: { screen: 'campaigns', kind: 'sender_guard' } });
  } catch { /* best effort */ }
  try { require('../../realtime/hub').broadcast(workspaceId, 'campaign_updated', { kind: 'guard', reason }); } catch { /* noop */ }
}

// A campaign text failed to send. Two in a row trips the breaker; >5% of the
// last 20 automated sends failing trips it too.
async function recordFailure({ workspaceId, now = new Date() }) {
  const { state } = await getState(workspaceId, now);
  const n = (Number(state.consecutiveFailures) || 0) + 1;
  await store.mergeKey(workspaceId, 'senderGuard', { consecutiveFailures: n });
  if (n >= RULES.BREAKER_FAILURES) { await tripBreaker({ workspaceId, reason: `${n} texts in a row did not deliver`, now }); return; }
  const recent = await prisma.message.findMany({
    where: { workspaceId, isFromMe: true, campaignId: { not: null } },
    orderBy: { sentAt: 'desc' }, take: RULES.BREAKER_SAMPLE, select: { status: true },
  }).catch(() => []);
  if (recent.length >= RULES.BREAKER_SAMPLE) {
    const failed = recent.filter((m) => m.status === 'failed').length;
    if (failed / recent.length > RULES.BREAKER_UNDELIVERED_PCT) await tripBreaker({ workspaceId, reason: `${failed} of the last ${recent.length} texts did not deliver`, now });
  }
}

// Someone said stop / no: flag them for good (until START), stop every
// automated send to them, and trip the number's breaker.
async function optOut({ workspaceId, clientId, text, hard, now = new Date() }) {
  if (clientId) {
    await prisma.client.updateMany({
      where: { id: clientId, workspaceId },
      data: { textOptOut: true, textOptOutAt: now, textOptOutReason: `${hard ? 'stop' : 'no'}: ${String(text || '').slice(0, 120)}` },
    }).catch(() => {});
    const rows = await prisma.campaignRecipient.findMany({
      where: { workspaceId, clientId, status: { in: ['pending', 'scheduled', 'drafting', 'sent', 'replied', 'rate_deferred', 'taken_over'] } },
      select: { id: true, meta: true, campaignId: true },
    }).catch(() => []);
    for (const r of rows) {
      await prisma.campaignRecipient.update({
        where: { id: r.id },
        data: { status: 'opted_out', nextSendAt: null, meta: { ...(r.meta || {}), queue: [] }, error: hard ? 'Replied STOP' : 'Said they are not interested' },
      }).catch(() => {});
    }
  }
  await tripBreaker({ workspaceId, reason: hard ? 'Someone replied STOP' : 'Someone replied that they are not interested', now });
}

async function optIn({ workspaceId, clientId, now = new Date() }) {
  if (!clientId) return;
  await prisma.client.updateMany({
    where: { id: clientId, workspaceId, textOptOut: true },
    data: { textOptOut: false, textOptOutAt: null, textOptOutReason: `re-opted in ${now.toISOString()}` },
  }).catch(() => {});
}

// The ONE fixed confirmation after a hard STOP — the guard's own compliance
// message (never AI-written, never marketing, sent once per opt-out).
async function sendOptOutConfirmation({ workspaceId, clientId, campaignId }) {
  try {
    const transport = require('./transport');
    // No business line ('device' mode): nothing automated can go out, the
    // opt-out itself is still recorded.
    if (await require('./mode').isDeviceMode(workspaceId)) return null;
    const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId } });
    if (!client || !client.phone) return null;
    return await transport.deliver({ workspaceId, client, body: OPT_OUT_CONFIRMATION, campaignId, aiGenerated: false, kind: 'opt_out_confirmation' });
  } catch (err) {
    console.error('[senderGuard] opt-out confirmation failed:', err.message);
    return null;
  }
}

// ── Launch planning ────────────────────────────────────────────────────
// Existing contacts first (safe and quick, 60-190 s apart), new conversations
// after (5-15 min apart, long-tailed), never on a round minute. "All now"
// survives only for ≤5 contacts who already text with you.
// people = [{ id, phone, client }]
async function planLaunch({ workspaceId, people, pacing = 'safe', baseMs = Date.now(), now = new Date(), rand = Math.random }) {
  const { state, tz } = await getState(workspaceId, now);
  const facts = [];
  for (const p of people) {
    const f = await recipientFacts({ workspaceId, client: p.client || { id: p.id, phone: p.phone }, now });
    facts.push({ person: p, cold: f.cold, isNew: f.isNew });
  }
  const existing = facts.filter((f) => !f.isNew);
  const fresh = facts.filter((f) => f.isNew);
  const effectivePace = pacing === 'all_now' && fresh.length === 0 && people.length <= RULES.NOW_MAX_RECIPIENTS ? 'all_now' : 'safe';
  const ordered = [...existing, ...fresh];
  let t = baseMs;
  const slots = ordered.map((f) => {
    const at = effectivePace === 'all_now' ? t : avoidRoundMinute(t, rand);
    t = at + (effectivePace === 'all_now' ? 0 : gapForTier(f.isNew, rand));
    return { id: f.person.id, at: new Date(at), tier: f.cold ? 'cold' : 'existing', isNew: f.isNew };
  });
  const budget = await loadBudget({ workspaceId, state, tz, now });
  const perDay = Math.max(1, budget.target);
  const remainingToday = Math.max(0, budget.target - budget.newToday);
  const days = fresh.length ? Math.max(1, 1 + Math.ceil(Math.max(0, fresh.length - remainingToday) / perDay)) : 1;
  return {
    slots, effectivePace,
    coldCount: facts.filter((f) => f.cold).length,
    newCount: fresh.length, existingCount: existing.length,
    estimatedDays: days, dailyNewTarget: budget.target, warmupStep: budget.warmupStep,
  };
}

// ── Status for the app (SenderGuardCard) ───────────────────────────────
async function status(workspaceId, now = new Date()) {
  const { state, tz, aiPausedAt } = await getState(workspaceId, now);
  const counts = await todayCounts({ workspaceId, tz, now });
  const budget = await loadBudget({ workspaceId, state, tz, now });
  const breaker = state.breakerUntil && new Date(state.breakerUntil) > now ? { until: state.breakerUntil, reason: state.breakerReason } : null;
  const caution = budget.caution ? { until: state.cautionUntil } : null;
  const deferred = await prisma.campaignRecipient.findMany({
    where: { workspaceId, status: 'rate_deferred' },
    select: { error: true, nextSendAt: true },
  });
  const reasons = {};
  for (const d of deferred) { const k = d.error || 'Waiting for a safe slot'; reasons[k] = (reasons[k] || 0) + 1; }
  const queued = await prisma.campaignRecipient.count({ where: { workspaceId, status: { in: ['pending', 'scheduled', 'sent', 'replied', 'taken_over'] }, nextSendAt: { not: null } } });
  const health = breaker ? 'red' : (caution || budget.governed) ? 'yellow' : 'green';
  const step = WARMUP[Math.min(budget.warmupStep, WARM_STEP)];
  return {
    ok: true,
    health,
    paused: !!aiPausedAt, pausedAt: aiPausedAt,
    breaker, caution, governed: budget.governed, replyRate: budget.replyRate,
    warmup: { step: budget.warmupStep, of: WARM_STEP, dailyLimit: step.limit, full: budget.warmupStep >= WARM_STEP },
    today: {
      automated: counts.automated, automatedLimit: RULES.LINE_DAILY_AUTOMATED,
      automatedLeft: Math.max(0, RULES.LINE_DAILY_AUTOMATED - counts.automated),
      total: counts.total, totalLimit: RULES.LINE_DAILY_TOTAL,
      newConversations: budget.newToday, newTarget: budget.target, newHardCap: RULES.NEW_DAILY_HARD_CAP,
      newLeft: Math.max(0, budget.target - budget.newToday),
      green: counts.green, greenLimit: RULES.GREEN_DAILY,
      resetsAt: new Date(dayStartFor(now, tz).getTime() + DAY).toISOString(),
    },
    hours: { start: RULES.HOURS_START, end: RULES.HOURS_END },
    waiting: { count: deferred.length, reasons },
    queued,
    rules: RULES,
  };
}

module.exports = {
  RULES, WARMUP, WARM_STEP, OPT_OUT_CONFIRMATION, WE_START, OPENS_THREAD,
  // pure
  evaluateSend, evaluateContent, computeBudget, gapForTier, avoidRoundMinute, expJitter,
  dayKeyFor, hourKeyFor, dayStartFor, nextWindowOpen, inHours, isHardStop, isSoftNo, isOptIn, normText,
  // db
  getState, todayCounts, recipientFacts, replyRate, checkSend, checkContent, recordSend, recordFailure,
  tripBreaker, optOut, optIn, sendOptOutConfirmation, planLaunch, status,
};

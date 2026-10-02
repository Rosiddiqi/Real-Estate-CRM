// Sender Guard rules (RevMatch CLAUDE.md §21) — pure decision tests, no DB.
//   node --test src/services/campaigns
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RULES, WARMUP, evaluateSend, evaluateContent, computeBudget, gapForTier, avoidRoundMinute,
  dayKeyFor, dayStartFor, nextWindowOpen, inHours, isHardStop, isSoftNo, isOptIn,
} = require('./senderGuard');

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
// Fri Oct 2 2026, 11:00 AM New York (15:00Z)
const NOON_NY = new Date('2026-10-02T15:00:00Z');
const fixed = (v) => () => v;
const base = (over = {}) => ({
  kind: 'initial_send', optedOut: false, state: {}, now: NOON_NY, tz: NY, recipientTz: NY,
  counts: { automated: 0, total: 0, green: 0 },
  facts: { cold: false, isNew: false, unansweredAutomated: 0, auto24h: 0, auto7d: 0, auto30d: 0, any24h: 0, green: false },
  budget: { target: 20, newToday: 0, newThisHour: 0 },
  rand: fixed(0.5),
  ...over,
});

test('allows a normal send inside the rules', () => {
  const d = evaluateSend(base());
  assert.equal(d.allow, true);
  assert.equal(d.tier, 'existing');
});

test('breaker pauses the whole number', () => {
  const until = new Date(NOON_NY.getTime() + 3600e3).toISOString();
  const d = evaluateSend(base({ state: { breakerUntil: until, breakerReason: 'Someone replied STOP' } }));
  assert.equal(d.allow, false);
  assert.equal(d.code, 'breaker');
  assert.ok(d.deferUntil > NOON_NY);
  assert.match(d.reason, /Someone replied STOP/);
});

test('opted out is never, on any path (no retry time)', () => {
  for (const kind of ['initial_send', 'lane_step', 'reminder_step', 'auto_step']) {
    const d = evaluateSend(base({ kind, optedOut: true }));
    assert.equal(d.allow, false);
    assert.equal(d.code, 'opted_out');
    assert.equal(d.deferUntil, null);
  }
});

test('9 AM to 8 PM in the RECIPIENT local time', () => {
  // 11 AM in New York is 8 AM in Los Angeles → outside their hours.
  const d = evaluateSend(base({ recipientTz: LA }));
  assert.equal(d.allow, false);
  assert.equal(d.code, 'hours');
  assert.equal(inHours(d.deferUntil, LA), true, 'defers to when their window is open');
  // 8:30 PM New York is out for a New York number.
  const late = new Date('2026-10-03T00:30:00Z');
  assert.equal(evaluateSend(base({ now: late })).code, 'hours');
  assert.equal(inHours(new Date('2026-10-02T13:00:00Z'), NY), true); // 9:00 AM ET
  assert.equal(inHours(new Date('2026-10-02T12:59:00Z'), NY), false); // 8:59 AM ET
  assert.equal(inHours(new Date('2026-10-02T23:59:00Z'), NY), true); // 7:59 PM ET
  assert.equal(inHours(new Date('2026-10-03T00:00:00Z'), NY), false); // 8:00 PM ET
});

test('line-wide ceilings: 100 automated, 150 total with your own', () => {
  assert.equal(evaluateSend(base({ counts: { automated: RULES.LINE_DAILY_AUTOMATED, total: 100 } })).code, 'daily_automated');
  assert.equal(evaluateSend(base({ counts: { automated: 10, total: RULES.LINE_DAILY_TOTAL } })).code, 'daily_total');
  assert.equal(evaluateSend(base({ counts: { automated: 99, total: 149 } })).allow, true);
});

test('per person: 3 texts of any kind in 24h, and 1/24h · 2/week · 6/month for texts we start', () => {
  assert.equal(evaluateSend(base({ facts: { ...base().facts, any24h: 3 } })).code, 'per_person');
  assert.equal(evaluateSend(base({ facts: { ...base().facts, auto24h: 1 } })).code, 'per_person');
  assert.equal(evaluateSend(base({ facts: { ...base().facts, auto7d: 2 } })).code, 'per_person');
  assert.equal(evaluateSend(base({ facts: { ...base().facts, auto30d: 6 } })).code, 'per_person');
  // A follow-up that answers their reply rides on line-wide limits only.
  assert.equal(evaluateSend(base({ kind: 'lane_step', facts: { ...base().facts, auto24h: 1, auto7d: 2 } })).allow, true);
  // …but the 3-in-24h cap applies to everything.
  assert.equal(evaluateSend(base({ kind: 'lane_step', facts: { ...base().facts, any24h: 3 } })).code, 'per_person');
});

test('cold tier: at most 2 unanswered automated texts, then nothing (no retry)', () => {
  const d = evaluateSend(base({ facts: { ...base().facts, cold: true, unansweredAutomated: 2 } }));
  assert.equal(d.code, 'cold_unanswered');
  assert.equal(d.deferUntil, null);
  assert.equal(evaluateSend(base({ facts: { ...base().facts, cold: true, unansweredAutomated: 1 } })).allow, true);
});

test('cold tier: no photo and no calendar file in the first text', () => {
  const cold = evaluateSend(base({ facts: { ...base().facts, cold: true } }));
  assert.equal(cold.allow, true);
  assert.equal(cold.tier, 'cold');
  assert.equal(cold.stripAttachment, true);
  assert.equal(evaluateSend(base()).stripAttachment, false);
  assert.equal(evaluateSend(base({ kind: 'lane_step', facts: { ...base().facts, cold: true } })).stripAttachment, false);
});

test('new-conversation budget: daily target and 8 per hour', () => {
  const nf = { ...base().facts, isNew: true };
  assert.equal(evaluateSend(base({ facts: nf, budget: { target: 20, newToday: 20, newThisHour: 0 } })).code, 'new_daily');
  assert.equal(evaluateSend(base({ facts: nf, budget: { target: 20, newToday: 5, newThisHour: RULES.NEW_HOURLY_CAP } })).code, 'new_hourly');
  const ok = evaluateSend(base({ facts: nf, budget: { target: 20, newToday: 5, newThisHour: 2 } }));
  assert.equal(ok.allow, true);
  assert.equal(ok.countsNew, true);
  // Reply follow-ups never touch the new-conversation budget.
  assert.equal(evaluateSend(base({ kind: 'lane_step', facts: nf, budget: { target: 20, newToday: 20, newThisHour: 9 } })).allow, true);
});

test('pacing: 5 min after the last send for a new conversation, 60 s for existing', () => {
  const last = new Date(NOON_NY.getTime() - 2 * 60e3).toISOString();
  assert.equal(evaluateSend(base({ state: { lastAutomatedSendAt: last }, facts: { ...base().facts, isNew: true } })).code, 'pacing');
  assert.equal(evaluateSend(base({ state: { lastAutomatedSendAt: last } })).allow, true);
  const recent = new Date(NOON_NY.getTime() - 20e3).toISOString();
  assert.equal(evaluateSend(base({ state: { lastAutomatedSendAt: recent } })).code, 'pacing');
});

test('green bubbles: 100 SMS a day, 1 minute apart', () => {
  const g = { ...base().facts, green: true };
  assert.equal(evaluateSend(base({ facts: g, counts: { automated: 1, total: 1, green: RULES.GREEN_DAILY } })).code, 'green_daily');
  assert.equal(evaluateSend(base({ facts: g, counts: { automated: 1, total: 1, green: 1, lastGreenAt: NOON_NY.getTime() - 30e3 } })).code, 'pacing');
  assert.equal(evaluateSend(base({ facts: g, counts: { automated: 1, total: 1, green: 1, lastGreenAt: NOON_NY.getTime() - 90e3 } })).allow, true);
});

test('duplicates: same text to at most 3 people a day (redraft); same photo to ≤20 cold contacts', () => {
  const rows = ['a', 'b', 'c'].map((id) => ({ id, conversationId: id, body: 'Hi! Just listed 3550 Main Hwy.' }));
  const dup = evaluateContent({ check: { tier: 'existing' }, text: 'hi!  just listed 3550 main hwy', rows });
  assert.equal(dup.allow, false);
  assert.equal(dup.redraft, true);
  assert.equal(evaluateContent({ check: { tier: 'existing' }, text: 'Different words', rows }).allow, true);
  const photo = { url: '/uploads/p.jpg', mimeType: 'image/jpeg' };
  const photoRows = Array.from({ length: RULES.DUP_PHOTO_COLD_MAX_PER_DAY }, (_, i) => ({ id: `p${i}`, conversationId: `p${i}`, body: `x${i}`, attachments: [photo] }));
  assert.equal(evaluateContent({ check: { tier: 'cold' }, text: 'unique', attachments: [photo], rows: photoRows }).code, 'dup_photo');
  assert.equal(evaluateContent({ check: { tier: 'existing' }, text: 'unique', attachments: [photo], rows: photoRows }).allow, true);
});

test('budget: random 15-25 target, warm-up ladder caps it, governor + caution halve it, hard cap 50', () => {
  const lo = computeBudget({ state: { warmupStep: WARMUP.length - 1 }, now: NOON_NY, tz: NY, rand: fixed(0) });
  const hi = computeBudget({ state: { warmupStep: WARMUP.length - 1 }, now: NOON_NY, tz: NY, rand: fixed(0.999) });
  assert.equal(lo.target, RULES.NEW_DAILY_TARGET_MIN);
  assert.equal(hi.target, RULES.NEW_DAILY_TARGET_MAX);
  assert.equal(computeBudget({ state: { warmupStep: 0 }, now: NOON_NY, tz: NY, rand: fixed(0.5) }).target, 2);
  assert.equal(computeBudget({ state: { warmupStep: 2 }, now: NOON_NY, tz: NY, rand: fixed(0.5) }).target, 10);
  const full = computeBudget({ state: { warmupStep: 5 }, now: NOON_NY, tz: NY, rand: fixed(0.5) }).target;
  const governed = computeBudget({ state: { warmupStep: 5 }, now: NOON_NY, tz: NY, replyRate: 0.1, rand: fixed(0.5) });
  assert.equal(governed.governed, true);
  assert.equal(governed.target, Math.floor(full / 2));
  const caution = computeBudget({ state: { warmupStep: 5, cautionUntil: new Date(NOON_NY.getTime() + 864e5).toISOString() }, now: NOON_NY, tz: NY, rand: fixed(0.5) });
  assert.equal(caution.caution, true);
  assert.equal(caution.target, Math.floor(full / 2));
  assert.ok(computeBudget({ state: { warmupStep: 5, dayKey: dayKeyFor(NOON_NY, NY), dailyNewTarget: 999 }, now: NOON_NY, tz: NY }).target <= RULES.NEW_DAILY_HARD_CAP);
});

test('idle 30 days drops the number back to the bottom of the warm-up ladder', () => {
  const b = computeBudget({ state: { warmupStep: 4, lastAutomatedSendAt: new Date(NOON_NY.getTime() - 31 * 864e5).toISOString() }, now: NOON_NY, tz: NY, rand: fixed(0.5) });
  assert.equal(b.warmupStep, 0);
  assert.equal(b.target, 2);
});

test('the guard day resets at 3 AM local, not midnight', () => {
  assert.equal(dayKeyFor(new Date('2026-10-03T06:30:00Z'), NY), '2026-10-02'); // 2:30 AM ET
  assert.equal(dayKeyFor(new Date('2026-10-03T07:30:00Z'), NY), '2026-10-03'); // 3:30 AM ET
  assert.equal(dayStartFor(NOON_NY, NY).toISOString(), '2026-10-02T07:00:00.000Z');
});

test('pacing gaps: new 5-15 min, existing 60-190 s, never on a quarter hour', () => {
  for (let i = 0; i < 200; i += 1) {
    const n = gapForTier(true);
    const e = gapForTier(false);
    assert.ok(n >= RULES.GAP_NEW_MIN_MS && n <= RULES.GAP_NEW_MIN_MS + RULES.GAP_NEW_JITTER_MS);
    assert.ok(e >= RULES.GAP_EXISTING_MIN_MS && e <= RULES.GAP_EXISTING_MIN_MS + RULES.GAP_EXISTING_JITTER_MS);
  }
  const quarter = Date.parse('2026-10-02T15:15:00Z');
  assert.notEqual(new Date(avoidRoundMinute(quarter)).getUTCMinutes() % 15, 0);
});

test('next window opens at 9 AM their time, never before', () => {
  const at = nextWindowOpen(new Date('2026-10-03T01:00:00Z'), NY, fixed(0)); // 9 PM ET
  assert.equal(at.toISOString(), '2026-10-03T13:00:00.000Z');
  const la = nextWindowOpen(new Date('2026-10-02T13:00:00Z'), LA, fixed(0)); // 6 AM PT
  assert.equal(la.toISOString(), '2026-10-02T16:00:00.000Z');
});

test('STOP / soft-no / START detection', () => {
  for (const t of ['STOP', 'stop', 'Unsubscribe', 'stop texting me', 'Cancel', 'opt out', 'remove me']) assert.equal(isHardStop(t) || isSoftNo(t), true, t);
  assert.equal(isHardStop('STOP'), true);
  for (const t of ['not interested', 'Wrong number', 'who is this?', 'no thanks', 'leave me alone']) assert.equal(isSoftNo(t), true, t);
  for (const t of ['Yes! Saturday works', "Can't stop thinking about that view", 'What time?']) {
    assert.equal(isHardStop(t), false, t);
    assert.equal(isSoftNo(t), false, t);
  }
  assert.equal(isOptIn('START'), true);
  assert.equal(isOptIn('unstop'), true);
  assert.equal(isOptIn('Started looking at the photos'), false);
});

// Reply classifier — the deterministic keyword fallback (used with no AI key /
// AI outage). "When in doubt, off_topic."
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyByKeywords } = require('./classifier');
const { parseSequence, resolveStepTime, timerTextToHours } = require('./sequence');
const { fallbackReply } = require('./replyAgent');

const k = (t, cur) => classifyByKeywords(t, { currentLane: cur || null });

test('clear interest → green lane', () => {
  for (const t of ['Yes! Count me in', 'Love to see it', 'Sounds great, send me the details', "I'm interested"]) {
    const v = k(t);
    assert.equal(v.kind, 'lane', t);
    assert.equal(v.lane, 'green', t);
  }
  // Asking to see it needs the agent's calendar: a question, leaning green.
  const ask = k('Can we set up a private showing Saturday?');
  assert.equal(ask.kind, 'question');
  assert.equal(ask.lane, 'green');
});

test('maybe / unsure → yellow lane', () => {
  for (const t of ['Maybe, let me check with my wife', "I'll try to swing by", 'Not sure yet', 'Possibly next week']) {
    const v = k(t);
    assert.equal(v.kind, 'lane', t);
    assert.equal(v.lane, 'yellow', t);
  }
});

test('stated conflicts / passes → red lane (even without the word no)', () => {
  for (const t of ["Can't make it, we're in Aspen", 'We already bought in Pinecrest', "I'll pass on this one", 'Traveling that weekend', 'Working with another agent']) {
    const v = k(t);
    assert.equal(v.lane, 'red', t);
  }
});

test('on-topic questions → question (no auto follow-up), with a best-guess lane', () => {
  const a = k("What's the HOA on that one?");
  assert.equal(a.kind, 'question');
  assert.equal(a.lane, 'yellow');
  const b = k('Yes! What time does it start?');
  assert.equal(b.kind, 'question');
  assert.equal(b.lane, 'green');
  assert.equal(k('Is there parking?').kind, 'question');
});

test('anything else is off_topic — when in doubt, off_topic', () => {
  for (const t of [
    'Did the title company send the closing docs?',
    'Any update on the deposit refund for the Grove house?',
    'How are the kids? Golf next week?',
    'Running late, call you tonight',
    'Ok',
    '👍',
    'Thanks!',
  ]) {
    const v = k(t);
    assert.equal(v.kind, 'off_topic', t);
    assert.equal(v.lane, null, t);
  }
});

test('a reaction after a substantive answer keeps the current lane', () => {
  const v = k('haha 👍', 'green');
  assert.equal(v.kind, 'lane');
  assert.equal(v.lane, 'green');
  assert.equal(k('Thanks!', 'red').lane, 'red');
});

test('lane prose parses into timed steps (event-anchored and reply-relative)', () => {
  const g = parseSequence('Remind them the evening before at 7, and again the morning of', 'green', { hasEvent: true });
  assert.equal(g.steps.length, 2);
  assert.equal(g.steps[0].timing.kind, 'evening_before');
  assert.equal(g.steps[0].timing.atHour, 19);
  assert.equal(g.steps[1].timing.kind, 'morning_of');
  const r = parseSequence('Thank them, right away', 'red');
  assert.equal(r.steps[0].timing.kind, 'immediate');
  const none = parseSequence('Keep it warm', 'yellow');
  assert.equal(none.steps[0].timing.kind, 'days_later');
  assert.equal(timerTextToHours('3 DAYS'), 72);
  assert.equal(timerTextToHours('a week'), 168);
  assert.equal(timerTextToHours('5'), 120);
});

test('step times resolve in the workspace timezone', () => {
  const ev = '2026-10-04T17:00:00Z'; // Sun 1 PM ET
  const morning = resolveStepTime({ timing: { kind: 'morning_of', atHour: 9 } }, { eventAt: ev, tz: 'America/New_York' });
  assert.equal(morning.toISOString(), '2026-10-04T13:00:00.000Z');
  const evening = resolveStepTime({ timing: { kind: 'evening_before', atHour: 18 } }, { eventAt: ev, tz: 'America/Los_Angeles' });
  assert.equal(evening.toISOString(), '2026-10-04T01:00:00.000Z');
});

test('reply agent fallback answers only logistics it can quote; abstains on money/terms', () => {
  const campaign = { brief: 'Open house', event: { startAt: '2026-10-04T17:00:00Z', endAt: '2026-10-04T20:00:00Z', address: '3550 Main Hwy' }, lanes: { aiReply: { mode: 'draft', instructions: 'Parking is free valet out front.' } } };
  const when = fallbackReply({ question: 'What time does it start?', campaign, tz: 'America/New_York', first: 'Ava' });
  assert.equal(when.abstain, false);
  assert.match(when.reply, /Oct 4/);
  assert.equal(fallbackReply({ question: 'Is there parking?', campaign, tz: 'America/New_York', first: 'Ava' }).abstain, false);
  assert.equal(fallbackReply({ question: 'Would they take 5.8?', campaign, tz: 'America/New_York', first: 'Ava' }).abstain, true);
  assert.equal(fallbackReply({ question: 'What are the taxes?', campaign, tz: 'America/New_York', first: 'Ava' }).abstain, true);
});

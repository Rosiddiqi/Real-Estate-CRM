// Run: node --test src/services/battlePlan/selfRules.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRuleText, compileConstraints, parseClock, parseDurationMin } = require('./selfRules');

test('parseClock handles am/pm/24h/noon', () => {
  assert.equal(parseClock('8am'), 480);
  assert.equal(parseClock('8 am'), 480);
  assert.equal(parseClock('1:30pm'), 810);
  assert.equal(parseClock('13:00'), 780);
  assert.equal(parseClock('noon'), 720);
  assert.equal(parseClock('12am'), 0);
  assert.equal(parseClock('garbage'), null);
});

test('parseDurationMin reads minutes and hours', () => {
  assert.equal(parseDurationMin('90 min'), 90);
  assert.equal(parseDurationMin('1.5h'), 90);
  assert.equal(parseDurationMin('2 hours'), 120);
  assert.equal(parseDurationMin('no duration'), null);
});

test('example rules parse to the right constraint', () => {
  assert.deepEqual(parseRuleText("Don't schedule calls before 8am"), { type: 'no_call_before', minute: 480 });
  assert.deepEqual(parseRuleText('Block 45 min for lunch'), { type: 'lunch', startMinute: 720, durationMin: 45 });
  assert.deepEqual(parseRuleText('Plan 1.5h every day for listing content'), { type: 'content_shoot', durationMin: 90 });
  assert.deepEqual(parseRuleText('Never call the same client twice in a day'), { type: 'no_double_contact' });
});

test('no calls after, max moves, and lunch-at-time parse', () => {
  assert.deepEqual(parseRuleText('no calls after 7pm'), { type: 'no_call_after', minute: 19 * 60 });
  assert.deepEqual(parseRuleText('cap my day at 8 moves'), { type: 'max_moves', count: 8 });
  assert.deepEqual(parseRuleText('lunch at 12:30 for 30 min'), { type: 'lunch', startMinute: 750, durationMin: 30 });
});

test('time-boxed personal block parses to a block_window', () => {
  const r = parseRuleText('block 30 min from 6pm to 7pm for the gym');
  assert.equal(r.type, 'block_window');
  assert.equal(r.startMinute, 18 * 60);
  assert.equal(r.endMinute, 19 * 60);
});

test('unrecognized rule falls back to advisory', () => {
  assert.deepEqual(parseRuleText('always lead with the view'), { type: 'advisory', text: 'always lead with the view' });
});

test('compileConstraints folds a rule set', () => {
  const rules = [
    { parsed: parseRuleText("Don't schedule calls before 8am") },
    { parsed: parseRuleText('no calls after 7pm') },
    { parsed: parseRuleText('Block 45 min for lunch') },
    { parsed: parseRuleText('Plan 1.5h for content') },
    { parsed: parseRuleText('cap my day at 6 moves') },
    { parsed: parseRuleText('block 30 min from 6pm to 7pm for the gym') },
    { parsed: parseRuleText('be kind') },
    { text: 'no calls before 9am', active: false },
  ];
  const c = compileConstraints(rules);
  assert.equal(c.noCallBeforeMin, 480);
  assert.equal(c.noCallAfterMin, 19 * 60);
  assert.equal(c.contentBlockMin, 90);
  assert.equal(c.lunchDurationMin, 45);
  assert.deepEqual(c.lunchWindow, { start: 720, end: 720 + 45 + 45 });
  assert.equal(c.maxMoves, 6);
  assert.equal(c.blockWindows.length, 1);
  assert.deepEqual(c.advisories, ['be kind']);
});

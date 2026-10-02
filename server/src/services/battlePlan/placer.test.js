// Run: node --test src/services/battlePlan/placer.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  placeCandidates, freeGaps, roundUpTo15, minutesToHHMM, localMinuteOfDay, slideLater, firstFreeSlot,
} = require('./placer');

const WINDOW = { start: 9 * 60, end: 19 * 60 }; // 09:00–19:00

function cand(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2, 8),
    kind: 'search.nudge',
    contactId: 'c1',
    durationMin: 15,
    impactDollars: null,
    score: 50,
    signal: { sourceKind: 'search', summary: 's' },
    ...over,
  };
}

test('roundUpTo15 snaps to quarter hours', () => {
  assert.equal(roundUpTo15(540), 540);
  assert.equal(roundUpTo15(541), 555);
  assert.equal(roundUpTo15(547), 555);
});

test('minutesToHHMM formats 24h', () => {
  assert.equal(minutesToHHMM(540), '09:00');
  assert.equal(minutesToHHMM(13 * 60 + 45), '13:45');
});

test('freeGaps subtracts appointments from the window', () => {
  const gaps = freeGaps(WINDOW, [{ start: 600, end: 630 }]); // 10:00–10:30 busy
  assert.deepEqual(gaps, [{ start: 540, end: 600 }, { start: 630, end: 1140 }]);
});

test('content block lands in the largest open gap', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'content', kind: 'content.block', contactId: null, durationMin: 90, score: 99 })],
    [{ start: 600, end: 630 }], // small morning showing; biggest gap is after it
    WINDOW,
  );
  const content = placed.find((p) => p.id === 'content');
  assert.ok(content, 'content placed');
  assert.ok(content.startMin >= 630, 'content placed after the showing, in the big gap');
});

test('content block honors the preferred start when it is free', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'content', kind: 'content.block', contactId: null, durationMin: 90, score: 99 })],
    [{ start: 600, end: 630 }],
    WINDOW,
    { contentPreferredMin: 14 * 60 },
  );
  assert.equal(placed.find((p) => p.id === 'content').startMin, 14 * 60);
});

test('content block falls back to the largest gap when the preferred start is taken', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'content', kind: 'content.block', contactId: null, durationMin: 90, score: 99 })],
    [{ start: 600, end: 720 }], // 10:00–12:00 busy
    WINDOW,
    { contentPreferredMin: 10 * 60 },
  );
  assert.equal(placed.find((p) => p.id === 'content').startMin, 12 * 60);
});

test('no double-contact on the same channel', () => {
  const { placed, overflow } = placeCandidates(
    [
      cand({ id: 'a', kind: 'respond.text', contactId: 'dup', score: 90 }),
      cand({ id: 'b', kind: 'anniversary.text', contactId: 'dup', score: 80 }),
    ],
    [], WINDOW,
  );
  assert.equal(placed.filter((p) => p.contactId === 'dup').length, 1, 'only one text move for the contact');
  assert.ok(overflow.some((o) => o.id === 'b' && o.reason === 'double_contact_same_channel'));
});

test('a call and a text for the same person are both allowed', () => {
  const { placed } = placeCandidates(
    [
      cand({ id: 'a', kind: 'respond.text', contactId: 'p', score: 90 }),
      cand({ id: 'b', kind: 'listing.match.call', contactId: 'p', score: 80 }),
    ],
    [], WINDOW,
  );
  assert.equal(placed.length, 2);
});

test('calls are biased before noon when a morning slot exists', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'call', kind: 'listing.match.call', contactId: 'x', durationMin: 15, score: 95 })],
    [], WINDOW,
  );
  const call = placed.find((p) => p.id === 'call');
  assert.ok(call.startMin < 12 * 60, `call before noon (got ${minutesToHHMM(call.startMin)})`);
});

test('lunch slides to after an appointment that covers the lunch window', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'lunch', kind: 'personal.lunch', contactId: null, durationMin: 45, score: 35 })],
    [{ start: 12 * 60, end: 13 * 60 }], // noon–1pm showing covers lunch window
    { start: 9 * 60, end: 18 * 60 },
  );
  const lunch = placed.find((p) => p.id === 'lunch');
  assert.ok(lunch, 'lunch still placed');
  assert.ok(lunch.startMin >= 13 * 60, `lunch moved after the showing (got ${lunch.startMin})`);
  assert.equal(lunch.movedForAppt, true);
});

test('lunch is dropped only when nothing fits after the appointment', () => {
  const { placed, overflow } = placeCandidates(
    [cand({ id: 'lunch', kind: 'personal.lunch', contactId: null, durationMin: 45, score: 35 })],
    [{ start: 12 * 60, end: 13 * 60 }],
    { start: 9 * 60, end: 13 * 60 + 30 }, // workday ends 30 min after it
  );
  assert.ok(!placed.some((p) => p.id === 'lunch'), 'lunch not placed');
  assert.ok(overflow.some((o) => o.id === 'lunch' && o.reason === 'lunch_window_covered_by_appt'));
});

test('the daily move cap overflows extras', () => {
  const many = Array.from({ length: 20 }, (_, i) => cand({ id: `t${i}`, contactId: `c${i}`, durationMin: 15, score: 50 - i }));
  const { placed, overflow } = placeCandidates(many, [], WINDOW, { maxMoves: 12 });
  assert.equal(placed.length, 12, 'capped at 12 task moves');
  assert.ok(overflow.some((o) => o.reason === 'over_daily_cap'));
  // highest scores win the cap
  assert.ok(placed.some((p) => p.id === 't0'));
  assert.ok(!placed.some((p) => p.id === 't19'));
});

test('default cap is 12 and mandatory blocks do not count toward it', () => {
  const many = Array.from({ length: 15 }, (_, i) => cand({ id: `t${i}`, contactId: `c${i}`, score: 60 - i }));
  many.push(cand({ id: 'content', kind: 'content.block', contactId: null, durationMin: 90, score: 40 }));
  many.push(cand({ id: 'lunch', kind: 'personal.lunch', contactId: null, durationMin: 45, score: 35 }));
  const { placed } = placeCandidates(many, [], { start: 8 * 60, end: 20 * 60 });
  assert.equal(placed.filter((p) => p.kind === 'search.nudge').length, 12);
  assert.ok(placed.some((p) => p.id === 'content'));
  assert.ok(placed.some((p) => p.id === 'lunch'));
});

test('content block warns when no gap is large enough', () => {
  const { placed, overflow, warnings } = placeCandidates(
    [cand({ id: 'content', kind: 'content.block', contactId: null, durationMin: 90, score: 99 })],
    [{ start: 540, end: 1110 }], // 09:00–18:30 busy, only 18:30–19:00 free
    WINDOW,
  );
  assert.ok(!placed.some((p) => p.id === 'content'));
  assert.ok(overflow.some((o) => o.id === 'content' && o.reason === 'no_gap_for_content'));
  assert.ok(warnings.length >= 1);
});

test('no-call-after cap overflows a call when only late slots remain', () => {
  const { placed, overflow } = placeCandidates(
    [cand({ id: 'call', kind: 'listing.match.call', contactId: 'z', durationMin: 15, score: 95 })],
    [{ start: 540, end: 600 }],   // 09:00–10:00 busy, so the only gap starts at 10:00
    WINDOW,
    { noCallAfterMin: 10 * 60 },  // ...but no calls after 10:00
  );
  assert.ok(!placed.some((p) => p.id === 'call'), 'call not placed past the cap');
  assert.ok(overflow.some((o) => o.id === 'call' && o.reason === 'no_slot'));
});

test('no-call-before pushes calls later', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'call', kind: 'lease.expiry.call', contactId: 'z', durationMin: 15, score: 95 })],
    [], WINDOW, { noCallBeforeMin: 10 * 60 + 30 },
  );
  assert.equal(placed[0].startMin, 10 * 60 + 30);
});

test('moves keep a 5-minute buffer and stay on the 15-minute grid', () => {
  const { placed } = placeCandidates(
    [cand({ id: 'a', contactId: 'a', score: 90 }), cand({ id: 'b', contactId: 'b', score: 80 })],
    [], WINDOW,
  );
  const [a, b] = placed;
  assert.equal(a.startMin % 15, 0);
  assert.equal(b.startMin % 15, 0);
  assert.ok(b.startMin >= a.startMin + a.durationMin + 5);
});

test('localMinuteOfDay converts a UTC date to local minutes', () => {
  // 2026-05-25T14:00:00Z → 10:00 in America/New_York (EDT, UTC-4)
  assert.equal(localMinuteOfDay(new Date('2026-05-25T14:00:00Z'), 'America/New_York'), 10 * 60);
});

test('slideLater clears every overlapping range and reports what it passed', () => {
  const r = slideLater(12 * 60, 45, [{ start: 11 * 60 + 30, end: 12 * 60 + 30 }, { start: 12 * 60 + 30, end: 13 * 60 }]);
  assert.equal(r.start, 13 * 60);
  assert.ok(r.after);
});

test('firstFreeSlot finds the first non-overlapping 15-minute step', () => {
  assert.equal(firstFreeSlot({ start: 540, end: 1140 }, 90, [{ start: 540, end: 600 }]), 600);
  assert.equal(firstFreeSlot({ start: 540, end: 640 }, 90, [{ start: 540, end: 600 }]), null);
});

test('lunch never slides past mid-afternoon — it overflows with a warning instead', () => {
  const lunch = { id: 'cand-lunch-block', kind: 'personal.lunch', durationMin: 45, score: 35 };
  const occupied = [
    { start: 12 * 60, end: 13 * 60 + 30, client: true },     // listing presentation
    { start: 14 * 60, end: 15 * 60 + 30, client: true },     // inspection
    { start: 16 * 60, end: 17 * 60 + 15, client: true },     // listing presentation
  ];
  const { placed, overflow, warnings } = placeCandidates([lunch], occupied, { start: 9 * 60, end: 18 * 60 }, {
    lunchWindow: { start: 12 * 60 + 30, end: 14 * 60 + 15 },
  });
  assert.equal(placed.find((p) => p.kind === 'personal.lunch'), undefined);
  assert.equal(overflow[0].reason, 'lunch_window_covered_by_appt');
  assert.ok(warnings.some((w) => /lunch/i.test(w)));
});

// Run: node --test src/services/battlePlan/copy.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scrub, fallbackCopy, fallbackSummary } = require('./copy');
const { classifyCoachDeterministic, candidateSuppressed } = require('./index');

test('blacklist scrub replaces every platitude and leaves grounded copy alone', () => {
  const platitudes = [
    'This is a great opportunity', 'A high-value client', 'An important next step', 'Hot lead!',
    'Strong fit for our listings', 'Worth reaching out today', 'Circle back with her', 'Touch base about the CMA',
  ];
  for (const p of platitudes) assert.equal(scrub(p, 'FALLBACK'), 'FALLBACK', p);
  const grounded = 'Asked “is the dock deep-water?” 2h ago — answer before the 3 PM showing.';
  assert.equal(scrub(grounded, 'FALLBACK'), grounded);
});

test('every catalogue kind has deterministic copy within length limits', () => {
  const kinds = ['respond.text', 'listing.match.call', 'listing.match.send', 'offmarket.match.call', 'lease.expiry.call',
    'equity.milestone.call', 'anniversary.text', 'birthday.text', 'search.nudge', 'deal.unstick', 'showing.feedback',
    'soi.checkin.text', 'content.block', 'personal.lunch'];
  for (const kind of kinds) {
    const c = fallbackCopy({ kind, durationMin: 15, signal: { summary: 'x' }, ctx: { first: 'Alexandra', name: 'Alexandra Whitfield-Montgomery', preview: 'Is the seller open to a leaseback through June?', matchScore: 97, listingLabel: '1200 S Ocean Blvd', listingPrice: 18500000, daysUntil: 12, dateLabel: 'Wed, Oct 14', years: 3, address: '41 Star Island Dr', stageLabel: 'Touring', stageDays: 14, searchName: 'Palm Beach waterfront', searchDays: 30, silenceDays: 120 } });
    assert.ok(c.title && c.title.length <= 50, `${kind} title ≤ 50: ${c.title}`);
    assert.ok(!c.sub || c.sub.length <= 80, `${kind} sub ≤ 80`);
    assert.ok(c.why && c.why.length <= 220, `${kind} why ≤ 220`);
  }
});

test('fallback summary names the top move and mutes on an off day', () => {
  const s = fallbackSummary([{ title: 'Call Elena — 97% match', why: 'A new listing scores 97.', score: 80, channel: 'call' }]);
  assert.ok(s.summary.length <= 90);
  assert.match(s.narrative, /Call Elena/);
  assert.match(fallbackSummary([], { offDay: true }).summary, /off/i);
});

test('coach fallback classifier: timeframes defer, hard stops never show, instructions are "other"', () => {
  assert.deepEqual(classifyCoachDeterministic('Hold off until next week').durationDays, 7);
  assert.equal(classifyCoachDeterministic('give her 2 weeks, she is traveling').durationDays, 14);
  assert.equal(classifyCoachDeterministic('they listed with another agent').action, 'dont_show');
  assert.equal(classifyCoachDeterministic('book him Friday at 2 for a second showing').action, 'other');
  assert.equal(classifyCoachDeterministic('hmm not sure'), null); // → route applies the 30-day fallback mute
});

test('suppression matcher: full mute, scoped by kind, never mandatory blocks', () => {
  const now = [{ clientId: 'a', signalKind: null, sourceKind: null }];
  assert.equal(candidateSuppressed({ kind: 'respond.text', contactId: 'a', signal: {} }, now), true);
  assert.equal(candidateSuppressed({ kind: 'respond.text', contactId: 'b', signal: {} }, now), false);
  const scoped = [{ clientId: 'a', signalKind: 'birthday.text', sourceKind: null }];
  assert.equal(candidateSuppressed({ kind: 'birthday.text', contactId: 'a', signal: {} }, scoped), true);
  assert.equal(candidateSuppressed({ kind: 'respond.text', contactId: 'a', signal: {} }, scoped), false);
  assert.equal(candidateSuppressed({ kind: 'content.block', contactId: null, signal: {} }, [{ clientId: null, signalKind: 'content.block' }]), false);
});

test('AI copy pass (stubbed model): only known ids, once each; platitudes and overlong copy fall back', async () => {
  const ai = require('../../ai/claude');
  const prisma = require('../../lib/prisma');
  const { writeCopyWithAI } = require('./copy');
  const saved = { available: ai.available, json: ai.json, find: prisma.aiFeedback && prisma.aiFeedback.findMany };
  let seenPrompt = null;
  ai.available = () => true;
  ai.json = async ({ system, prompt }) => {
    seenPrompt = { system, prompt };
    return {
      summary: 'Two calls before noon — Elena first.',
      narrative: 'Start with Elena: 1200 S Ocean scores 96 against her search.',
      items: [
        { id: 'm1', title: 'Call Elena — great opportunity at 1200 S Ocean', sub: '$18.5M · 6 bd', why: '1200 S Ocean scores 96 against her Estate Section search.', tone: 'warm' },
        { id: 'zzz', title: 'Injected move', why: 'not in the plan' },
        { id: 'm1', title: 'Duplicate', why: 'second copy of m1' },
        { id: 'm2', title: 'x'.repeat(90), why: 'Lease at 330 Sunset ends Nov 12.', tone: 'urgent' },
      ],
    };
  };
  if (prisma.aiFeedback) prisma.aiFeedback.findMany = async () => [{ isCorrect: false, feedback: 'Already handled — stop pitching Grace' }];
  try {
    const fb1 = { title: 'Call Elena — 96% match', sub: 'Palm Beach', why: 'Strong match.', tone: 'warm' };
    const fb2 = { title: 'Call Sofia — lease ends Nov 12', sub: null, why: 'Lease ending.', tone: 'urgent' };
    const out = await writeCopyWithAI({
      workspaceId: 'ws-test', date: '2026-10-02', tz: 'America/New_York',
      moves: [
        { id: 'm1', kind: 'listing.match.call', channel: 'call', startMin: 600, durationMin: 15, ctx: { name: 'Elena Vasquez' }, fallback: fb1 },
        { id: 'm2', kind: 'lease.expiry.call', channel: 'call', startMin: 630, durationMin: 15, ctx: { name: 'Sofia Laurent' }, fallback: fb2 },
      ],
    });
    assert.ok(out);
    assert.deepEqual([...out.items.keys()].sort(), ['m1', 'm2']);
    assert.equal(out.items.get('m1').title, fb1.title, 'platitude title falls back to the deterministic one');
    assert.ok(out.items.get('m1').why.includes('96'));
    assert.ok(out.items.get('m2').title.length <= 50);
    assert.match(seenPrompt.system, /Fair Housing/);
    assert.match(seenPrompt.prompt, /REP FEEDBACK/);
    // A model failure degrades to "no rewrite" (deterministic copy stays).
    ai.json = async () => { throw new Error('overloaded'); };
    const warn = console.warn; console.warn = () => {};
    const none = await writeCopyWithAI({ workspaceId: 'ws-test', date: '2026-10-02', tz: 'UTC', moves: [{ id: 'm1', kind: 'x', fallback: fb1, ctx: {} }] });
    console.warn = warn;
    assert.equal(none, null);
  } finally {
    ai.available = saved.available; ai.json = saved.json;
    if (prisma.aiFeedback && saved.find) prisma.aiFeedback.findMany = saved.find;
  }
});

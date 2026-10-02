// Run: node --test src/services/battlePlan/scorer.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scoreCandidate, scoreAll, normalizeImpact, tagMultiplier, silenceDecay } = require('./scorer');
const { propertyPriority, tierFor } = require('./priority');

const NOW = Date.parse('2026-10-02T15:00:00Z');
const bundles = (entries) => ({ bundles: new Map(entries) });

test('standing blocks score their fixed bonus', () => {
  assert.equal(scoreCandidate({ kind: 'content.block' }), 40);
  assert.equal(scoreCandidate({ kind: 'personal.lunch' }), 35);
});

test('birthday text for a 4★ (vip) contact with no silence → 15 × 1.05 = 16', () => {
  const ctx = bundles([['c', { tags: ['vip'], silenceDays: 2 }]]);
  assert.equal(scoreCandidate({ kind: 'birthday.text', contactId: 'c' }, ctx), 16);
});

test('respond.text for a whale+vip, touring, asked 10h ago, property priority 80 → 59', () => {
  // 0 impact + 0 match + 24 tier + 6 recency + 12 conversation + 5 stage = 47 × 1.26 = 59.2
  const ctx = bundles([['c', {
    tags: ['whale', 'vip'], dealStage: 'touring', propertyPriority: 80,
    lastInboundAt: new Date(NOW - 10 * 3600e3).toISOString(), silenceDays: 0,
  }]]);
  assert.equal(scoreCandidate({ kind: 'respond.text', contactId: 'c', nowMs: NOW }, ctx), 59);
});

test('lease.expiry.call for a 4★ with property priority 34 and 20 days of silence → 23', () => {
  // (10 tier + 18 lifecycle) × 1.05 = 29.4 − 6 decay = 23.4
  const ctx = bundles([['c', { tags: ['vip'], propertyPriority: 34, silenceDays: 20 }]]);
  assert.equal(scoreCandidate({ kind: 'lease.expiry.call', contactId: 'c' }, ctx), 23);
});

test('a 96% match on a $250K-GCI deal for a trophy whale caps at 100', () => {
  const ctx = bundles([['c', { tags: ['whale', 'vip'], propertyPriority: 97, silenceDays: 1 }]]);
  const s = scoreCandidate({ kind: 'listing.match.call', contactId: 'c', matchScore: 96, impactDollars: 250000 }, ctx);
  assert.equal(s, 100);
});

test('off-market pairings get +10 on top of the match boost', () => {
  const plain = scoreCandidate({ kind: 'listing.match.send', matchScore: 90 });
  const off = scoreCandidate({ kind: 'offmarket.match.call', matchScore: 90 });
  assert.equal(plain, 30);   // min(30, 36)
  assert.equal(off, 40);
});

test('impact is linear to $250K expected GCI and capped at 60', () => {
  assert.equal(normalizeImpact(0), 0);
  assert.equal(normalizeImpact(125000), 30);
  assert.equal(normalizeImpact(250000), 60);
  assert.equal(normalizeImpact(9_000_000), 60);
});

test('tag multiplier and silence decay', () => {
  assert.equal(tagMultiplier({ tags: ['whale'] }), 1.2);
  assert.ok(Math.abs(tagMultiplier({ tags: ['whale', 'repeat', 'vip'] }) - 1.386) < 1e-9);
  assert.equal(silenceDecay({ silenceDays: 14 }), 0);
  assert.equal(silenceDecay({ silenceDays: 20 }), 6);
  assert.equal(silenceDecay({ silenceDays: 90 }), 20);
});

test('do-not-disturb notes zero the score', () => {
  const ctx = bundles([['c', { noteHighlights: ['Please do not contact before closing'], tags: ['whale'] }]]);
  assert.equal(scoreCandidate({ kind: 'respond.text', contactId: 'c' }, ctx), 0);
});

test('scores never go below 0 or above 100', () => {
  const ctx = bundles([['c', { silenceDays: 200 }]]);
  assert.equal(scoreCandidate({ kind: 'soi.checkin.text', contactId: 'c' }, ctx), 0);
});

test('scoreAll sorts best first', () => {
  const out = scoreAll([{ kind: 'personal.lunch' }, { kind: 'content.block' }, { kind: 'search.nudge' }], {});
  assert.deepEqual(out.map((c) => c.kind), ['content.block', 'personal.lunch', 'search.nudge']);
});

test('property priority ladder: bands never overlap', () => {
  assert.equal(tierFor(25_000_000), 'TROPHY');
  assert.equal(tierFor(6_000_000), 'LUXURY');
  assert.equal(tierFor(900_000), 'CORE');
  assert.equal(propertyPriority(null), null);
  // best ESTATE (62+16) still below worst TROPHY (80 + 20×0.28)
  assert.ok(propertyPriority(19_000_000, 'oceanfront') < propertyPriority(21_000_000, ''));
  assert.equal(propertyPriority(30_000_000, 'Oceanfront estate'), 100);
  assert.equal(propertyPriority(3_000_000, ''), Math.round(28 + 14 * 0.28));
});

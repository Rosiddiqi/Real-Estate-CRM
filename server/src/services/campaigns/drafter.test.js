// node --test src/services/campaigns/drafter.test.js
// The no-AI fallback: personalized, never echoes instructions, never invents.
const test = require('node:test');
const assert = require('node:assert');
const { briefExtras, fallbackText } = require('./drafter');

const agent = { firstName: 'Olivia', brokerage: 'Hart Luxury Group', tz: 'America/New_York' };
const client = { id: 'c1', firstName: 'Lucas', lastName: 'Moreau' };
const event = { enabled: true, startAt: '2026-10-04T17:00:00.000Z', endAt: '2026-10-04T20:00:00.000Z', address: '2741 Fairway Isle Drive', rsvp: true };

test('briefExtras keeps copy, drops instructions and style notes', () => {
  assert.strictEqual(briefExtras('Invite them to my open house. Light bites and a private walkthrough, bring a friend. Ask them to reply.'), 'Light bites and a private walkthrough, bring a friend.');
  assert.strictEqual(briefExtras('Mention the new price and the loggia; ask them to reply YES.'), '');
  assert.strictEqual(briefExtras('Keep it short. No exclamation points. Warm and personal, no business talk at all.'), '');
  assert.strictEqual(briefExtras('Let them know I just listed it. The terrace faces the bay.'), 'The terrace faces the bay.');
});

test('open house fallback adds no details the brief did not give', () => {
  const campaign = { trigger: 'open_house_invite', brief: 'Invite buyers to the open house. Mention the new price.' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const t = fallbackText({ campaign, client, kind: 'initial_send', event, agent, tier: 'existing', attempt });
    assert.match(t, /^(Hi )?Lucas/);
    assert.match(t, /2741 Fairway Isle Drive/);
    assert.doesNotMatch(t, /light bites|bring a friend|mention|invite buyers/i);
  }
});

test('cold contacts get an intro; the agent’s own copy survives', () => {
  const campaign = { trigger: 'open_house_invite', brief: 'Invite them to my open house. Light bites and a private walkthrough, bring a friend.' };
  const t = fallbackText({ campaign, client, kind: 'initial_send', event, agent, tier: 'cold', attempt: 0 });
  assert.match(t, /it’s Olivia with Hart Luxury Group/);
  assert.match(t, /Light bites and a private walkthrough, bring a friend\./);
});

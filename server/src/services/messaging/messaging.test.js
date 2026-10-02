// node --test src/services/messaging
const test = require('node:test');
const assert = require('node:assert/strict');

const { decideDeviceMode, resolveSendService, REASONS } = require('./routing');
const { planDelivery, seededRand } = require('./providers/demo');
const { nextStatus, RANK } = require('./status');
const { dedupeDecision } = require('./ingest');
const { previewFor, handleVariants, isShortCode, normService } = require('./util');
const { detectIntent } = require('./intent');
const { fallbackSuggestions } = require('./ai');
const { isPrivateIp } = require('./linkPreview');

// ── device routing ────────────────────────────────────────────────────────
test('routing: iPhone proof flips an unknown client to iMessage', () => {
  assert.deepEqual(decideDeviceMode({ mode: null }, 'inbound_imessage'), { mode: 'imessage', reason: REASONS.inbound_imessage });
  assert.equal(decideDeviceMode({ mode: 'imessage', reason: REASONS.inbound_imessage }, 'imessage_read'), null, 'no-op when already blue');
});

test('routing: Android proof flips to SMS, but one green inbound never demotes an iPhone', () => {
  assert.equal(decideDeviceMode({ mode: null }, 'inbound_sms').mode, 'sms');
  assert.equal(decideDeviceMode({ mode: 'imessage', reason: REASONS.inbound_imessage }, 'inbound_sms'), null);
  assert.equal(decideDeviceMode({ mode: 'imessage', reason: REASONS.inbound_imessage }, 'imessage_failed').mode, 'sms', 'a rejected iMessage is hard proof');
  assert.equal(decideDeviceMode({ mode: 'sms', reason: REASONS.inbound_sms }, 'imessage_delivered').mode, 'imessage', 'delivered iMessage beats old SMS evidence');
});

test('routing: explicit agent choice wins and is idempotent', () => {
  assert.deepEqual(decideDeviceMode({ mode: 'imessage' }, 'explicit_sms'), { mode: 'sms', reason: REASONS.explicit_sms });
  assert.equal(decideDeviceMode({ mode: 'sms', reason: REASONS.explicit_sms }, 'explicit_sms'), null);
  // An explicit SMS choice is overridden only by real iPhone evidence.
  assert.equal(decideDeviceMode({ mode: 'sms', reason: REASONS.explicit_sms }, 'inbound_sms'), null);
});

test('routing: resolveSendService', () => {
  assert.equal(resolveSendService({ deviceMode: 'imessage' }), 'imessage');
  assert.equal(resolveSendService({ requested: 'imessage', deviceMode: 'sms' }), 'sms', 'Android evidence overrides an implicit blue request');
  assert.equal(resolveSendService({ requested: 'imessage', explicit: true, deviceMode: 'sms' }), 'imessage', 'explicit toggle wins');
  assert.equal(resolveSendService({ requested: 'sms', deviceMode: 'imessage' }), 'sms');
  assert.equal(resolveSendService({ channel: 'sms' }), 'sms');
  assert.equal(resolveSendService({}), 'imessage');
  assert.equal(resolveSendService({ deviceMode: 'imessage', capabilities: ['sms'] }), 'sms', 'SMS-only provider');
  assert.equal(resolveSendService({ isGroup: true, channel: 'imessage', deviceMode: 'sms' }), 'imessage', 'groups keep their own channel');
});

// ── demo provider state machine ───────────────────────────────────────────
test('demo: statuses only move forward and land in realistic windows', () => {
  for (let i = 0; i < 300; i++) {
    const plan = planDelivery({ service: i % 2 ? 'imessage' : 'sms', rand: seededRand(`m${i}`) });
    const order = plan.steps.map((s) => s.status);
    assert.equal(order[0], 'sent');
    assert.equal(order[1], 'delivered');
    let prev = -1; let prevAt = -1;
    for (const s of plan.steps) {
      assert.ok(RANK[s.status] > prev, 'monotonic');
      assert.ok(s.at > prevAt, 'strictly later');
      prev = RANK[s.status]; prevAt = s.at;
    }
    const sent = plan.steps[0].at; const delivered = plan.steps[1].at;
    assert.ok(sent >= 350 && sent <= 700, `sent ~0.5s (${sent})`);
    assert.ok(delivered - sent >= 450 && delivered <= 1600, `delivered ~1s (${delivered})`);
    const read = plan.steps.find((s) => s.status === 'read');
    if (read) assert.ok(read.at >= 4000 && read.at <= 20000, `read 4–20s (${read.at})`);
    if (i % 2 === 0) assert.ok(!read, 'SMS never shows Read');
    if (plan.reply) {
      const seen = (read || plan.steps[1]).at;
      assert.ok(plan.reply.typingAt >= seen + 600 && plan.reply.typingAt < plan.reply.at, 'typing bubble shows before the reply');
      assert.ok(plan.reply.at - seen >= 5000 && plan.reply.at - seen <= 16000, 'natural reply delay');
    }
  }
});

test('demo: the plan is deterministic per message (restart-safe) and respects reply switches', () => {
  const a = planDelivery({ rand: seededRand('abc') });
  const b = planDelivery({ rand: seededRand('abc') });
  assert.deepEqual(a, b);
  let replies = 0;
  for (let i = 0; i < 400; i++) {
    assert.equal(planDelivery({ rand: seededRand(`x${i}`), autoReplies: false }).reply, null);
    assert.equal(planDelivery({ rand: seededRand(`x${i}`), replyBudget: 0 }).reply, null);
    if (planDelivery({ rand: seededRand(`x${i}`), source: 'agent' }).reply) replies += 1;
  }
  assert.ok(replies > 200 && replies < 380, `a natural subset of agent texts gets a reply (${replies}/400)`);
});

test('status: forward-only machine', () => {
  assert.equal(nextStatus('sending', 'sent'), 'sent');
  assert.equal(nextStatus('delivered', 'sent'), null, 'never downgrade');
  assert.equal(nextStatus('read', 'delivered'), null);
  assert.equal(nextStatus('sent', 'sent'), null, 'duplicate callback is a no-op');
  assert.equal(nextStatus('sending', 'failed'), 'failed');
  assert.equal(nextStatus('read', 'failed'), null, 'a read message never turns red');
  assert.equal(nextStatus('failed', 'delivered'), 'delivered', 'late delivery heals a failure');
  assert.equal(nextStatus('scheduled', 'cancelled'), 'cancelled');
  assert.equal(nextStatus('sent', 'cancelled'), null);
});

// ── inbound dedupe (provider id replays) ──────────────────────────────────
test('ingest: provider-id dedupe', () => {
  assert.equal(dedupeDecision({ body: 'hi' }, null), 'insert');
  assert.equal(dedupeDecision({ body: 'hi' }, { body: 'hi', attachments: [] }), 'skip', 'exact replay');
  assert.equal(dedupeDecision({ body: 'hi', attachments: [{ url: 'a' }] }, { body: 'hi', attachments: [] }), 'upgrade', 'replay carrying the photo the first copy missed');
  assert.equal(dedupeDecision({ body: 'hi' }, { body: '', attachments: [] }), 'upgrade', 'replay filling an empty body');
  assert.equal(dedupeDecision({ body: '' }, { body: 'hi', attachments: [{ url: 'a' }] }), 'skip', 'never downgrade a stored row');
});

// ── helpers ───────────────────────────────────────────────────────────────
test('util: previews, handles, services', () => {
  assert.equal(previewFor({ body: '  Hello\n there ' }), 'Hello there');
  assert.equal(previewFor({ body: '', attachments: [{ mimeType: 'image/jpeg' }] }), 'Photo');
  assert.equal(previewFor({ body: '', attachments: [{ mimeType: 'image/jpeg' }, { mimeType: 'image/png' }] }), '2 Photos');
  assert.equal(previewFor({ body: '', attachments: [{ mimeType: 'audio/mp4' }] }), 'Audio Message');
  assert.equal(previewFor({ kind: 'listing', body: 'https://x.co/p/1', meta: { listing: { address: '41 Indian Creek' } } }), 'Listing: 41 Indian Creek');
  assert.deepEqual(handleVariants('+1 (305) 555-0142').sort(), ['+13055550142', '13055550142', '3055550142'].sort());
  assert.equal(isShortCode('22395'), true);
  assert.equal(isShortCode('3055550142'), false);
  assert.equal(normService('SMS'), 'sms');
  assert.equal(normService('iMessage'), 'imessage');
  assert.equal(normService('RCS'), 'sms');
});

test('intent: real-estate asks become SERENA SUGGESTS candidates', () => {
  assert.equal(detectIntent('Can we see it Saturday?').id, 'showing');
  assert.equal(detectIntent('what is the HOA there').id, 'hoa');
  assert.equal(detectIntent('We want to put in an offer').id, 'offer');
  assert.equal(detectIntent('What would our place be worth?').id, 'valuation');
  assert.equal(detectIntent('see you soon'), null);
  assert.equal(detectIntent('what would my home be worth right now').id, 'valuation');
  assert.equal(detectIntent('thanks so much!'), null);
});

test('ai fallbacks: three reply chips that echo the ask', () => {
  const s = fallbackSuggestions('Can we see it Saturday?', 'Elena');
  assert.equal(s.length, 3);
  assert.match(s[0].text, /Saturday/);
  assert.ok(s.every((x) => x.text.length <= 220));
});

test('link previews: SSRF guard rejects private targets', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.140', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

// ── per-workspace messaging mode + device hand-off ────────────────────────
test('mode: SIMULATE_MESSAGING picks demo for everyone / nobody', async () => {
  const { messagingModeFor, simulateSetting, canAutoSend, assertCanAutoSend } = require('./mode');
  const prev = { sim: process.env.SIMULATE_MESSAGING, env: process.env.NODE_ENV };
  try {
    process.env.SIMULATE_MESSAGING = 'all';
    assert.equal(await messagingModeFor('ws-any'), 'demo');
    assert.equal(await canAutoSend('ws-any'), true);
    process.env.SIMULATE_MESSAGING = 'none';
    assert.equal(await messagingModeFor('ws-any'), 'device', 'no Twilio + not simulated → the agent’s phone');
    assert.equal(await canAutoSend('ws-any'), false);
    await assert.rejects(assertCanAutoSend('ws-any'), (err) => err.status === 409 && err.code === 'device_mode' && /Twilio/.test(err.message));
    delete process.env.SIMULATE_MESSAGING;
    process.env.NODE_ENV = 'production';
    assert.equal(simulateSetting(), 'demo');
    process.env.NODE_ENV = 'development';
    assert.equal(simulateSetting(), 'all');
  } finally {
    if (prev.sim === undefined) delete process.env.SIMULATE_MESSAGING; else process.env.SIMULATE_MESSAGING = prev.sim;
    if (prev.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.env;
  }
});

test('device hand-off: iOS sms: URLs for 1:1 and group threads', () => {
  const { smsHandoffUrl } = require('./send');
  assert.equal(smsHandoffUrl({ handle: '3055550142' }, 'Saturday at 11?'), 'sms:+13055550142&body=Saturday%20at%2011%3F');
  assert.equal(
    smsHandoffUrl({ isGroup: true, participants: [{ handle: '3055550142' }, { handle: '7865550101' }] }, 'Hi all'),
    'sms:/open?addresses=+13055550142,+17865550101&body=Hi%20all',
  );
});

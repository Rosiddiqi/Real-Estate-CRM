// node --test src/services/campaigns/mode.test.js
// The messaging-mode gate: 'device' (no business texting line) blocks every
// automated send; anything else (or no messagingModeFor yet) reads as 'demo'.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Stub services/messaging so the test needs no database.
const messagingPath = path.join(__dirname, '..', 'messaging', 'index.js');
const stub = {};
require.cache[messagingPath] = { id: messagingPath, filename: messagingPath, loaded: true, exports: stub };
const mode = require('./mode');

test('no messagingModeFor yet → demo, sending allowed', async () => {
  delete stub.messagingModeFor;
  assert.strictEqual(await mode.messagingMode('ws-a', { fresh: true }), 'demo');
  await assert.doesNotReject(mode.assertCanSend('ws-a'));
});

test('device mode → refused with 409 and code needs_texting_line', async () => {
  stub.messagingModeFor = async () => 'device';
  assert.strictEqual(await mode.isDeviceMode('ws-b', { fresh: true }), true);
  await assert.rejects(mode.assertCanSend('ws-b'), (err) => err.status === 409 && err.details.code === 'needs_texting_line');
  assert.ok(mode.cachedDeviceWorkspaces().includes('ws-b'));
});

test('twilio mode sends; a throwing lookup keeps the last known mode', async () => {
  stub.messagingModeFor = async () => 'twilio';
  assert.strictEqual(await mode.messagingMode('ws-c', { fresh: true }), 'twilio');
  stub.messagingModeFor = async () => { throw new Error('db down'); };
  const prevError = console.error; console.error = () => {};
  try { assert.strictEqual(await mode.messagingMode('ws-c', { fresh: true }), 'twilio'); } finally { console.error = prevError; }
});

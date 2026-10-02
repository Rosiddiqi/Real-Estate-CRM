// CALL_SIMULATOR policy: who gets the simulated phone line when Twilio isn't set up.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../config');
const { simulatorPolicy } = require('./mode');

function withEnv(value, fn) {
  const prev = process.env.CALL_SIMULATOR;
  if (value === undefined) delete process.env.CALL_SIMULATOR; else process.env.CALL_SIMULATOR = value;
  try { return fn(); } finally { if (prev === undefined) delete process.env.CALL_SIMULATOR; else process.env.CALL_SIMULATOR = prev; }
}

test('calls: CALL_SIMULATOR explicit values win', () => {
  assert.equal(withEnv('all', simulatorPolicy), 'all');
  assert.equal(withEnv('demo', simulatorPolicy), 'demo');
  assert.equal(withEnv('off', simulatorPolicy), 'off');
  assert.equal(withEnv('none', simulatorPolicy), 'off');
  assert.equal(withEnv(' ALL ', simulatorPolicy), 'all');
});

test('calls: CALL_SIMULATOR defaults by environment', () => {
  assert.equal(withEnv(undefined, simulatorPolicy), config.isProd ? 'demo' : 'all');
  assert.equal(withEnv('bogus', simulatorPolicy), config.isProd ? 'demo' : 'all');
});

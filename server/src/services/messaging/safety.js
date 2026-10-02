// Send safety — runs before every outbound (agent, campaign, Serena, scheduled).
//  1. KILL_SWITCH env → every send refused (503).
//  2. Per-recipient cooldown (3s) → the dispatch is deferred, never doubled.
//  3. Per-recipient ceiling (30/hour) → refused (429) so a loop can't spam.
//  4. Campaign/AI sends to an opted-out client → refused (409).
// Fire-once everywhere: nothing here ever re-sends on its own.
const config = require('../../config');
const { HttpError } = require('../../lib/http');

const COOLDOWN_MS = 3000;
const HOURLY_MAX = 30;
const sendLog = new Map(); // `${workspaceId}:${handle}` -> number[] (epoch ms)

function key(workspaceId, handle) { return `${workspaceId}:${handle}`; }

function recent(workspaceId, handle, now = Date.now()) {
  const k = key(workspaceId, handle);
  const arr = (sendLog.get(k) || []).filter((t) => now - t < 3600_000);
  sendLog.set(k, arr);
  return arr;
}

// Throws on refusal; returns { delayMs } (0 = dispatch now).
function check({ workspaceId, handle, source = 'agent', client, now = Date.now() }) {
  if (config.messaging.killSwitch) throw new HttpError(503, 'Sending is paused (kill switch is on)');
  if (client && client.textOptOut && source !== 'agent') {
    throw new HttpError(409, `${client.firstName || 'This client'} opted out of automated texts`);
  }
  const arr = recent(workspaceId, handle, now);
  if (arr.length >= HOURLY_MAX) throw new HttpError(429, 'Held by send safety — too many texts to this number in the last hour');
  const last = arr.length ? arr[arr.length - 1] : 0;
  const delayMs = last && now - last < COOLDOWN_MS ? COOLDOWN_MS - (now - last) : 0;
  return { delayMs };
}

function record(workspaceId, handle, at = Date.now()) {
  const arr = recent(workspaceId, handle, at);
  arr.push(at);
  sendLog.set(key(workspaceId, handle), arr);
}

function _reset() { sendLog.clear(); }

module.exports = { check, record, COOLDOWN_MS, HOURLY_MAX, _reset };

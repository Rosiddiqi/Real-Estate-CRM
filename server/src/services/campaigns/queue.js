// Recipient action queue — every CampaignRecipient carries its own small,
// time-ordered queue of pending actions in meta.queue, and nextSendAt mirrors
// the earliest one. Postgres is the queue, so pacing and follow-ups survive
// restarts by construction.
//   item = { id, kind, at (ISO), step?, lane?, payload? }
const crypto = require('node:crypto');

const qid = () => crypto.randomBytes(6).toString('hex');

function metaOf(row) { return row && row.meta && typeof row.meta === 'object' ? row.meta : {}; }
// hint.automation: the caller knows the row belongs to an automation (only
// matters for rows without a stored queue, see legacyQueue).
function queueOf(row, hint = {}) {
  const q = metaOf(row).queue;
  if (Array.isArray(q)) return q.filter((i) => i && i.kind && i.at);
  return legacyQueue(row, hint);
}

// Rows written without a queue (the demo seed, older builds) carry only
// nextSendAt: read it as one item so they still go out on time. The id is
// derived from the row so every reader sees the same item; the first write
// through withQueue() stores it for good.
function legacyQueue(row, hint = {}) {
  if (!row || !row.nextSendAt) return [];
  const at = new Date(row.nextSendAt);
  if (Number.isNaN(at.getTime())) return [];
  const auto = hint.automation != null ? !!hint.automation : !!(row.campaign && row.campaign.kind === 'automation');
  const followUp = row.lane && !['none', 'red'].includes(row.lane);
  const kind = !row.lastSentAt ? (auto ? 'auto_step' : 'initial_send') : (followUp ? 'lane_step' : 'gray_check');
  return [{
    id: `legacy${String(row.id || '').replace(/-/g, '').slice(0, 10)}`,
    kind,
    at: at.toISOString(),
    ...(kind === 'lane_step' ? { step: row.stepIndex || 0, lane: row.lane } : {}),
  }];
}

function sortQueue(q) { return [...q].sort((a, b) => new Date(a.at) - new Date(b.at)); }

function nextAtOf(q) {
  const s = sortQueue(q);
  return s.length ? new Date(s[0].at) : null;
}

function item(kind, at, extra = {}) {
  return { id: qid(), kind, at: new Date(at).toISOString(), ...extra };
}

// Build the {meta, nextSendAt} patch for a new queue.
function withQueue(meta, q) {
  const sorted = sortQueue(q);
  return { meta: { ...(meta || {}), queue: sorted }, nextSendAt: sorted.length ? new Date(sorted[0].at) : null };
}

function dueItem(row, now = new Date()) {
  const s = sortQueue(queueOf(row));
  return s.find((i) => new Date(i.at).getTime() <= now.getTime()) || null;
}

function without(q, pred) { return q.filter((i) => !pred(i)); }

module.exports = { qid, metaOf, queueOf, sortQueue, nextAtOf, item, withQueue, dueItem, without };

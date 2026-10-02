// Recipient action queue — every CampaignRecipient carries its own small,
// time-ordered queue of pending actions in meta.queue, and nextSendAt mirrors
// the earliest one. Postgres is the queue, so pacing and follow-ups survive
// restarts by construction.
//   item = { id, kind, at (ISO), step?, lane?, payload? }
const crypto = require('node:crypto');

const qid = () => crypto.randomBytes(6).toString('hex');

function metaOf(row) { return row && row.meta && typeof row.meta === 'object' ? row.meta : {}; }
function queueOf(row) { const q = metaOf(row).queue; return Array.isArray(q) ? q.filter((i) => i && i.kind && i.at) : []; }

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

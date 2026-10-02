// In-process messaging bus — lets other features react to messaging without
// importing the inbox internals (campaign reply lanes, Serena memory, etc.).
//
//   const messagingEvents = require('../messaging/events');
//   messagingEvents.on('inbound',  async ({ workspaceId, message, conversation, client }) => {...});
//   messagingEvents.on('outbound', async ({ workspaceId, message, conversation, client, source }) => {...});
//   messagingEvents.on('status',   async ({ workspaceId, message, conversation, status }) => {...});
//
// Listeners run async (after the triggering request has been answered) and are
// isolated: one throwing never affects another or the send/ingest pipeline.
const listeners = new Map(); // name -> Set<fn>

function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => off(name, fn);
}

function off(name, fn) {
  const set = listeners.get(name);
  if (set) set.delete(fn);
}

function emit(name, payload) {
  const set = listeners.get(name);
  if (!set || !set.size) return;
  setImmediate(() => {
    for (const fn of [...set]) {
      Promise.resolve()
        .then(() => fn(payload))
        .catch((err) => console.error(`[messaging] "${name}" listener failed:`, err && err.message ? err.message : err));
    }
  });
}

module.exports = { on, off, emit };

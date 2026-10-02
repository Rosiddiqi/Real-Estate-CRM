// logActivity — the ONE writer for the client activity timeline. Broadcasts
// `activity_created` so open client cards repaint live.
const prisma = require('./prisma');
const hub = require('../realtime/hub');

async function logActivity({ workspaceId, clientId = null, dealId = null, listingId = null, type, title, body = null, meta = null, actor = 'system', occurredAt = new Date() }) {
  try {
    const row = await prisma.activity.create({
      data: { workspaceId, clientId, dealId, listingId, type, title, body, meta, actor, occurredAt },
    });
    hub.broadcast(workspaceId, 'activity_created', row);
    return row;
  } catch (err) {
    console.error('[activity] failed to log', type, err.message);
    return null;
  }
}

module.exports = { logActivity };

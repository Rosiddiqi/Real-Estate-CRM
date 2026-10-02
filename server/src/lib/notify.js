// notify — create an in-app notification and push it live to open clients.
const prisma = require('./prisma');
const hub = require('../realtime/hub');

async function notify({ workspaceId, userId = null, type, title, body = null, data = null }) {
  try {
    const row = await prisma.notification.create({ data: { workspaceId, userId, type, title, body, data } });
    hub.broadcast(workspaceId, 'notification', row);
    return row;
  } catch (err) {
    console.error('[notify] failed', type, err.message);
    return null;
  }
}

module.exports = { notify };

// Client identity helpers shared by inbox, calls, campaigns and AI tools.
const prisma = require('./prisma');
const { normalizePhone } = require('./phone');

function clientName(c) {
  if (!c) return '';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || c.phone || 'Unknown';
}

async function findClientByHandle(workspaceId, handle) {
  if (!handle) return null;
  const h = String(handle).trim();
  if (h.includes('@')) {
    return prisma.client.findFirst({ where: { workspaceId, OR: [{ email: { equals: h, mode: 'insensitive' } }, { emailAlt: { equals: h, mode: 'insensitive' } }] } });
  }
  const n = normalizePhone(h);
  if (!n) return null;
  return prisma.client.findFirst({ where: { workspaceId, OR: [{ phone: n }, { phoneAlt: n }] } });
}

module.exports = { clientName, findClientByHandle };

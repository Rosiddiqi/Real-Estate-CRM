// Global search (Spotlight-style): clients, listings, deals, threads.
const express = require('express');
const prisma = require('../lib/prisma');
const { ah } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const take = Math.min(20, parseInt(req.query.limit, 10) || 6);
  if (q.length < 2) return res.json({ clients: [], listings: [], deals: [], conversations: [] });
  const wid = req.workspaceId;
  const ci = { contains: q, mode: 'insensitive' };
  const digits = normalizePhone(q);
  const words = q.split(/\s+/).filter(Boolean);
  const nameAnd = words.length > 1 ? [{ AND: [{ firstName: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' } }] }] : [];

  const [clients, listings, deals, conversations] = await Promise.all([
    prisma.client.findMany({
      where: {
        workspaceId: wid, archivedAt: null,
        OR: [{ firstName: ci }, { lastName: ci }, { displayName: ci }, { email: ci }, { company: ci }, { neighborhood: ci },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []), ...nameAnd],
      },
      take, orderBy: [{ isWhale: 'desc' }, { rating: 'desc' }, { lastContactedAt: 'desc' }],
    }),
    prisma.listing.findMany({
      where: {
        workspaceId: wid, droppedAt: null,
        OR: [{ street: ci }, { neighborhood: ci }, { buildingName: ci }, { city: ci }, { mlsNumber: ci }, { title: ci }, { developmentName: ci }],
      },
      take, orderBy: { listPrice: 'desc' },
    }),
    prisma.deal.findMany({
      where: {
        workspaceId: wid,
        OR: [{ title: ci }, { propertyAddress: ci }, { propertyLabel: ci }, { client: { OR: [{ firstName: ci }, { lastName: ci }] } }],
      },
      include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
      take, orderBy: { updatedAt: 'desc' },
    }),
    prisma.conversation.findMany({
      where: {
        workspaceId: wid,
        OR: [{ displayName: ci }, { handle: { contains: digits || q } }, { messages: { some: { body: ci } } }],
      },
      take, orderBy: { lastMessageAt: 'desc' },
    }),
  ]);
  res.json({ clients, listings, deals, conversations });
}));

module.exports = router;

// In-app notifications (the bell).
const express = require('express');
const prisma = require('../lib/prisma');
const { ah, paging } = require('../lib/http');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const { take, skip } = paging(req, { defaultLimit: 50 });
  const where = { workspaceId: req.workspaceId, ...(req.query.unread === '1' ? { readAt: null } : {}) };
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.notification.count({ where: { workspaceId: req.workspaceId, readAt: null } }),
  ]);
  res.json({ notifications, unread });
}));

router.post('/read-all', ah(async (req, res) => {
  await prisma.notification.updateMany({ where: { workspaceId: req.workspaceId, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));

router.post('/:id/read', ah(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, workspaceId: req.workspaceId }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));

module.exports = router;

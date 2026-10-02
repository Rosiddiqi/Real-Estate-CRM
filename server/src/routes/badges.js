// Badge counts for the tab bar + drawer (polled every 30s and on live events).
const express = require('express');
const prisma = require('../lib/prisma');
const { ah } = require('../lib/http');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const wid = req.workspaceId;
  const user = await req.getUser();
  const prefs = (user && user.preferences) || {};
  const missedSince = prefs.missedSeenAt ? new Date(prefs.missedSeenAt) : new Date(Date.now() - 24 * 3600e3);
  const [unreadMessages, missedCalls, activeDeals, waitlistWaiting, unreadNotifications] = await Promise.all([
    prisma.conversation.count({ where: { workspaceId: wid, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' } }),
    prisma.phoneCall.count({ where: { workspaceId: wid, direction: 'inbound', status: { in: ['missed', 'no_answer', 'voicemail'] }, startedAt: { gt: missedSince } } }),
    prisma.deal.count({ where: { workspaceId: wid, archivedAt: null, stage: { notIn: ['closed', 'lost'] } } }),
    prisma.waitlistEntry.count({ where: { status: 'waiting', waitlist: { workspaceId: wid } } }),
    prisma.notification.count({ where: { workspaceId: wid, readAt: null } }),
  ]);
  res.json({ unreadMessages, missedCalls, activeDeals, waitlistWaiting, unreadNotifications });
}));

// Mark a badge as seen (e.g. opening the Phone tab clears missed calls).
router.post('/seen', ah(async (req, res) => {
  const kind = String(req.body?.kind || '');
  const user = await req.getUser();
  const prefs = { ...(user.preferences || {}) };
  if (kind === 'calls') prefs.missedSeenAt = new Date().toISOString();
  await prisma.user.update({ where: { id: req.userId }, data: { preferences: prefs } });
  res.json({ ok: true });
}));

module.exports = router;

// The signed-in agent's profile + workspace.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ah, parse, HttpError } = require('../lib/http');
const { publicUser, hashPassword, verifyPassword } = require('../lib/auth');
const ai = require('../ai/claude');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId } }),
    prisma.workspace.findUnique({ where: { id: req.workspaceId } }),
  ]);
  if (!user) throw new HttpError(401, 'Account not found');
  res.json({ user: publicUser(user), workspace, ai: ai.status() });
}));

const PatchBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  licenseNumber: z.string().nullable().optional(),
  preferences: z.record(z.any()).optional(),
  onboarding: z.record(z.any()).optional(),
}).strict();

router.patch('/', ah(async (req, res) => {
  const body = parse(PatchBody, req.body);
  const current = await prisma.user.findUnique({ where: { id: req.userId } });
  const data = { ...body };
  // Preferences / onboarding are merged, never replaced wholesale.
  if (body.preferences) data.preferences = { ...(current.preferences || {}), ...body.preferences };
  if (body.onboarding) data.onboarding = { ...(current.onboarding || {}), ...body.onboarding };
  const user = await prisma.user.update({ where: { id: req.userId }, data });
  res.json({ user: publicUser(user) });
}));

// Assistant name + personality (merged).
router.patch('/ai-preferences', ah(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const allowed = ['aiName', 'aiPersonality', 'aiPersonalityId', 'aiAvatarUrl', 'voiceSamples'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  const current = await prisma.user.findUnique({ where: { id: req.userId } });
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { aiPreferences: { ...(current.aiPreferences || {}), ...patch } },
  });
  res.json({ user: publicUser(user) });
}));

const PasswordBody = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) });

router.post('/password', ah(async (req, res) => {
  const { currentPassword, newPassword } = parse(PasswordBody, req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  await prisma.user.update({ where: { id: req.userId }, data: { passwordHash: await hashPassword(newPassword) } });
  res.json({ ok: true });
}));

module.exports = router;

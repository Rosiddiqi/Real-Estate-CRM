// The signed-in agent's profile + workspace.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ah, parse, HttpError } = require('../lib/http');
const fs = require('node:fs');
const path = require('node:path');
const { Prisma } = require('@prisma/client');
const { publicUser, hashPassword, verifyPassword, clearRefreshCookie } = require('../lib/auth');
const config = require('../config');
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

// ── Account deletion (App Store guideline 5.1.1(v)) ─────────────────────────
// The sole member of a workspace takes the whole workspace (clients, threads,
// deals, uploads…) with them; a teammate in a shared workspace removes only
// their own login. The shared demo account can't be deleted.
const DeleteBody = z.object({ password: z.string().optional() }).passthrough();

router.delete('/', ah(async (req, res) => {
  const { password } = parse(DeleteBody, req.body || {});
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'Account not found');
  const demoEmail = String(process.env.DEMO_EMAIL || 'demo@keymatch.app').toLowerCase();
  if (user.email.toLowerCase() === demoEmail) throw new HttpError(403, 'The shared demo account can’t be deleted');
  if (user.passwordHash && !(await verifyPassword(password || '', user.passwordHash))) {
    throw new HttpError(400, 'Password is incorrect');
  }

  const members = await prisma.user.count({ where: { workspaceId: user.workspaceId } });
  if (members > 1) {
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }); // refresh tokens cascade
  } else {
    await purgeWorkspace(user.workspaceId);
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

// Deletes every row that belongs to the workspace. Most models carry
// workspaceId; a few children hang off them with onDelete: Cascade. Without
// declared relations between many models, delete order is discovered with a
// few passes (a pass that hits a foreign key simply retries the model later).
async function purgeWorkspace(workspaceId) {
  const users = await prisma.user.findMany({ where: { workspaceId }, select: { id: true } });
  const files = await prisma.mediaFile.findMany({ where: { workspaceId }, select: { url: true } });

  const delegates = Prisma.dmmf.datamodel.models
    .filter((m) => m.name !== 'User' && m.fields.some((f) => f.name === 'workspaceId' && f.kind === 'scalar'))
    .map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1))
    .filter((key) => prisma[key] && typeof prisma[key].deleteMany === 'function');

  let pending = delegates;
  for (let pass = 0; pass < 8 && pending.length; pass += 1) {
    const failed = [];
    for (const key of pending) {
      try { await prisma[key].deleteMany({ where: { workspaceId } }); } catch { failed.push(key); }
    }
    pending = failed;
  }
  if (pending.length) throw new HttpError(500, `Could not delete all data (${pending.join(', ')}) — try again`);

  await prisma.pushSubscription.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });

  // Best-effort: remove uploaded files that lived in our uploads dir.
  for (const f of files) {
    const m = /\/uploads\/(.+)$/.exec(f.url || '');
    if (!m) continue;
    const target = path.resolve(config.uploadsDir, m[1]);
    if (!target.startsWith(path.resolve(config.uploadsDir) + path.sep)) continue;
    fs.promises.unlink(target).catch(() => {});
  }
}

module.exports = router;

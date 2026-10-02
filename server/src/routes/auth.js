// Auth: email+password login, registration (creates a workspace), one-tap demo
// login, rotating refresh tokens (httpOnly cookie + body for native shells).
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ah, parse, HttpError } = require('../lib/http');
const {
  REFRESH_COOKIE, hashPassword, verifyPassword, signAccess, issueRefresh,
  setRefreshCookie, clearRefreshCookie, rotateRefresh, revokeRefresh, publicUser,
} = require('../lib/auth');

const router = express.Router();

async function sessionResponse(res, req, user) {
  const accessToken = signAccess(user);
  const { token, expiresAt } = await issueRefresh(user, req);
  setRefreshCookie(res, token, expiresAt);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
  return res.json({ accessToken, refreshToken: token, user: publicUser(user) });
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', ah(async (req, res) => {
  const { email, password } = parse(LoginBody, req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'That email and password don’t match.');
  }
  return sessionResponse(res, req, user);
}));

// One-tap demo access (seeded demo agent). Disable in production with
// DEMO_LOGIN_ENABLED=0.
router.post('/demo', ah(async (req, res) => {
  if (/^(0|false|no|off)$/i.test(process.env.DEMO_LOGIN_ENABLED || '')) throw new HttpError(403, 'Demo login is disabled');
  const email = process.env.DEMO_EMAIL || 'demo@keymatch.app';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(404, 'Demo workspace not seeded yet — run `npm run seed` in /server');
  return sessionResponse(res, req, user);
}));

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters'),
  firstName: z.string().min(1),
  lastName: z.string().optional().default(''),
  phone: z.string().optional(),
  brokerageName: z.string().optional(),
  market: z.string().optional(),
});

router.post('/register', ah(async (req, res) => {
  const body = parse(RegisterBody, req.body);
  const email = body.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new HttpError(409, 'An account with that email already exists.');
  const passwordHash = await hashPassword(body.password);
  const workspace = await prisma.workspace.create({
    data: {
      name: `${body.firstName}'s Book`,
      brokerageName: body.brokerageName || null,
      market: body.market || null,
      timezone: config.timezone,
    },
  });
  const user = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email,
      passwordHash,
      firstName: body.firstName,
      lastName: body.lastName || '',
      phone: body.phone || null,
      role: 'owner',
    },
  });
  try {
    const { bootstrapWorkspace } = require('../services/workspaceBootstrap');
    await bootstrapWorkspace(workspace.id, user.id);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') console.error('[auth] bootstrap failed', err);
  }
  return sessionResponse(res, req, user);
}));

router.post('/refresh', ah(async (req, res) => {
  const raw = (req.cookies && req.cookies[REFRESH_COOKIE]) || (req.body && req.body.refreshToken);
  const rotated = await rotateRefresh(raw, req);
  if (!rotated) {
    clearRefreshCookie(res);
    throw new HttpError(401, 'Session expired');
  }
  setRefreshCookie(res, rotated.refresh.token, rotated.refresh.expiresAt);
  return res.json({
    accessToken: signAccess(rotated.user),
    refreshToken: rotated.refresh.token,
    user: publicUser(rotated.user),
  });
}));

router.post('/logout', ah(async (req, res) => {
  const raw = (req.cookies && req.cookies[REFRESH_COOKIE]) || (req.body && req.body.refreshToken);
  await revokeRefresh(raw);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

module.exports = router;

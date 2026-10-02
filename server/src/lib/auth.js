// Auth primitives: password hashing, short-lived access JWTs, and rotating
// refresh tokens (stored hashed in the RefreshToken table, delivered both as an
// httpOnly cookie for the web app and in the JSON body for native shells).
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('./prisma');

const REFRESH_COOKIE = 'km_rt';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function hashPassword(pw) {
  return bcrypt.hash(String(pw), 10);
}

async function verifyPassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(pw), hash);
}

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, wid: user.workspaceId, role: user.role || 'agent' },
    config.auth.jwtSecret,
    { expiresIn: config.auth.accessTtl },
  );
}

function verifyAccess(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

async function issueRefresh(user, req) {
  const token = `kmr_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + config.auth.refreshTtlDays * 864e5);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: (req && req.get && req.get('user-agent')) ? req.get('user-agent').slice(0, 300) : null,
    },
  });
  return { token, expiresAt };
}

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires: expiresAt,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

// Validate + rotate a refresh token. Returns { user, refresh } or null.
async function rotateRefresh(rawToken, req) {
  if (!rawToken) return null;
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date() || !row.user) return null;
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const refresh = await issueRefresh(row.user, req);
  return { user: row.user, refresh };
}

async function revokeRefresh(rawToken) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Public shape of a user (never leak the hash).
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = {
  REFRESH_COOKIE,
  sha256,
  hashPassword,
  verifyPassword,
  signAccess,
  verifyAccess,
  issueRefresh,
  setRefreshCookie,
  clearRefreshCookie,
  rotateRefresh,
  revokeRefresh,
  publicUser,
};

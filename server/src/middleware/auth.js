// requireAuth — every CRM route uses this. Sets:
//   req.userId, req.workspaceId, req.user (lazy-loaded, cached per request)
// Every query MUST be scoped by req.workspaceId.
const config = require('../config');
const prisma = require('../lib/prisma');
const { verifyAccess } = require('../lib/auth');

let devUserCache = null;

async function resolveDevUser() {
  if (devUserCache) return devUserCache;
  devUserCache = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  return devUserCache;
}

function extractToken(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      try {
        const claims = verifyAccess(token);
        req.userId = claims.sub;
        req.workspaceId = claims.wid;
        req.role = claims.role;
      } catch (e) {
        return res.status(401).json({ error: 'Session expired', code: 'token_expired' });
      }
    } else if (config.auth.devBypass) {
      const u = await resolveDevUser();
      if (!u) return res.status(401).json({ error: 'No users yet — run the seed' });
      req.userId = u.id;
      req.workspaceId = u.workspaceId;
      req.role = u.role;
    } else {
      return res.status(401).json({ error: 'Not signed in', code: 'no_token' });
    }

    let cachedUser;
    req.getUser = async () => {
      if (cachedUser !== undefined) return cachedUser;
      cachedUser = await prisma.user.findUnique({ where: { id: req.userId } });
      return cachedUser;
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, extractToken };

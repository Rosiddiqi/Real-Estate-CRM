// Small HTTP helpers shared by every router.
//
//   router.get('/', ah(async (req, res) => { ... }))   — async errors reach the
//   error handler instead of crashing the process.
//   throw new HttpError(404, 'Client not found')        — typed errors.
//   const { take, skip, page, limit } = paging(req)      — page/limit query params.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function paging(req, { defaultLimit = 50, maxLimit = 500 } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, take: limit, skip: (page - 1) * limit };
}

function notFound(what = 'Resource') {
  return new HttpError(404, `${what} not found`);
}

// Parse a zod schema against req.body (or any object) → 400 on failure.
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg, r.error.issues);
  }
  return r.data;
}

function errorHandler(err, req, res, _next) {
  const status = err.status || (err.code === 'P2025' ? 404 : 500);
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({ error: err.message || 'Server error', ...(err.details ? { details: err.details } : {}) });
}

module.exports = { HttpError, ah, paging, notFound, parse, errorHandler };

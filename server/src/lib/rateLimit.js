// Tiny fixed-window limiter, in memory (one API process). Used to slow down
// password guessing and sign-up abuse on the public auth endpoints.
//
//   const limit = limiter({ windowMs: 15 * 60e3, max: 10 });
//   if (!limit.allowed(key)) throw new HttpError(429, '…');
//   limit.hit(key);  … limit.reset(key) on success
function limiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  const live = (key) => {
    const e = hits.get(key);
    if (!e || e.reset <= Date.now()) { hits.delete(key); return null; }
    return e;
  };
  return {
    allowed(key) { const e = live(key); return !e || e.n < max; },
    hit(key) {
      const e = live(key) || { n: 0, reset: Date.now() + windowMs };
      e.n += 1;
      hits.set(key, e);
      return e;
    },
    reset(key) { hits.delete(key); },
    retryAfterSec(key) { const e = live(key); return e ? Math.ceil((e.reset - Date.now()) / 1000) : 0; },
  };
}

module.exports = { limiter };

// Shared helpers for Serena (and the calls co-pilot): names, money, time
// formatting in the agent's zone, fuzzy client resolution, safe lazy requires.
const prisma = require('../../lib/prisma');
const config = require('../../config');
const { dayKey, addDays } = require('../../lib/dates');
const { normalizePhone, formatPhone } = require('../../lib/phone');

// ── people ─────────────────────────────────────────────────────────────────
function nameOf(c) {
  if (!c) return '';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || (c.phone ? formatPhone(c.phone) : '') || 'Unknown';
}
function firstOf(c) {
  if (!c) return '';
  return c.firstName || String(nameOf(c)).split(' ')[0];
}

// ── money ──────────────────────────────────────────────────────────────────
function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function moneyCompact(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  const trim = (x, d) => { const t = x.toFixed(d); return t.includes('.') ? t.replace(/\.?0+$/, '') : t; };
  if (a >= 1e9) return `${s}$${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${s}$${trim(a / 1e6, 2)}M`;
  if (a >= 1e4) return `${s}$${trim(a / 1e3, 0)}K`;
  if (a >= 1e3) return `${s}$${trim(a / 1e3, 1)}K`;
  return `${s}$${Math.round(a)}`;
}

// ── time in the agent's zone ───────────────────────────────────────────────
async function tzFor(workspaceId, userId) {
  try {
    const [ws, user] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } }),
      userId ? prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }) : null,
    ]);
    return (user && user.timezone) || (ws && ws.timezone) || config.timezone;
  } catch {
    return config.timezone;
  }
}

function fmtTime(d, tz) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}
function fmtDate(d, tz, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { timeZone: tz, ...opts });
}
// "Today · 2:00 PM", "Tomorrow · 9:30 AM", "Fri, Oct 3 · 1:00 PM"
function fmtWhen(d, tz, { withTime = true } = {}) {
  if (!d) return '';
  const date = new Date(d);
  const today = dayKey(new Date(), tz);
  const k = dayKey(date, tz);
  let day;
  if (k === today) day = 'Today';
  else if (k === addDays(today, 1)) day = 'Tomorrow';
  else if (k === addDays(today, -1)) day = 'Yesterday';
  else day = fmtDate(date, tz);
  return withTime ? `${day} · ${fmtTime(date, tz)}` : day;
}
// "Tomorrow", "Fri, Oct 3" for a YYYY-MM-DD key
function fmtDayKey(key, tz) {
  if (!key) return '';
  const today = dayKey(new Date(), tz);
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}
function relAgo(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days}d ago`;
  const w = Math.round(days / 7);
  if (days < 60) return `${w}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}
// Whole days elapsed since `a` (never negative — a future-dated row reads as 0).
function daysBetween(a, b = new Date()) {
  return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 864e5));
}

// ── strings ────────────────────────────────────────────────────────────────
function clip(s, n = 160) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function titleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function addressOf(x) {
  if (!x) return '';
  const street = [x.street, x.unit || x.unitNumber ? `#${x.unit || x.unitNumber}` : null].filter(Boolean).join(' ');
  return street || x.buildingName || x.title || x.neighborhood || x.city || '';
}
function placeOf(x) {
  if (!x) return '';
  return [addressOf(x), x.neighborhood && x.neighborhood !== addressOf(x) ? x.neighborhood : null].filter(Boolean).join(', ');
}

// ── client resolution ──────────────────────────────────────────────────────
const CLIENT_LITE = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true,
  type: true, status: true, rating: true, isWhale: true, contactKind: true, avatarUrl: true,
  lastContactedAt: true, neighborhood: true, city: true, textOptOut: true, deviceMode: true,
};

// Token-AND name search (every word must hit first/last/display/company).
async function searchClientsByName(workspaceId, query, { take = 8, kind } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const digits = normalizePhone(q);
  if (/^\+?[\d\s().-]{7,}$/.test(q) && digits.length >= 7) {
    return prisma.client.findMany({ where: { workspaceId, archivedAt: null, OR: [{ phone: { contains: digits.slice(-10) } }, { phoneAlt: { contains: digits.slice(-10) } }] }, select: CLIENT_LITE, take });
  }
  if (q.includes('@')) {
    return prisma.client.findMany({ where: { workspaceId, archivedAt: null, email: { contains: q, mode: 'insensitive' } }, select: CLIENT_LITE, take });
  }
  const words = q.replace(/['’]s\b/gi, '').split(/\s+/).filter((w) => w.length > 0 && !/^(the|mr|mrs|ms|dr|and|&)$/i.test(w));
  if (!words.length) return [];
  const tokenWhere = (w) => {
    const variants = [w];
    if (/s$/i.test(w) && w.length > 3) variants.push(w.replace(/e?s$/i, ''), w.slice(0, -1)); // "Delacroixs" → "Delacroix"
    return {
      OR: variants.flatMap((v) => [
        { firstName: { contains: v, mode: 'insensitive' } },
        { lastName: { contains: v, mode: 'insensitive' } },
        { displayName: { contains: v, mode: 'insensitive' } },
        { company: { contains: v, mode: 'insensitive' } },
      ]),
    };
  };
  return prisma.client.findMany({
    where: { workspaceId, archivedAt: null, ...(kind ? { contactKind: kind } : {}), AND: words.map(tokenWhere) },
    select: CLIENT_LITE,
    orderBy: [{ isWhale: 'desc' }, { rating: 'desc' }, { lastContactedAt: 'desc' }],
    take,
  });
}

async function getClientLite(workspaceId, id) {
  if (!id) return null;
  return prisma.client.findFirst({ where: { id: String(id), workspaceId }, select: CLIENT_LITE });
}

// Resolve a client from an id OR a name. Throws a helpful error the model can
// act on (ambiguous → candidates; none → ask).
async function resolveClient(workspaceId, { client_id, client_name } = {}) {
  if (client_id) {
    const c = await getClientLite(workspaceId, client_id);
    if (c) return c;
    if (!client_name) throw new Error(`No client with id ${client_id}. Search by name with search_clients first.`);
  }
  if (client_name) {
    const hits = await searchClientsByName(workspaceId, client_name, { take: 6 });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const exact = hits.filter((h) => norm(nameOf(h)) === norm(client_name));
      if (exact.length === 1) return exact[0];
      const err = new Error(`"${client_name}" matches ${hits.length} clients: ${hits.map((h) => `${nameOf(h)} (${h.id})`).join('; ')}. Ask which one.`);
      err.code = 'ambiguous';
      err.candidates = hits;
      throw err;
    }
    const err = new Error(`No client named "${client_name}" in the book.`);
    err.code = 'not_found';
    throw err;
  }
  throw new Error('client_id is required');
}

// ── lazy optional services (other builders) ────────────────────────────────
// Returns the module or null (only when the module is genuinely missing).
function optionalRequire(path) {
  try {
    return require(path);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(path.split('/').pop())) return null;
    console.error(`[serena] failed to load ${path}:`, err.message);
    return null;
  }
}
function fnFrom(mod, ...names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  return null;
}

module.exports = {
  nameOf, firstOf, money, moneyCompact, tzFor, fmtTime, fmtDate, fmtWhen, fmtDayKey, relAgo, daysBetween,
  clip, norm, titleCase, addressOf, placeOf, CLIENT_LITE, searchClientsByName, getClientLite, resolveClient,
  optionalRequire, fnFrom, formatPhone, normalizePhone,
};

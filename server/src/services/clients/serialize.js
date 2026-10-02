// Client / portfolio serialization + deterministic property math.
// Shared by routes/clients.js, routes/portfolio.js, routes/waitlists.js,
// routes/importer.js and services/clients/signals.js so every surface reads
// the same shapes (and the same derived numbers) everywhere.
const prisma = require('../../lib/prisma');
const { dayKey } = require('../../lib/dates');
const config = require('../../config');

// ── Workspace time zone (cached) ─────────────────────────────────────────
const tzCache = new Map(); // workspaceId -> { tz, at }
async function workspaceTz(workspaceId) {
  const hit = tzCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.tz;
  let tz = config.timezone || 'America/New_York';
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
    if (ws && ws.timezone) tz = ws.timezone;
  } catch (_) { /* default */ }
  tzCache.set(workspaceId, { tz, at: Date.now() });
  return tz;
}

// ── Names ────────────────────────────────────────────────────────────────
function displayNameOf(c) {
  if (!c) return '';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.company || c.email || c.phone || 'Unknown';
}

// Sort key for A–Z lists: Last, First (iOS Contacts order). Company-only
// vendors sort by company / display name.
function sortKeyOf(c) {
  const last = (c.lastName || '').trim();
  const first = (c.firstName || '').trim();
  if (last) return `${last} ${first}`.toLowerCase();
  if (first) return first.toLowerCase();
  return displayNameOf(c).toLowerCase();
}

// Lean row used by lists, pickers, links and live updates.
const LIST_SELECT = {
  id: true, workspaceId: true, firstName: true, lastName: true, displayName: true, phone: true, phoneAlt: true,
  email: true, company: true, jobTitle: true, avatarUrl: true, type: true, contactKind: true, vendorRole: true,
  status: true, rating: true, isWhale: true, leadSource: true, referredById: true, tags: true, city: true,
  neighborhood: true, birthday: true, preferredChannel: true, deviceMode: true, financing: true,
  lastContactedAt: true, lastInboundAt: true, lastOutboundAt: true, lifetimeVolume: true, lifetimeGci: true,
  transactionsCount: true, lastClosedAt: true, blocked: true, textOptOut: true, archivedAt: true,
  createdAt: true, updatedAt: true,
};

const MINI_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, company: true,
  avatarUrl: true, type: true, contactKind: true, vendorRole: true, rating: true, isWhale: true, deviceMode: true,
  neighborhood: true, status: true,
};

function listRow(c) {
  if (!c) return c;
  const out = {};
  for (const k of Object.keys(LIST_SELECT)) if (c[k] !== undefined) out[k] = c[k];
  out.name = displayNameOf(c);
  return out;
}

function mini(c) {
  if (!c) return null;
  return {
    id: c.id, firstName: c.firstName, lastName: c.lastName, displayName: c.displayName, name: displayNameOf(c),
    phone: c.phone || null, email: c.email || null, company: c.company || null, avatarUrl: c.avatarUrl || null,
    type: c.type, contactKind: c.contactKind, vendorRole: c.vendorRole || null, rating: c.rating || 0,
    isWhale: !!c.isWhale, deviceMode: c.deviceMode || null, neighborhood: c.neighborhood || null, status: c.status,
  };
}

// ── Property math (server-side, deterministic — LLMs never do date math) ─
const DAY = 864e5;

function daysBetweenKeys(a, b) { // 'YYYY-MM-DD' strings → whole days b - a
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

function daysUntil(date, tz, now = new Date()) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return daysBetweenKeys(dayKey(now, tz), dayKey(d, tz));
}

// Next anniversary of a date (month/day) on/after today in tz.
function nextAnniversary(date, tz, now = new Date()) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const todayKey = dayKey(now, tz);
  const [ty] = todayKey.split('-').map(Number);
  const [, m, dd] = dayKey(d, tz).split('-').map(Number);
  const mk = (y) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dd, m === 2 && dd === 29 ? 28 : dd)).padStart(2, '0')}`;
  let key = mk(ty);
  let days = daysBetweenKeys(todayKey, key);
  let year = ty;
  if (days < 0) { year = ty + 1; key = mk(year); days = daysBetweenKeys(todayKey, key); }
  const [py] = dayKey(d, tz).split('-').map(Number);
  return { days, years: year - py, date: key };
}

function deriveProperty(p, tz = 'America/New_York', now = new Date()) {
  const d = {};
  const rel = p.relationship || 'owns';
  const owned = rel === 'owns' || rel === 'leased_out';
  if (p.estValue != null) {
    const bal = p.mortgageBalance != null ? p.mortgageBalance : (p.loanType === 'cash' ? 0 : null);
    if (bal != null) {
      d.equity = p.estValue - bal;
      d.ltv = p.estValue > 0 ? Math.max(0, Math.min(2, bal / p.estValue)) : null;
      d.freeAndClear = bal === 0;
    }
  }
  if (p.loanResetAt) d.daysToReset = daysUntil(p.loanResetAt, tz, now);
  if (p.loanMaturesAt) d.daysToMaturity = daysUntil(p.loanMaturesAt, tz, now);
  if (p.leaseEndsAt) d.daysToLeaseEnd = daysUntil(p.leaseEndsAt, tz, now);
  if (p.purchasedAt) {
    const end = p.soldAt && rel === 'sold' ? new Date(p.soldAt) : now;
    d.heldYears = Math.max(0, Math.round(((end - new Date(p.purchasedAt)) / (365.25 * DAY)) * 10) / 10);
    if (owned) {
      const a = nextAnniversary(p.purchasedAt, tz, now);
      if (a && a.years >= 1) { d.anniversaryInDays = a.days; d.anniversaryYears = a.years; d.anniversaryDate = a.date; }
    }
  }
  const basis = p.purchasePrice;
  const value = rel === 'sold' ? p.soldPrice : p.estValue;
  if (basis && value) {
    d.appreciation = value - basis;
    d.appreciationPct = (value - basis) / basis;
    const yrs = d.heldYears;
    if (yrs && yrs >= 1) d.cagr = Math.pow(value / basis, 1 / yrs) - 1;
  }
  return d;
}

// Badge list (shared vocabulary for tiles, detail, signals).
function propertyBadges(p, d) {
  const out = [];
  const rel = p.relationship || 'owns';
  if (p.boughtWithMe) out.push({ key: 'bought', label: 'Bought with me', tone: 'blue' });
  if (p.soldWithMe) out.push({ key: 'sold', label: 'Sold with me', tone: 'blue' });
  if (p.thinkingOfSelling && rel !== 'sold') out.push({ key: 'selling', label: 'Thinking of selling', tone: 'danger' });
  if (d.daysToReset != null && d.daysToReset >= 0 && d.daysToReset <= 365 && rel !== 'sold') {
    out.push({ key: 'arm', label: `ARM reset in ${fmtDays(d.daysToReset)}`, tone: d.daysToReset <= 180 ? 'caution' : 'neutral' });
  }
  if (d.daysToMaturity != null && d.daysToMaturity >= 0 && d.daysToMaturity <= 365 && rel !== 'sold') {
    out.push({ key: 'maturity', label: `Loan matures in ${fmtDays(d.daysToMaturity)}`, tone: d.daysToMaturity <= 180 ? 'caution' : 'neutral' });
  }
  if (d.daysToLeaseEnd != null && d.daysToLeaseEnd >= 0 && d.daysToLeaseEnd <= 180) {
    out.push({ key: 'lease', label: `${rel === 'leased_out' ? 'Tenant lease' : 'Lease'} ends in ${fmtDays(d.daysToLeaseEnd)}`, tone: d.daysToLeaseEnd <= 60 ? 'caution' : 'neutral' });
  }
  if (d.anniversaryInDays != null && d.anniversaryInDays <= 30) {
    out.push({ key: 'anniversary', label: d.anniversaryInDays === 0 ? `${d.anniversaryYears}-yr anniversary today` : `${d.anniversaryYears}-yr anniversary in ${fmtDays(d.anniversaryInDays)}`, tone: 'success' });
  }
  return out;
}

function fmtDays(n) {
  if (n <= 0) return 'today';
  if (n < 60) return `${n}d`;
  return `${Math.round(n / 30.4)} mo`;
}

function propertyTitle(p) {
  if (p.street) return `${p.street}${p.unit ? ` #${String(p.unit).replace(/^#/, '')}` : ''}`;
  if (p.buildingName) return `${p.buildingName}${p.unit ? ` #${String(p.unit).replace(/^#/, '')}` : ''}`;
  if (p.nickname) return p.nickname;
  return p.neighborhood || p.city || 'Untitled property';
}

function serializeProperty(p, tz) {
  if (!p) return p;
  const derived = deriveProperty(p, tz);
  return { ...p, title: propertyTitle(p), derived, badges: propertyBadges(p, derived) };
}

function searchTitle(s) {
  if (s.name) return s.name;
  const type = (s.propertyTypes || [])[0];
  const typeLabel = type ? ({ single_family: 'Home', condo: 'Condo', penthouse: 'Penthouse', estate: 'Estate', townhouse: 'Townhouse', villa: 'Villa', land: 'Land', co_op: 'Co-op' }[type] || type) : 'Home';
  const wf = (s.waterfront || []).filter((w) => w && w !== 'any');
  const lead = wf.length ? `${cap(wf[0])} ${typeLabel.toLowerCase()}` : typeLabel;
  const where = (s.neighborhoods || [])[0] || (s.buildings || [])[0] || (s.markets || [])[0];
  return where ? `${lead} · ${where}` : lead;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function serializeSearch(s) {
  if (!s) return s;
  return { ...s, title: searchTitle(s) };
}

module.exports = {
  workspaceTz, displayNameOf, sortKeyOf, LIST_SELECT, MINI_SELECT, listRow, mini,
  deriveProperty, propertyBadges, propertyTitle, serializeProperty, searchTitle, serializeSearch,
  daysUntil, nextAnniversary, daysBetweenKeys,
};

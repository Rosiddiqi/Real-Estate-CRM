// Client lifecycle signals (spec §8.14) — the real-estate analog of RevMatch's
// lease-maturity sweep. Pure reads; consumers (battle plan, Serena, campaigns,
// dashboard) decide what to do with them.
//
//   const signals = require('../services/clients/signals');
//   await signals.upcomingBirthdays({ workspaceId, days: 14 })
//   await signals.upcomingAnniversaries({ workspaceId, days: 30 })   // home-purchase anniversaries
//   await signals.armResets({ workspaceId, days: 180 })              // + balloon / loan maturities ≤ 365d
//   await signals.leaseExpiries({ workspaceId, days: 120 })          // renters (buy signal) + landlords (tenant turnover)
//   await signals.equityMilestones({ workspaceId })                  // big appreciation / low LTV
//   await signals.silentClients({ workspaceId, days: 30 })
//   await signals.allSignals({ workspaceId })                        // everything, sorted by urgency
//
// Every row: { kind, clientId, client:{id,name,firstName,…}, title, sub, days?, date?, propertyId?, urgency 0..1, meta }
// "today" is always the workspace's time zone (lib/dates).
const prisma = require('../../lib/prisma');
const { dayKey } = require('../../lib/dates');
const S = require('./serialize');
const { moneyShort } = require('./text');

const ACTIVE_CLIENT = { archivedAt: null, blocked: false };

function first(c) { return c.firstName || S.displayNameOf(c).split(' ')[0]; }
function inDays(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; }

// ── birthdays ────────────────────────────────────────────────────────────
async function upcomingBirthdays({ workspaceId, days = 14, now = new Date() } = {}) {
  const tz = await S.workspaceTz(workspaceId);
  const rows = await prisma.client.findMany({ where: { workspaceId, ...ACTIVE_CLIENT, birthday: { not: null } }, select: { ...S.MINI_SELECT, birthday: true } });
  const today = dayKey(now, tz);
  const [ty] = today.split('-').map(Number);
  const out = [];
  for (const c of rows) {
    const m = /^(?:(\d{4})|-)-?(\d{2})-(\d{2})$/.exec(String(c.birthday).trim());
    if (!m) continue;
    const mm = m[2]; const dd = m[3];
    let key = `${ty}-${mm}-${dd}`;
    let d = S.daysBetweenKeys(today, key);
    let year = ty;
    if (d < 0) { year = ty + 1; key = `${year}-${mm}-${dd}`; d = S.daysBetweenKeys(today, key); }
    if (d > days) continue;
    const turning = m[1] ? year - Number(m[1]) : null;
    out.push({
      kind: 'birthday', clientId: c.id, client: S.mini(c), days: d, date: key,
      title: d === 0 ? `${first(c)}’s birthday is today` : `${first(c)}’s birthday in ${d} day${d === 1 ? '' : 's'}`,
      sub: turning ? `Turning ${turning}` : null,
      urgency: d === 0 ? 1 : Math.max(0.2, 1 - d / (days + 1)),
      meta: { turning },
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── shared property loader ───────────────────────────────────────────────
async function ownedProperties(workspaceId, extraWhere = {}) {
  const tz = await S.workspaceTz(workspaceId);
  const rows = await prisma.portfolioProperty.findMany({
    where: { workspaceId, client: ACTIVE_CLIENT, ...extraWhere },
    include: { client: { select: S.MINI_SELECT } },
  });
  return rows.map((p) => ({ ...S.serializeProperty(p, tz), client: p.client }));
}

// ── home-purchase anniversaries ──────────────────────────────────────────
async function upcomingAnniversaries({ workspaceId, days = 30, now = new Date() } = {}) {
  void now;
  const props = await ownedProperties(workspaceId, { relationship: { in: ['owns', 'leased_out'] }, purchasedAt: { not: null } });
  const out = [];
  for (const p of props) {
    const d = p.derived;
    if (d.anniversaryInDays == null || d.anniversaryInDays > days) continue;
    const milestone = [1, 3, 5, 7, 10, 15, 20, 25].includes(d.anniversaryYears);
    out.push({
      kind: 'home_anniversary', clientId: p.clientId, client: S.mini(p.client), propertyId: p.id, propertyTitle: p.title,
      days: d.anniversaryInDays, date: d.anniversaryDate, years: d.anniversaryYears,
      title: d.anniversaryInDays === 0 ? `${first(p.client)}: ${d.anniversaryYears} years at ${p.title} today` : `${first(p.client)}’s ${d.anniversaryYears}-year home anniversary ${inDays(d.anniversaryInDays)}`,
      sub: [p.title, d.appreciation ? `${d.appreciation >= 0 ? '+' : '−'}${moneyShort(Math.abs(d.appreciation))} est.` : null].filter(Boolean).join(' · '),
      urgency: (milestone ? 0.75 : 0.5) + (d.anniversaryInDays <= 7 ? 0.2 : 0),
      meta: { appreciation: d.appreciation ?? null, equity: d.equity ?? null, milestone },
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── ARM resets + loan maturities ─────────────────────────────────────────
async function armResets({ workspaceId, days = 180, maturityDays = 365 } = {}) {
  const props = await ownedProperties(workspaceId, {
    relationship: { in: ['owns', 'leased_out'] },
    OR: [{ loanResetAt: { not: null } }, { loanMaturesAt: { not: null } }],
  });
  const out = [];
  for (const p of props) {
    const d = p.derived;
    const rate = p.mortgageRate ? `${(p.mortgageRate > 1 ? p.mortgageRate : p.mortgageRate * 100).toFixed(3).replace(/\.?0+$/, '')}%` : null;
    const armYears = p.meta && p.meta.armFixedYears ? `${p.meta.armFixedYears}/1 ARM` : 'ARM';
    if (d.daysToReset != null && d.daysToReset >= 0 && d.daysToReset <= days) {
      out.push({
        kind: 'arm_reset', clientId: p.clientId, client: S.mini(p.client), propertyId: p.id, propertyTitle: p.title,
        days: d.daysToReset, date: p.loanResetAt,
        title: `${first(p.client)}’s ${armYears} resets ${inDays(d.daysToReset)}`,
        sub: [p.title, rate, p.mortgageBalance ? `${moneyShort(p.mortgageBalance)} balance` : null, p.lenderName].filter(Boolean).join(' · '),
        urgency: d.daysToReset <= 60 ? 1 : d.daysToReset <= 120 ? 0.75 : 0.55,
        meta: { rate: p.mortgageRate, balance: p.mortgageBalance, lender: p.lenderName, equity: d.equity ?? null, urgent: d.daysToReset <= 60 },
      });
    }
    if (d.daysToMaturity != null && d.daysToMaturity >= 0 && d.daysToMaturity <= maturityDays && ['balloon', 'interest_only'].includes(p.loanType)) {
      out.push({
        kind: 'loan_maturity', clientId: p.clientId, client: S.mini(p.client), propertyId: p.id, propertyTitle: p.title,
        days: d.daysToMaturity, date: p.loanMaturesAt,
        title: `${first(p.client)}’s ${p.loanType === 'balloon' ? 'balloon' : 'interest-only period'} ends ${d.daysToMaturity >= 60 ? `in ${Math.round(d.daysToMaturity / 30.4)} months` : inDays(d.daysToMaturity)}`,
        sub: [p.title, p.mortgageBalance ? `${moneyShort(p.mortgageBalance)} balance` : null].filter(Boolean).join(' · '),
        urgency: d.daysToMaturity <= 90 ? 0.9 : 0.5,
        meta: { loanType: p.loanType, balance: p.mortgageBalance },
      });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── lease expiries ───────────────────────────────────────────────────────
async function leaseExpiries({ workspaceId, days = 120 } = {}) {
  const props = await ownedProperties(workspaceId, { relationship: { in: ['rents', 'leased_out'] }, leaseEndsAt: { not: null } });
  const out = [];
  for (const p of props) {
    const n = p.derived.daysToLeaseEnd;
    if (n == null || n < 0 || n > days) continue;
    const renter = p.relationship === 'rents';
    out.push({
      kind: renter ? 'lease_expiry' : 'tenant_lease_expiry', clientId: p.clientId, client: S.mini(p.client), propertyId: p.id, propertyTitle: p.title,
      days: n, date: p.leaseEndsAt,
      title: renter ? `${first(p.client)}’s lease ends ${inDays(n)}` : `${first(p.client)}’s tenant lease at ${p.title} ends ${inDays(n)}`,
      sub: renter
        ? [p.title, p.rentAmount ? `${moneyShort(p.rentAmount)}/mo` : null, 'buy-vs-renew conversation'].filter(Boolean).join(' · ')
        : [p.rentAmount ? `${moneyShort(p.rentAmount)}/mo` : null, 're-lease or sell'].filter(Boolean).join(' · '),
      urgency: n <= 45 ? 0.95 : n <= 90 ? 0.7 : 0.5,
      meta: { rent: p.rentAmount, relationship: p.relationship },
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── equity milestones ────────────────────────────────────────────────────
async function equityMilestones({ workspaceId, minAppreciationPct = 0.5, minEquity = 2000000 } = {}) {
  const props = await ownedProperties(workspaceId, { relationship: { in: ['owns', 'leased_out'] }, estValue: { not: null } });
  const out = [];
  for (const p of props) {
    const d = p.derived;
    const reasons = [];
    if (d.appreciationPct != null && d.appreciationPct >= minAppreciationPct) {
      const pct = Math.round(d.appreciationPct * 100);
      reasons.push(pct >= 100 ? `Value ${pct >= 200 ? 'tripled' : 'doubled'}+ since purchase (+${pct}%)` : `Up ${pct}% since purchase`);
    }
    if (d.equity != null && d.equity >= minEquity && d.ltv != null && d.ltv <= 0.5) reasons.push(`${moneyShort(d.equity)} est. equity · ${Math.round(d.ltv * 100)}% LTV`);
    if (!reasons.length) continue;
    out.push({
      kind: 'equity_milestone', clientId: p.clientId, client: S.mini(p.client), propertyId: p.id, propertyTitle: p.title,
      title: `${first(p.client)}: ${reasons[0].charAt(0).toLowerCase()}${reasons[0].slice(1)}`, sub: [p.title, reasons[1] || (d.equity != null ? `${moneyShort(d.equity)} est. equity` : null)].filter(Boolean).join(' · '),
      urgency: Math.min(0.85, 0.35 + (d.appreciationPct || 0) / 4),
      meta: { appreciation: d.appreciation ?? null, appreciationPct: d.appreciationPct ?? null, equity: d.equity ?? null, ltv: d.ltv ?? null, estValue: p.estValue, thinkingOfSelling: !!p.thinkingOfSelling },
    });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

// ── silent clients ───────────────────────────────────────────────────────
async function silentClients({ workspaceId, days = 30, minRating = 0, limit = 50, now = new Date() } = {}) {
  const rows = await prisma.client.findMany({
    where: { workspaceId, ...ACTIVE_CLIENT, contactKind: 'client', status: { notIn: ['inactive'] }, rating: { gte: minRating } },
    select: { ...S.MINI_SELECT, lastContactedAt: true, lastInboundAt: true, lastOutboundAt: true, createdAt: true, lifetimeVolume: true },
  });
  const out = [];
  for (const c of rows) {
    const last = [c.lastContactedAt, c.lastInboundAt, c.lastOutboundAt].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
    const since = last || new Date(c.createdAt);
    const n = Math.floor((now - since) / 864e5);
    if (n < days) continue;
    out.push({
      kind: 'silent', clientId: c.id, client: S.mini(c), days: n, lastTouchAt: last,
      title: last ? `${first(c)} has been silent ${n} days` : `No touch with ${first(c)} since added ${n} days ago`,
      sub: [c.isWhale ? 'Whale' : null, c.rating ? `${c.rating}★` : null, c.lifetimeVolume ? `${moneyShort(c.lifetimeVolume)} lifetime` : null].filter(Boolean).join(' · ') || null,
      urgency: Math.min(1, 0.3 + (c.isWhale ? 0.35 : 0) + (c.rating || 0) * 0.06 + Math.min(0.2, n / 600)),
      meta: { rating: c.rating, isWhale: c.isWhale },
    });
  }
  return out.sort((a, b) => b.urgency - a.urgency || b.days - a.days).slice(0, limit);
}

async function allSignals({ workspaceId } = {}) {
  const parts = await Promise.all([
    upcomingBirthdays({ workspaceId }), upcomingAnniversaries({ workspaceId }), armResets({ workspaceId }),
    leaseExpiries({ workspaceId }), equityMilestones({ workspaceId }), silentClients({ workspaceId, days: 30, limit: 25 }),
  ]);
  return parts.flat().sort((a, b) => b.urgency - a.urgency);
}

// Every export is workspace-scoped: it accepts `{ workspaceId, … }` or a bare
// workspace id string, and returns [] (never another workspace's rows) when no
// workspace is given.
function scoped(fn) {
  return (arg, more) => {
    const opts = typeof arg === 'string' ? { ...(more || {}), workspaceId: arg } : { ...(arg || {}) };
    if (!opts.workspaceId || typeof opts.workspaceId !== 'string') return Promise.resolve([]);
    return fn(opts);
  };
}

module.exports = {
  upcomingBirthdays: scoped(upcomingBirthdays),
  upcomingAnniversaries: scoped(upcomingAnniversaries),
  armResets: scoped(armResets),
  leaseExpiries: scoped(leaseExpiries),
  equityMilestones: scoped(equityMilestones),
  silentClients: scoped(silentClients),
  allSignals: scoped(allSignals),
};

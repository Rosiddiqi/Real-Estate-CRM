// Pay plan + cap-year state. The active plan is the newest PayPlan row whose
// effective window covers now (RevMatch rule). Cap year = the anniversary
// window (MM-DD) that contains "today" in the workspace's time zone; closings
// inside it are walked chronologically to know how much company dollar has
// been paid toward the cap, how much franchise fee, and GCI YTD (tiers).
const prisma = require('../../lib/prisma');
const { partsIn, zonedTime } = require('../../lib/dates');
const C = require('./commission');

const DEFAULT_TZ = require('../../config').timezone;

async function workspaceTz(workspaceId) {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
    return (ws && ws.timezone) || DEFAULT_TZ;
  } catch { return DEFAULT_TZ; }
}

async function getActivePlanRow(workspaceId) {
  const now = new Date();
  const rows = await prisma.payPlan.findMany({
    where: { workspaceId, effectiveFrom: { lte: new Date(now.getTime() + 86400000) } },
    orderBy: [{ effectiveFrom: 'desc' }, { updatedAt: 'desc' }],
    take: 10,
  });
  return rows.find((r) => !r.effectiveTo || r.effectiveTo >= now) || rows[0] || null;
}

// Plan as plain data the commission module understands (+ row id).
function planFromRow(row) {
  const base = row ? {
    id: row.id,
    name: row.name,
    planType: row.planType,
    defaultBuyerRate: row.defaultBuyerRate,
    defaultListingRate: row.defaultListingRate,
    agentSplit: row.agentSplit,
    capAmount: row.capAmount,
    capAnniversary: row.capAnniversary || '01-01',
    postCapSplit: row.postCapSplit,
    transactionFee: row.transactionFee,
    postCapTransactionFee: row.postCapTransactionFee,
    franchisePct: row.franchisePct,
    franchiseCap: row.franchiseCap,
    teamLeadPct: row.teamLeadPct,
    tiers: row.tiers || [],
    goals: row.goals || {},
    effectiveFrom: row.effectiveFrom,
    updatedAt: row.updatedAt,
  } : { id: null, name: 'Default plan' };
  const p = C.preparePlan(base);
  p.id = base.id;
  p.name = base.name;
  p.effectiveFrom = base.effectiveFrom || null;
  p.updatedAt = base.updatedAt || null;
  return p;
}

async function getPlan(workspaceId) {
  return planFromRow(await getActivePlanRow(workspaceId));
}

// [start, end) of the cap year containing `now`, in tz.
function capYearBounds(plan, now = new Date(), tz = DEFAULT_TZ) {
  const [mm, dd] = String(plan.capAnniversary || '01-01').split('-').map(Number);
  const p = partsIn(now, tz);
  const pad = (n) => String(n).padStart(2, '0');
  const thisYear = `${p.year}-${pad(mm)}-${pad(dd)}`;
  const today = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const startYear = today >= thisYear ? p.year : p.year - 1;
  const start = zonedTime(`${startYear}-${pad(mm)}-${pad(dd)}`, 0, 0, tz);
  const end = zonedTime(`${startYear + 1}-${pad(mm)}-${pad(dd)}`, 0, 0, tz);
  return { start, end, anniversary: `${pad(mm)}-${pad(dd)}` };
}

// Closed deals in the cap year, walked in order → state after the last one.
async function capState(workspaceId, plan, tz, now = new Date()) {
  const bounds = capYearBounds(plan, now, tz);
  const closed = await prisma.deal.findMany({
    where: { workspaceId, stage: 'closed', closedAt: { gte: bounds.start, lt: bounds.end } },
    orderBy: { closedAt: 'asc' },
  });
  const r = C.processClosings(closed, plan);
  return { ...bounds, ytd: r.ytd, totals: r.totals, rows: r.rows, deals: closed };
}

// Everything estimates need, loaded once per request.
async function pricingContext(workspaceId, now = new Date()) {
  const [tz, plan] = await Promise.all([workspaceTz(workspaceId), getPlan(workspaceId)]);
  const cap = await capState(workspaceId, plan, tz, now);
  return { tz, plan, cap, ytd: cap.ytd, now };
}

module.exports = { workspaceTz, getActivePlanRow, planFromRow, getPlan, capYearBounds, capState, pricingContext };

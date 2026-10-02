// /api/dashboard/stats — everything the Stats page needs in one round trip:
// scoreboard (closings vs goal with pace, volume, GCI MTD/YTD/last month,
// projected EOM), chart series, pipeline funnel, hot deals, at-risk deals,
// follow-up alerts and an inbox glance. Money is computed from Deal rows here;
// the web prefers the pipeline builder's /api/commissions/summary when present.
const express = require('express');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ah } = require('../lib/http');
const { clientName } = require('../lib/clients');
const { monthBounds, yearBounds, partsIn, dayKey, addDays, weekdayIndex } = require('../lib/dates');

const router = express.Router();
const DAY = 864e5;

const PHASES = [
  { key: 'engaged', label: 'Engaged', stages: ['new_lead', 'seller_lead'] },
  { key: 'consult', label: 'Consult', stages: ['consultation', 'listing_appt'] },
  { key: 'active', label: 'Active', stages: ['touring', 'active', 'unit_selection', 'pricing_received', 'priority_list'] },
  { key: 'offer', label: 'Offer', stages: ['offer_submitted', 'offer_received'] },
  { key: 'contract', label: 'Under contract', stages: ['under_contract', 'reserved'] },
];
const STAGE_LABEL = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted', under_contract: 'Under contract',
  closed: 'Closed', seller_lead: 'Seller lead', listing_appt: 'Listing appt', active: 'Active listing', offer_received: 'Offer received',
  unit_selection: 'Unit selection', pricing_received: 'Pricing received', priority_list: 'Priority list', reserved: 'Reserved', building_delivered: 'Delivered',
};
const STAGE_ODDS = {
  new_lead: 0.2, seller_lead: 0.2, consultation: 0.35, listing_appt: 0.35, touring: 0.5, active: 0.5,
  offer_submitted: 0.7, offer_received: 0.7, under_contract: 0.9, unit_selection: 0.5, pricing_received: 0.6, priority_list: 0.7, reserved: 0.85,
};
const HOT_STAGES = ['offer_submitted', 'offer_received', 'under_contract', 'reserved'];

function price(d) { return d.salePrice || d.contractPrice || d.price || d.listPrice || 0; }
function rateOf(d) {
  if (d.sideRate) return d.sideRate;
  if (d.side === 'dual') return (d.listRate || 0.03) + (d.buyRate || 0.025);
  if (d.side === 'listing') return d.listRate || 0.03;
  return d.buyRate || 0.025;
}
function gciOf(d) {
  if (d.stage === 'closed' && d.grossCommission) return d.grossCommission;
  if (d.estimatedGci && d.stage !== 'closed') return d.estimatedGci;
  if (d.commissionFlat) return d.commissionFlat;
  if (d.side && d.side.startsWith('lease')) return Math.round((d.monthlyRent || 0) * (d.sideRate || 1));
  return Math.round(price(d) * rateOf(d) * (d.splitShare || 1));
}
function sidesOf(d) {
  const base = d.side === 'dual' ? 2 : 1;
  const share = d.splitShare && d.splitShare < 1 ? d.splitShare : 1;
  return Math.round(base * share * 100) / 100;
}
function netOf(d, plan) {
  if (d.commission != null) return d.commission;
  const split = plan ? plan.agentSplit : 0.8;
  const fee = plan ? plan.transactionFee : 0;
  return Math.max(0, Math.round(gciOf(d) * split - fee));
}
function dealLabel(d) {
  return d.propertyLabel || d.propertyAddress || d.title || null;
}

// Working days elapsed / total in the month, from the weekly schedule (off days excluded).
async function workingDays(userId, tz, now) {
  let weekly = null;
  try { const ws = await prisma.workSchedule.findUnique({ where: { userId }, select: { weekly: true, overrides: true } }); weekly = ws; } catch { /* ignore */ }
  const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const p = partsIn(now, tz);
  const days = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  let total = 0; let elapsed = 0;
  for (let d = 1; d <= days; d++) {
    const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ov = weekly && weekly.overrides && weekly.overrides[key];
    const wk = weekly && weekly.weekly && weekly.weekly[KEYS[weekdayIndex(key)]];
    const off = ov ? !!ov.off : wk ? !!wk.off : false;
    if (off) continue;
    total += 1;
    if (d < p.day) elapsed += 1;
    else if (d === p.day) elapsed += Math.min(1, Math.max(0, (p.hour * 60 + p.minute - 9 * 60) / (9 * 60)));
  }
  return { total: total || days, elapsed, dayOfMonth: p.day, daysInMonth: days };
}

router.get('/stats', ah(async (req, res) => {
  const wid = req.workspaceId;
  const now = new Date();
  const [workspace, user, plan] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: wid }, select: { timezone: true, market: true, settings: true } }),
    req.getUser(),
    prisma.payPlan.findFirst({ where: { workspaceId: wid }, orderBy: { effectiveFrom: 'desc' } }),
  ]);
  const tz = (user && user.timezone) || (workspace && workspace.timezone) || config.timezone;
  const prefs = (user && user.preferences) || {};
  const month = monthBounds(now, tz);
  const year = yearBounds(now, tz);
  const lastMonth = monthBounds(new Date(month.start.getTime() - DAY / 2), tz);
  const since = new Date(Math.min(year.start.getTime(), lastMonth.start.getTime()));

  const [closed, open, wd] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId: wid, stage: 'closed', closedAt: { gte: since } },
      include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true, rating: true, isWhale: true } } },
    }),
    prisma.deal.findMany({
      where: { workspaceId: wid, archivedAt: null, stage: { notIn: ['closed', 'lost', 'building_delivered'] } },
      include: { client: { select: { id: true, firstName: true, lastName: true, displayName: true, rating: true, isWhale: true, lastContactedAt: true, phone: true, avatarUrl: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    workingDays(req.userId, tz, now),
  ]);

  const sum = (rows) => rows.reduce((acc, d) => ({
    sides: Math.round((acc.sides + sidesOf(d)) * 100) / 100,
    volume: acc.volume + price(d),
    gci: acc.gci + gciOf(d),
    net: acc.net + netOf(d, plan),
    deals: acc.deals + 1,
  }), { sides: 0, volume: 0, gci: 0, net: 0, deals: 0 });
  const inRange = (d, a, b) => d.closedAt && new Date(d.closedAt) >= a && new Date(d.closedAt) < b;
  const mtdRows = closed.filter((d) => inRange(d, month.start, month.end));
  const mtd = sum(mtdRows);
  const ytd = sum(closed.filter((d) => inRange(d, year.start, year.end)));
  const lm = sum(closed.filter((d) => inRange(d, lastMonth.start, lastMonth.end)));

  const goalsRaw = (plan && plan.goals) || {};
  const goals = {
    monthlySides: goalsRaw.monthlySides || (goalsRaw.annualSides ? Math.max(1, Math.round(goalsRaw.annualSides / 12)) : 2),
    annualSides: goalsRaw.annualSides || null,
    annualGci: goalsRaw.annualGci || null,
    annualVolume: goalsRaw.annualVolume || null,
    monthlyGci: goalsRaw.monthlyGci || (goalsRaw.annualGci ? Math.round(goalsRaw.annualGci / 12) : null),
    monthlyVolume: goalsRaw.monthlyVolume || (goalsRaw.annualVolume ? Math.round(goalsRaw.annualVolume / 12) : null),
  };
  const frac = wd.total ? Math.min(1, wd.elapsed / wd.total) : wd.dayOfMonth / wd.daysInMonth;
  const pace = Math.round(goals.monthlySides * frac * 10) / 10;

  // Projected end of month: MTD + Σ deals expected to close this month × stage odds.
  const closingThisMonth = open.filter((d) => d.closingDate && new Date(d.closingDate) >= new Date(now.getTime() - DAY) && new Date(d.closingDate) < month.end);
  const projWeighted = closingThisMonth.reduce((a, d) => a + gciOf(d) * (STAGE_ODDS[d.stage] ?? 0.5), 0);
  const projUnweighted = closingThisMonth.reduce((a, d) => a + gciOf(d), 0);
  const projectedEom = Math.round(mtd.gci + projWeighted);

  // Charts: cumulative GCI by day (this month vs last), GCI by month (this year).
  const p = partsIn(now, tz);
  const lmDays = new Date(Date.UTC(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 0)).getUTCDate();
  const dayIdx = (d) => partsIn(new Date(d.closedAt), tz).day;
  const series = (rows, n, upTo) => {
    const daily = Array.from({ length: n }, () => 0);
    for (const d of rows) daily[dayIdx(d) - 1] += gciOf(d);
    let cum = 0;
    return daily.map((v, i) => { cum += v; return { day: i + 1, gci: v, cum: upTo != null && i + 1 > upTo ? null : cum }; });
  };
  const dailyThisMonth = series(mtdRows, wd.daysInMonth, p.day);
  const dailyLastMonth = series(closed.filter((d) => inRange(d, lastMonth.start, lastMonth.end)), lmDays, null);
  const monthlyThisYear = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: new Date(Date.UTC(p.year, i, 15)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), gci: 0, sides: 0, volume: 0, future: i + 1 > p.month }));
  for (const d of closed.filter((x) => inRange(x, year.start, year.end))) {
    const m = partsIn(new Date(d.closedAt), tz).month;
    monthlyThisYear[m - 1].gci += gciOf(d);
    monthlyThisYear[m - 1].sides = Math.round((monthlyThisYear[m - 1].sides + sidesOf(d)) * 100) / 100;
    monthlyThisYear[m - 1].volume += price(d);
  }

  // Pipeline funnel by phase.
  const phases = PHASES.map((ph) => {
    const rows = open.filter((d) => ph.stages.includes(d.stage));
    return { key: ph.key, label: ph.label, count: rows.length, volume: rows.reduce((a, d) => a + price(d), 0), gci: rows.reduce((a, d) => a + gciOf(d), 0) };
  });
  phases.push({ key: 'closed', label: 'Closed · MTD', count: mtdRows.length, volume: mtd.volume, gci: mtd.gci });
  const pipelineGci = open.reduce((a, d) => a + gciOf(d), 0);
  const weightedGci = Math.round(open.reduce((a, d) => a + gciOf(d) * (STAGE_ODDS[d.stage] ?? 0.5), 0));

  const miniDeal = (d) => {
    const c = d.client || {};
    const lastTouch = Math.max(new Date(d.updatedAt).getTime(), c.lastContactedAt ? new Date(c.lastContactedAt).getTime() : 0);
    return {
      id: d.id, stage: d.stage, stageLabel: STAGE_LABEL[d.stage] || d.stage, side: d.side, track: d.track,
      clientId: d.clientId, clientName: clientName(c), avatarUrl: c.avatarUrl || null, phone: c.phone || null,
      whale: !!(c.isWhale || (c.rating || 0) >= 5), stars: c.rating || null,
      property: dealLabel(d), price: price(d) || null, gci: gciOf(d),
      closingDate: d.closingDate, daysToClose: d.closingDate ? Math.ceil((new Date(d.closingDate) - now) / DAY) : null,
      daysStale: Math.floor((now.getTime() - lastTouch) / DAY),
      daysInStage: Math.floor((now.getTime() - new Date(d.stageChangedAt).getTime()) / DAY),
      contingencies: d.contingencies || null,
    };
  };

  // At risk: open, not a long-escrow new-dev deal, untouched 5+ days. Stalest first.
  const atRisk = open
    .filter((d) => d.track !== 'new_dev')
    .map(miniDeal)
    .filter((d) => d.daysStale >= 5)
    .sort((a, b) => b.daysStale - a.daysStale || b.gci - a.gci)
    .slice(0, 8);
  const hot = open
    .filter((d) => HOT_STAGES.includes(d.stage))
    .map(miniDeal)
    .sort((a, b) => (a.closingDate ? new Date(a.closingDate).getTime() : Infinity) - (b.closingDate ? new Date(b.closingDate).getTime() : Infinity) || b.gci - a.gci)
    .slice(0, 6);

  // Follow-up alerts.
  const [silent, upcomingClosingAppts, convAgg, recentUnread, missed] = await Promise.all([
    prisma.client.findMany({
      where: {
        workspaceId: wid, archivedAt: null, blocked: false, contactKind: 'client',
        OR: [{ isWhale: true }, { rating: { gte: 4 } }],
        AND: [{ OR: [{ lastContactedAt: { lt: new Date(now.getTime() - 21 * DAY) } }, { lastContactedAt: null, createdAt: { lt: new Date(now.getTime() - 21 * DAY) } }] }],
      },
      orderBy: [{ rating: 'desc' }, { lastContactedAt: 'asc' }],
      take: 6,
      select: { id: true, firstName: true, lastName: true, displayName: true, rating: true, isWhale: true, lastContactedAt: true, phone: true, avatarUrl: true, status: true, type: true },
    }),
    prisma.appointment.findMany({
      where: { workspaceId: wid, type: { in: ['closing', 'final_walkthrough', 'inspection', 'appraisal'] }, status: { in: ['scheduled', 'confirmed'] }, startAt: { gte: now, lt: new Date(now.getTime() + 14 * DAY) } },
      orderBy: { startAt: 'asc' }, take: 6,
      select: { id: true, type: true, title: true, startAt: true, clientId: true, location: true },
    }),
    prisma.conversation.aggregate({
      where: { workspaceId: wid, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' },
      _sum: { unreadCount: true }, _count: { _all: true },
    }),
    prisma.conversation.findMany({
      where: { workspaceId: wid, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' },
      orderBy: { lastMessageAt: 'desc' }, take: 4,
      select: { id: true, clientId: true, displayName: true, handle: true, channel: true, lastMessagePreview: true, lastMessageAt: true, unreadCount: true, isGroup: true, groupName: true, client: { select: { firstName: true, lastName: true, displayName: true, avatarUrl: true, isWhale: true } } },
    }),
    prisma.phoneCall.findMany({
      where: { workspaceId: wid, direction: 'inbound', status: { in: ['missed', 'no_answer', 'voicemail'] }, startedAt: { gt: prefs.missedSeenAt ? new Date(prefs.missedSeenAt) : new Date(now.getTime() - DAY) } },
      orderBy: { startedAt: 'desc' }, take: 5,
      select: { id: true, clientId: true, fromNumber: true, status: true, startedAt: true, client: { select: { firstName: true, lastName: true, displayName: true, avatarUrl: true } } },
    }),
  ]);
  const missedCount = await prisma.phoneCall.count({
    where: { workspaceId: wid, direction: 'inbound', status: { in: ['missed', 'no_answer', 'voicemail'] }, startedAt: { gt: prefs.missedSeenAt ? new Date(prefs.missedSeenAt) : new Date(now.getTime() - DAY) } },
  });

  const closingDeals = open
    .filter((d) => d.closingDate && new Date(d.closingDate) >= new Date(now.getTime() - DAY) && new Date(d.closingDate) < new Date(now.getTime() + 21 * DAY))
    .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate))
    .slice(0, 6)
    .map(miniDeal);
  const deadlines = [];
  for (const d of open) {
    for (const [field, label] of [['inspectionDeadline', 'Inspection'], ['appraisalDeadline', 'Appraisal'], ['financingDeadline', 'Financing']]) {
      const at = d[field];
      if (!at) continue;
      const days = Math.ceil((new Date(at) - now) / DAY);
      if (days < -1 || days > 7) continue;
      deadlines.push({ dealId: d.id, clientId: d.clientId, clientName: clientName(d.client || {}), property: dealLabel(d), label, at, days });
    }
  }
  deadlines.sort((a, b) => new Date(a.at) - new Date(b.at));

  res.json({
    timeZone: tz,
    generatedAt: now.toISOString(),
    month: { label: now.toLocaleDateString('en-US', { timeZone: tz, month: 'short' }).toUpperCase(), dayOfMonth: wd.dayOfMonth, daysInMonth: wd.daysInMonth, workingDays: wd.total, workingDaysElapsed: Math.round(wd.elapsed * 10) / 10, frac },
    northStar: prefs.northStar || `#1 luxury agent in ${(workspace && workspace.market) || 'your market'}.`,
    goals,
    closings: { mtd: mtd.sides, goal: goals.monthlySides, pace, deals: mtd.deals },
    volume: { mtd: mtd.volume, goal: goals.monthlyVolume, pace: goals.monthlyVolume ? Math.round(goals.monthlyVolume * frac) : null },
    money: {
      source: 'deals',
      mtd, ytd, lastMonth: lm,
      projected: { eom: projectedEom, weighted: Math.round(projWeighted), unweighted: Math.round(projUnweighted), pipelineGci, weightedPipelineGci: weightedGci },
      plan: plan ? { agentSplit: plan.agentSplit, capAmount: plan.capAmount, transactionFee: plan.transactionFee } : null,
    },
    charts: { dailyThisMonth, dailyLastMonth, monthlyThisYear, lastMonthLabel: lastMonth.start.toLocaleDateString('en-US', { timeZone: tz, month: 'long' }), thisMonthLabel: now.toLocaleDateString('en-US', { timeZone: tz, month: 'long' }), year: p.year },
    pipeline: { phases, active: open.length, pipelineGci, weightedGci, atRisk, trappedGci: atRisk.reduce((a, d) => a + d.gci, 0), hot },
    followUps: {
      silentClients: silent.map((c) => ({ id: c.id, name: clientName(c), rating: c.rating, whale: !!(c.isWhale || (c.rating || 0) >= 5), daysSilent: c.lastContactedAt ? Math.floor((now - new Date(c.lastContactedAt)) / DAY) : null, phone: c.phone, avatarUrl: c.avatarUrl, status: c.status })),
      upcomingClosings: closingDeals,
      closingAppointments: upcomingClosingAppts,
      deadlines: deadlines.slice(0, 6),
    },
    inbox: {
      unreadConversations: convAgg._count._all || 0,
      unreadMessages: convAgg._sum.unreadCount || 0,
      missedCalls: missedCount,
      recentUnread: recentUnread.map((c) => ({
        id: c.id, clientId: c.clientId, channel: c.channel, preview: c.lastMessagePreview, at: c.lastMessageAt, unread: c.unreadCount,
        name: c.isGroup ? (c.groupName || c.displayName || 'Group') : (c.client ? clientName(c.client) : (c.displayName || c.handle)),
        avatarUrl: c.client ? c.client.avatarUrl : null, whale: !!(c.client && c.client.isWhale),
      })),
      recentMissed: missed.map((m) => ({ id: m.id, clientId: m.clientId, name: m.client ? clientName(m.client) : m.fromNumber, status: m.status, at: m.startedAt, avatarUrl: m.client ? m.client.avatarUrl : null })),
    },
  });
}));

module.exports = router;

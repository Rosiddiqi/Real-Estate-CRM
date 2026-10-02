// /api/commissions — the money scoreboard + the agent's pay plan.
//   GET  /api/commissions/summary          → { mtd:{sides,gci,net,volume,closings,…}, ytd, lastMonth, capYear,
//                                              projected:{weighted, unweighted, eom, byMonth[]}, goals, cap,
//                                              pending[], pendingTotal, series[], history[], referrals, plan }
//   GET  /api/commissions/pay-plan         → { payPlan, capState }
//   PUT  /api/commissions/pay-plan         → { payPlan }   (upserts the active plan)
//   POST /api/commissions/pay-plan/parse   { text? , url? } → { draft, found, source, summary }  (ICA → draft, never saved)
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ah, parse } = require('../lib/http');
const { commissionsSummary } = require('../services/pipeline/summary');
const { getActivePlanRow, planFromRow, pricingContext } = require('../services/pipeline/plan');
const { parseIca } = require('../services/pipeline/ica');

const router = express.Router();

router.get('/summary', ah(async (req, res) => {
  res.json(await commissionsSummary(req.workspaceId));
}));

function planPayload(row, px) {
  const p = planFromRow(row);
  return {
    id: row ? row.id : null,
    name: p.name,
    planType: p.planType,
    defaultBuyerRate: p.defaultBuyerRate,
    defaultListingRate: p.defaultListingRate,
    agentSplit: p.agentSplit,
    capAmount: p.capAmount,
    capAnniversary: p.capAnniversary,
    postCapSplit: p.postCapSplit,
    transactionFee: p.transactionFee,
    postCapTransactionFee: p.postCapTransactionFee,
    franchisePct: p.franchisePct,
    franchiseCap: p.franchiseCap,
    teamLeadPct: p.teamLeadPct,
    tiers: p.tiers,
    goals: p.goals,
    effectiveFrom: row ? row.effectiveFrom : null,
    updatedAt: row ? row.updatedAt : null,
    capState: px ? {
      start: px.cap.start, end: px.cap.end, anniversary: px.cap.anniversary,
      gciYtd: Math.round(px.cap.ytd.gci), companyPaid: Math.round(px.cap.ytd.company), franchisePaid: Math.round(px.cap.ytd.franchise),
      closings: px.cap.totals.closings,
    } : null,
  };
}

router.get('/pay-plan', ah(async (req, res) => {
  const [row, px] = await Promise.all([getActivePlanRow(req.workspaceId), pricingContext(req.workspaceId)]);
  const payPlan = planPayload(row, px);
  res.json({ payPlan, capState: payPlan.capState });
}));

const frac = z.union([z.number(), z.string()]).nullable().optional();
const dollars = z.union([z.number(), z.string()]).nullable().optional();
const PlanBody = z.object({
  name: z.string().max(120).optional(),
  planType: z.enum(['split_cap', 'tiered', 'flat_fee', '100pct']).optional(),
  defaultBuyerRate: frac,
  defaultListingRate: frac,
  agentSplit: frac,
  capAmount: dollars,
  capAnniversary: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
  postCapSplit: frac,
  transactionFee: dollars,
  postCapTransactionFee: dollars,
  franchisePct: frac,
  franchiseCap: dollars,
  teamLeadPct: frac,
  tiers: z.array(z.object({ fromGci: z.union([z.number(), z.string()]), agentSplit: z.union([z.number(), z.string()]) })).max(12).nullable().optional(),
  goals: z.record(z.union([z.number(), z.string(), z.null()])).nullable().optional(),
});

const toFrac = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace('%', ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
};
const toDollars = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

router.put('/pay-plan', ah(async (req, res) => {
  const b = parse(PlanBody, req.body || {});
  const data = {};
  if (b.name !== undefined) data.name = b.name || 'My plan';
  if (b.planType !== undefined) data.planType = b.planType;
  for (const k of ['defaultBuyerRate', 'defaultListingRate', 'agentSplit', 'postCapSplit', 'franchisePct', 'teamLeadPct']) {
    if (b[k] !== undefined) {
      const v = toFrac(b[k]);
      if (v != null) data[k] = Math.min(1, v);
      else if (k === 'franchisePct' || k === 'teamLeadPct') data[k] = 0;
    }
  }
  for (const k of ['capAmount', 'franchiseCap']) if (b[k] !== undefined) data[k] = toDollars(b[k]) || null;
  for (const k of ['transactionFee', 'postCapTransactionFee']) if (b[k] !== undefined) data[k] = toDollars(b[k]) || 0;
  if (b.capAnniversary !== undefined) data.capAnniversary = b.capAnniversary || '01-01';
  if (b.tiers !== undefined) {
    data.tiers = (b.tiers || [])
      .map((t) => ({ fromGci: toDollars(t.fromGci) || 0, agentSplit: Math.min(1, toFrac(t.agentSplit) ?? 0) }))
      .sort((x, y) => x.fromGci - y.fromGci);
  }
  if (b.goals !== undefined) {
    const g = {};
    for (const [k, v] of Object.entries(b.goals || {})) {
      const n = toDollars(v);
      if (n != null) g[k] = k.toLowerCase().includes('sides') ? Math.round(parseFloat(String(v)) * 10) / 10 : n;
    }
    data.goals = g;
  }
  const existing = await getActivePlanRow(req.workspaceId);
  const row = existing
    ? await prisma.payPlan.update({ where: { id: existing.id }, data })
    : await prisma.payPlan.create({ data: { workspaceId: req.workspaceId, userId: req.userId, ...data } });
  const px = await pricingContext(req.workspaceId);
  res.json({ payPlan: planPayload(row, px) });
}));

const ParseBody = z.object({ text: z.string().max(200000).optional(), url: z.string().max(1000).optional() });

router.post('/pay-plan/parse', ah(async (req, res) => {
  const b = parse(ParseBody, req.body || {});
  res.json(await parseIca({ workspaceId: req.workspaceId, text: b.text, url: b.url }));
}));

module.exports = router;

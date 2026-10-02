// /api/deals — deal CRUD + stage transitions. Every write goes through
// services/pipeline/deals.js (the one transition service); this file only
// parses requests and shapes responses.
//
//   GET    /api/deals?clientId=&stage=&open=1&closed=1&includeArchived=1&track=&side=&board=1&limit=
//   GET    /api/deals/:id            → { deal } (+ events)
//   POST   /api/deals                → { deal }            201
//   PATCH  /api/deals/:id            → { deal }            (a `stage` runs the transition)
//   DELETE /api/deals/:id            → { ok, id }
//   POST   /api/deals/:id/move       { stage, track?, closedAt?, commission?, grossCommission? } → { deal, transition }
//   POST   /api/deals/:id/close      { closedAt?, commission?, grossCommission? } → { deal }
//   POST   /api/deals/:id/lost       { reason, note? } → { deal }
//   POST   /api/deals/:id/reopen     { stage? } → { deal }
//   PATCH  /api/deals/:id/client     { rating?, isWhale? } → { deal }   (card shortcut)
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../lib/http');
const deals = require('../services/pipeline/deals');
const S = require('../services/pipeline/stages');

const router = express.Router();

const truthy = (v) => v === '1' || v === 'true' || v === true;

const money = z.union([z.number(), z.string()]).nullable().optional();
const rate = z.union([z.number(), z.string()]).nullable().optional();
const date = z.union([z.string(), z.null()]).optional();
const str = z.string().max(4000).nullable().optional();

const DealFields = {
  title: str,
  side: z.enum(S.SIDE_IDS).optional(),
  inventoryType: z.enum(S.INVENTORY_IDS).optional(),
  track: z.enum(['main', 'new_dev']).optional(),
  stage: z.string().max(60).optional(),
  subStatus: str,
  position: z.number().optional(),
  listingId: str,
  portfolioPropertyId: str,
  propertyAddress: str,
  propertyLabel: str,
  shortlist: z.array(z.record(z.any())).max(30).nullable().optional(),
  price: money,
  listPrice: money,
  contractPrice: money,
  salePrice: money,
  sideRate: rate,
  listRate: rate,
  buyRate: rate,
  commissionFlat: money,
  splitShare: z.union([z.number(), z.string()]).nullable().optional(),
  referralOutPct: rate,
  coopBonus: money,
  monthlyRent: money,
  grossCommission: money,
  commission: money,
  contractDate: date,
  closingDate: date,
  inspectionDeadline: date,
  appraisalDeadline: date,
  financingDeadline: date,
  contingencies: z.record(z.any()).nullable().optional(),
  finishSelectionDue: date,
  estCompletion: date,
  depositSchedule: z.record(z.any()).nullable().optional(),
  linkedDealId: str,
  lenderName: str,
  titleCompany: str,
  coAgentName: str,
  coAgentBrokerage: str,
  leadSource: str,
  lostReason: str,
  lostNote: str,
  closedAt: date,
  notes: str,
  extras: z.record(z.any()).nullable().optional(),
  client: z.object({ rating: z.number().int().min(0).max(5).optional(), isWhale: z.boolean().optional() }).optional(),
};

const CreateBody = z.object({ clientId: z.string().min(1), ...DealFields });
const PatchBody = z.object({ clientId: z.string().min(1).optional(), ...DealFields });
const MoveBody = z.object({
  stage: z.string().min(1).max(60),
  track: z.enum(['main', 'new_dev']).optional(),
  subStatus: str,
  closedAt: date,
  commission: money,
  grossCommission: money,
  lostReason: str,
  lostNote: str,
});
const CloseBody = z.object({ closedAt: date, commission: money, grossCommission: money });
const LostBody = z.object({ reason: z.string().max(500).optional(), note: z.string().max(4000).optional() });
const ReopenBody = z.object({ stage: z.string().max(60).optional() });
const ClientBody = z.object({ rating: z.number().int().min(0).max(5).optional(), isWhale: z.boolean().optional() });

router.get('/', ah(async (req, res) => {
  const q = req.query;
  const out = await deals.listDeals({
    workspaceId: req.workspaceId,
    clientId: q.clientId || undefined,
    stage: q.stage || undefined,
    open: truthy(q.open),
    closed: truthy(q.closed),
    includeArchived: truthy(q.includeArchived),
    board: truthy(q.board),
    track: q.track || undefined,
    side: q.side || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    limit: q.limit,
  });
  res.json(out);
}));

router.get('/:id', ah(async (req, res) => {
  const deal = await deals.getDeal(req.params.id, { workspaceId: req.workspaceId, withEvents: truthy(req.query.events ?? '1') });
  res.json({ deal });
}));

router.post('/', ah(async (req, res) => {
  const body = parse(CreateBody, req.body || {});
  const deal = await deals.createDeal({ ...body, workspaceId: req.workspaceId, actor: 'agent' });
  res.status(201).json({ deal });
}));

router.patch('/:id', ah(async (req, res) => {
  const body = parse(PatchBody, req.body || {});
  const deal = await deals.updateDeal(req.params.id, body, { workspaceId: req.workspaceId, actor: 'agent' });
  res.json({ deal });
}));

router.patch('/:id/client', ah(async (req, res) => {
  const body = parse(ClientBody, req.body || {});
  const deal = await deals.updateDeal(req.params.id, { client: body }, { workspaceId: req.workspaceId, actor: 'agent' });
  res.json({ deal });
}));

router.delete('/:id', ah(async (req, res) => {
  const out = await deals.deleteDeal(req.params.id, { workspaceId: req.workspaceId });
  res.json({ ok: true, ...out });
}));

router.post('/:id/move', ah(async (req, res) => {
  const body = parse(MoveBody, req.body || {});
  if (!S.canonicalize(body.stage, 'buyer') && !S.isNewDevStage(body.stage)) throw new HttpError(400, `Unknown stage "${body.stage}"`);
  const before = await deals.getDeal(req.params.id, { workspaceId: req.workspaceId });
  const deal = await deals.moveDeal(req.params.id, body.stage, { ...body, workspaceId: req.workspaceId, actor: 'agent' });
  res.json({
    deal,
    transition: { from: before.stage, to: deal.stage, changed: before.stage !== deal.stage, closed: before.stage !== 'closed' && deal.stage === 'closed' },
  });
}));

router.post('/:id/close', ah(async (req, res) => {
  const body = parse(CloseBody, req.body || {});
  const deal = await deals.closeDeal(req.params.id, { ...body, workspaceId: req.workspaceId, actor: 'agent' });
  res.json({ deal });
}));

router.post('/:id/lost', ah(async (req, res) => {
  const body = parse(LostBody, req.body || {});
  const deal = await deals.markLost(req.params.id, { reason: body.reason, note: body.note, workspaceId: req.workspaceId, actor: 'agent' });
  res.json({ deal });
}));

router.post('/:id/reopen', ah(async (req, res) => {
  const body = parse(ReopenBody, req.body || {});
  const deal = await deals.reopenDeal(req.params.id, { stage: body.stage, workspaceId: req.workspaceId, actor: 'agent' });
  res.json({ deal });
}));

module.exports = router;

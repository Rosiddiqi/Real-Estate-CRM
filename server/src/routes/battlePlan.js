// /api/battle-plan — the daily plan (rail items + AI moves), the To-Do board,
// move actions, training (👍/👎, coach, suppressions) and self-rules.
const express = require('express');
const { z } = require('zod');
const { ah, parse } = require('../lib/http');
const bp = require('../services/battlePlan');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/battle-plan?date=YYYY-MM-DD  (omit = today in the agent's zone)
router.get('/', ah(async (req, res) => {
  const date = DATE_RE.test(String(req.query.date || '')) ? req.query.date : null;
  res.json(await bp.getPlanPayload({ workspaceId: req.workspaceId, userId: req.userId, date }));
}));

// The standing To-Do list: tasks + suggestions + done today + AI moves (today + tomorrow).
router.get('/todo', ah(async (req, res) => {
  res.json(await bp.getTodoBoard({ workspaceId: req.workspaceId, userId: req.userId }));
}));

// POST /api/battle-plan/replan { date? } — force-regenerate (refresh ≡ replan).
const ReplanBody = z.object({ date: z.string().regex(DATE_RE).optional(), tz: z.string().optional(), instruction: z.string().optional() }).passthrough();
async function replan(req, res) {
  const body = parse(ReplanBody, req.body || {});
  const ctx = await bp.userContext(req.workspaceId, req.userId);
  const { dayKey } = require('../lib/dates');
  const date = body.date || dayKey(new Date(), ctx.tz);
  await bp.generatePlanDay({ workspaceId: req.workspaceId, userId: req.userId, date, force: true, reason: 'replan' });
  res.json({ ok: true, toast: null, plan: await bp.getPlanPayload({ workspaceId: req.workspaceId, userId: req.userId, date }) });
}
router.post('/replan', ah(replan));
router.post('/refresh', ah(replan));

// Item actions. Ids: '<moveId>' | 'appt-<id>' | 'task-<id>' | 'routine-…'
const ActionBody = z.object({
  reason: z.string().max(280).optional(),
  startMin: z.number().int().min(0).max(1439).optional(),
  durationMin: z.number().int().min(5).max(720).optional(),
}).passthrough();
const ACTIONS = { done: 'done', markDone: 'done', complete: 'done', dismiss: 'dismiss', skip: 'skip', retime: 'retime', time: 'retime', move: 'retime', reopen: 'reopen' };
async function itemAction(req, res) {
  const action = ACTIONS[req.params.action];
  if (!action) return res.status(400).json({ error: `Unknown action ${req.params.action}` });
  const body = parse(ActionBody, req.body || {});
  if (action === 'retime' && body.startMin == null) return res.status(400).json({ error: 'startMin is required' });
  res.json(await bp.actOnItem({ workspaceId: req.workspaceId, userId: req.userId, itemId: req.params.id, action, body }));
}
router.post('/items/:id/:action', ah(itemAction));
router.post('/moves/:id/:action', ah(itemAction));

// 👍 / 👎 training. { moveId, isCorrect, reasons?, note?, mute?, kind?, feedback? }
const FeedbackBody = z.object({
  moveId: z.string().optional(),
  contextId: z.string().optional(),
  isCorrect: z.boolean(),
  reasons: z.array(z.string().max(80)).max(10).optional(),
  note: z.string().max(1000).optional(),
  mute: z.boolean().optional(),
  kind: z.enum(['move', 'todo_suggestion']).optional(),
  feedback: z.string().max(1000).optional(),
});
router.post('/feedback', ah(async (req, res) => {
  const b = parse(FeedbackBody, req.body || {});
  res.status(201).json(await bp.recordFeedback({
    workspaceId: req.workspaceId, userId: req.userId, moveId: b.moveId || b.contextId || null,
    isCorrect: b.isCorrect, reasons: b.reasons || [], note: b.note || '', mute: !!b.mute, kind: b.kind || 'move', feedback: b.feedback,
  }));
}));

// "Tell AI why" → classified suppression (AI, deterministic fallback).
const CoachBody = z.object({ clientId: z.string(), note: z.string().min(1).max(1200), moveId: z.string().optional(), itemId: z.string().optional() });
router.post('/coach', ah(async (req, res) => {
  const b = parse(CoachBody, req.body || {});
  const out = await bp.coach({ workspaceId: req.workspaceId, userId: req.userId, clientId: b.clientId, note: b.note, moveId: b.moveId || b.itemId || null });
  res.status(out.handled ? 201 : 200).json(out);
}));

// Suppressions ("don't suggest this person").
router.get('/suppressions', ah(async (req, res) => {
  res.json({ suppressions: await bp.listSuppressions({ workspaceId: req.workspaceId, userId: req.userId }) });
}));
const SuppressBody = z.object({ clientId: z.string(), reason: z.string().min(1).max(500), durationDays: z.number().int().min(1).max(365).nullable().optional() });
router.post('/suppress', ah(async (req, res) => {
  const b = parse(SuppressBody, req.body || {});
  res.status(201).json(await bp.suppress({ workspaceId: req.workspaceId, userId: req.userId, clientId: b.clientId, reason: b.reason, durationDays: b.durationDays ?? null }));
}));
router.delete('/suppress/:clientId', ah(async (req, res) => {
  res.json(await bp.unsuppress({ workspaceId: req.workspaceId, userId: req.userId, clientId: req.params.clientId }));
}));

// Self-rules (natural-language planner constraints).
router.get('/self-rules', ah(async (req, res) => {
  res.json({ rules: await bp.listRules({ userId: req.userId }) });
}));
router.post('/self-rules', ah(async (req, res) => {
  const b = parse(z.object({ text: z.string().min(1).max(280) }), req.body || {});
  res.status(201).json({ rule: await bp.addRule({ workspaceId: req.workspaceId, userId: req.userId, text: b.text }) });
}));
router.delete('/self-rules/:id', ah(async (req, res) => {
  res.json(await bp.removeRule({ workspaceId: req.workspaceId, userId: req.userId, id: req.params.id }));
}));

module.exports = router;

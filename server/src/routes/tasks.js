// /api/tasks — to-dos and client tasks (YOUR LIST / SERENA SUGGESTS / DONE).
// /api/todos is an alias of this router.
const express = require('express');
const { z } = require('zod');
const { ah, parse } = require('../lib/http');
const tasks = require('../services/tasks');
const bp = require('../services/battlePlan');

const router = express.Router();

// GET /api/tasks?clientId=&open=1&status=&source=&completedSince=&limit=
//     /api/tasks?view=todo → the To-Do board (tasks · suggested · done · moves)
router.get('/', ah(async (req, res) => {
  const q = req.query;
  if (q.view === 'todo') return res.json(await bp.getTodoBoard({ workspaceId: req.workspaceId, userId: req.userId }));
  res.json(await tasks.listTasks({
    workspaceId: req.workspaceId,
    clientId: q.clientId || undefined,
    open: q.open === '1' || q.open === 'true',
    status: q.status || undefined,
    source: q.source || undefined,
    completedSince: q.completedSince || undefined,
    dueFrom: q.dueFrom || undefined,
    dueTo: q.dueTo || undefined,
    limit: parseInt(q.limit, 10) || 200,
  }));
}));

const priority = z.union([z.number().int().min(-1).max(2), z.enum(['low', 'normal', 'high', 'urgent'])]);
const CreateBody = z.object({
  title: z.string().min(1).max(280),
  clientId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  listingId: z.string().nullable().optional(),
  kind: z.string().max(30).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(5).max(600).nullable().optional(),
  priority: priority.optional(),
  status: z.enum(['pending', 'suggested']).optional(),
  source: z.string().max(30).optional(),
  notes: z.string().max(4000).nullable().optional(),
  meta: z.any().optional(),
  fromMoveId: z.string().optional(),
});

router.post('/', ah(async (req, res) => {
  const b = parse(CreateBody, req.body || {});
  const task = await tasks.createTask({
    workspaceId: req.workspaceId, userId: req.userId, title: b.title,
    clientId: b.clientId === undefined ? undefined : b.clientId, dealId: b.dealId || null, listingId: b.listingId || null,
    kind: b.kind || null, dueAt: b.dueAt || null, dueDate: b.dueDate || null, durationMin: b.durationMin || null,
    priority: b.priority, status: b.status || 'pending', source: b.source || (b.fromMoveId ? 'planner' : 'user'),
    notes: b.notes || null, meta: b.fromMoveId ? { ...(b.meta || {}), fromMoveId: b.fromMoveId } : (b.meta || null),
  });
  // Adding a planner move to YOUR LIST: the move is handled (14-day cooldown).
  if (b.fromMoveId) {
    await bp.actOnItem({ workspaceId: req.workspaceId, userId: req.userId, itemId: b.fromMoveId, action: 'skip', body: { reason: 'added to to-do list' } }).catch(() => {});
  }
  res.status(201).json({ task });
}));

const PatchBody = z.object({
  title: z.string().min(1).max(280).optional(),
  status: z.enum(['pending', 'suggested', 'done', 'dismissed', 'cancelled']).optional(),
  clientId: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(5).max(600).nullable().optional(),
  priority: priority.optional(),
  notes: z.string().max(4000).nullable().optional(),
  kind: z.string().max(30).nullable().optional(),
  meta: z.any().optional(),
});

router.patch('/:id', ah(async (req, res) => {
  const patch = parse(PatchBody, req.body || {});
  res.json({ task: await tasks.updateTask({ workspaceId: req.workspaceId, id: req.params.id, patch }) });
}));

router.post('/:id/complete', ah(async (req, res) => {
  res.json({ task: await tasks.completeTask({ workspaceId: req.workspaceId, id: req.params.id }) });
}));

router.delete('/:id', ah(async (req, res) => {
  res.json(await tasks.deleteTask({ workspaceId: req.workspaceId, id: req.params.id }));
}));

module.exports = router;

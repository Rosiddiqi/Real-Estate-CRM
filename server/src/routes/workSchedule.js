// /api/work-schedule — weekly hours, per-date overrides, routine blocks,
// content-block + lunch preferences, and the planner's sphere check-in opt-in.
// Any change re-plans today + tomorrow (deterministic, fast) in the background.
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { ah, parse } = require('../lib/http');
const { getSchedule, sanitizeRoutine, hhmmToMin, DAY_KEYS, DEFAULT_WEEKLY } = require('../services/battlePlan/schedule');
const bp = require('../services/battlePlan');

const router = express.Router();
const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DayBody = z.object({ start: HHMM.optional(), end: HHMM.optional(), off: z.boolean().optional() });
const OverrideBody = z.object({ start: HHMM.optional().nullable(), end: HHMM.optional().nullable(), off: z.boolean().optional(), bonus: z.boolean().optional(), note: z.string().max(120).optional().nullable() });
const BlockPrefs = z.object({ durationMin: z.number().int().min(15).max(240).optional(), preferredStart: HHMM.optional().nullable(), enabled: z.boolean().optional() });
const RoutineBlock = z.object({
  id: z.string().optional(), title: z.string().min(1).max(60), start: HHMM, durationMin: z.number().int().min(5).max(600),
  days: z.array(z.number().int().min(0).max(7)).optional(), kind: z.string().max(20).optional(),
});
const PutBody = z.object({
  weekly: z.record(DayBody).optional(),
  overrides: z.record(OverrideBody).optional(),
  routine: z.array(RoutineBlock).max(24).optional(),
  contentBlock: BlockPrefs.optional(),
  lunch: BlockPrefs.optional(),
  planner: z.object({ soiCheckins: z.boolean().optional(), soiDailyCap: z.number().int().min(1).max(10).optional() }).optional(),
});

function cleanDay(d, fallback) {
  const start = d.start ?? fallback.start; const end = d.end ?? fallback.end;
  const ok = hhmmToMin(start) != null && hhmmToMin(end) != null && hhmmToMin(end) > hhmmToMin(start);
  return { start: ok ? start : fallback.start, end: ok ? end : fallback.end, off: !!d.off };
}

async function payload(req) {
  const schedule = await getSchedule({ workspaceId: req.workspaceId, userId: req.userId });
  const ws = await prisma.workspace.findUnique({ where: { id: req.workspaceId }, select: { settings: true, timezone: true } });
  const planner = ((ws && ws.settings) || {}).battlePlan || {};
  // prune overrides older than 7 days from the response (kept in storage)
  return { schedule: { ...schedule, planner: { soiCheckins: !!planner.soiCheckins, soiDailyCap: planner.soiDailyCap || 3 } }, timeZone: (ws && ws.timezone) || null };
}

function replanSoon(req, reason) {
  hub.broadcast(req.workspaceId, 'plan_updated', { reason });
  bp.regenerateUpcoming({ workspaceId: req.workspaceId, userId: req.userId, reason })
    .catch((e) => console.warn('[workSchedule] replan failed:', e.message));
}

router.get('/', ah(async (req, res) => {
  res.json(await payload(req));
}));

router.put('/', ah(async (req, res) => {
  const b = parse(PutBody, req.body || {});
  const current = await getSchedule({ workspaceId: req.workspaceId, userId: req.userId });
  const data = {};
  if (b.weekly) {
    const weekly = { ...current.weekly };
    for (const k of DAY_KEYS) if (b.weekly[k]) weekly[k] = cleanDay(b.weekly[k], current.weekly[k] || DEFAULT_WEEKLY[k]);
    data.weekly = weekly;
  }
  if (b.overrides) {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const merged = {};
    for (const [date, ov] of Object.entries(b.overrides)) {
      if (!DATE.safeParse(date).success || date < cutoff) continue;
      merged[date] = { start: ov.start || null, end: ov.end || null, off: !!ov.off, bonus: !!ov.bonus, note: ov.note || null };
    }
    data.overrides = merged;
  }
  if (b.routine) data.routine = sanitizeRoutine(b.routine);
  if (b.contentBlock) data.contentBlock = { ...current.contentBlock, ...b.contentBlock };
  if (b.lunch) data.lunch = { ...current.lunch, ...b.lunch };
  if (Object.keys(data).length) {
    await prisma.workSchedule.update({ where: { userId: req.userId }, data });
  }
  if (b.planner) {
    const ws = await prisma.workspace.findUnique({ where: { id: req.workspaceId }, select: { settings: true } });
    const settings = (ws && ws.settings) || {};
    await prisma.workspace.update({ where: { id: req.workspaceId }, data: { settings: { ...settings, battlePlan: { ...(settings.battlePlan || {}), ...b.planner } } } });
  }
  replanSoon(req, 'work_schedule');
  res.json(await payload(req));
}));

// Per-date override (e.g. "working Sunday 10–2", "off Friday").
router.put('/override/:date', ah(async (req, res) => {
  const date = parse(DATE, req.params.date);
  const ov = parse(OverrideBody, req.body || {});
  const current = await getSchedule({ workspaceId: req.workspaceId, userId: req.userId });
  const overrides = { ...current.overrides, [date]: { start: ov.start || null, end: ov.end || null, off: !!ov.off, bonus: !!ov.bonus, note: ov.note || null } };
  await prisma.workSchedule.update({ where: { userId: req.userId }, data: { overrides } });
  replanSoon(req, 'work_schedule');
  res.json(await payload(req));
}));

router.delete('/override/:date', ah(async (req, res) => {
  const date = parse(DATE, req.params.date);
  const current = await getSchedule({ workspaceId: req.workspaceId, userId: req.userId });
  const overrides = { ...current.overrides };
  delete overrides[date];
  await prisma.workSchedule.update({ where: { userId: req.userId }, data: { overrides } });
  replanSoon(req, 'work_schedule');
  res.json(await payload(req));
}));

module.exports = router;

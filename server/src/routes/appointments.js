// /api/appointments — calendar CRUD, upcoming, AI briefing, showing outcomes.
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError } = require('../lib/http');
const calendar = require('../services/calendar');

const router = express.Router();

const iso = z.union([z.string(), z.date()]).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

// GET /api/appointments?clientId=&from=&to=&status=&type=&listingId=&limit=
router.get('/', ah(async (req, res) => {
  const q = req.query;
  res.json(await calendar.listAppointments({
    workspaceId: req.workspaceId,
    clientId: q.clientId || undefined,
    listingId: q.listingId || undefined,
    dealId: q.dealId || undefined,
    from: q.from || q.startDate || undefined,
    to: q.to || q.endDate || undefined,
    status: q.status || undefined,
    type: q.type || undefined,
    limit: Math.min(1000, parseInt(q.limit, 10) || 300),
    order: q.order === 'desc' ? 'desc' : 'asc',
  }));
}));

// GET /api/appointments/upcoming?limit=&withinHours=&clientId=
router.get('/upcoming', ah(async (req, res) => {
  res.json(await calendar.upcomingAppointments({
    workspaceId: req.workspaceId,
    clientId: req.query.clientId || undefined,
    limit: parseInt(req.query.limit, 10) || 10,
    withinHours: Number(req.query.withinHours) || 24 * 14,
  }));
}));

// Appointment type catalog (labels + default durations).
router.get('/types', (req, res) => {
  res.json({ types: Object.entries(calendar.TYPES).map(([id, t]) => ({ id, label: t.label, durationMin: t.duration })) });
});

router.get('/:id', ah(async (req, res) => {
  const appointment = await calendar.getAppointment({ workspaceId: req.workspaceId, id: req.params.id });
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  res.json({ appointment });
}));

const CreateBody = z.object({
  type: z.string().max(40).optional(),
  title: z.string().max(200).optional().nullable(),
  clientId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  listingId: z.string().optional().nullable(),
  startAt: iso,
  endAt: iso.optional().nullable(),
  durationMin: z.number().int().min(5).max(24 * 60).optional(),
  location: z.string().max(300).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  allDay: z.boolean().optional(),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled']).optional(),
  source: z.string().max(30).optional(),
  attendees: z.any().optional(),
  imageUrl: z.string().max(1000).optional().nullable(),
});

router.post('/', ah(async (req, res) => {
  const b = parse(CreateBody, req.body || {});
  const appointment = await calendar.createAppointment({
    ...b, workspaceId: req.workspaceId, userId: req.userId,
    clientId: b.clientId || null, listingId: b.listingId || null, dealId: b.dealId || null,
    endAt: b.endAt || null, source: b.source || 'user',
  });
  res.status(201).json({ appointment });
}));

const PatchBody = CreateBody.partial().extend({
  outcome: z.string().max(2000).optional().nullable(),
  followUpLoggedAt: iso.optional().nullable(),
  reminders: z.any().optional(),
});

router.patch('/:id', ah(async (req, res) => {
  const patch = parse(PatchBody, req.body || {});
  res.json({ appointment: await calendar.updateAppointment({ workspaceId: req.workspaceId, id: req.params.id, patch }) });
}));

router.delete('/:id', ah(async (req, res) => {
  res.json(await calendar.deleteAppointment({ workspaceId: req.workspaceId, id: req.params.id }));
}));

// AI pre-appointment relationship briefing (deterministic fallback).
router.get('/:id/briefing', ah(async (req, res) => {
  res.json({ briefing: await calendar.getBriefing({ workspaceId: req.workspaceId, id: req.params.id, refresh: req.query.refresh === '1' }) });
}));

// Showing outcome / feedback capture.
const OutcomeBody = z.object({ outcome: z.enum(Object.keys(calendar.OUTCOMES)).optional(), feedback: z.string().max(2000).optional() })
  .refine((b) => b.outcome || (b.feedback && b.feedback.trim()), 'Pick an outcome or write a note');
router.post('/:id/outcome', ah(async (req, res) => {
  const b = parse(OutcomeBody, req.body || {});
  res.json({ appointment: await calendar.logOutcome({ workspaceId: req.workspaceId, id: req.params.id, outcome: b.outcome, feedback: b.feedback }) });
}));

module.exports = router;

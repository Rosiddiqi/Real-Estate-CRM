// Appointment reminders — one in-app notification ~30 minutes before each
// scheduled/confirmed appointment (atomic claim on reminderSentAt, so a
// restart or overlapping tick never double-notifies). The bell deep-links to
// the appointment sheet via data.appointmentId.
const prisma = require('../lib/prisma');
const config = require('../config');
const { notify } = require('../lib/notify');
const { TYPES, normType } = require('../services/calendar');

module.exports = {
  name: 'appointment-reminders',
  schedule: '*/2 * * * *',
  async run() {
    const now = new Date();
    const due = await prisma.appointment.findMany({
      where: { status: { in: ['scheduled', 'confirmed'] }, reminderSentAt: null, startAt: { gt: now, lte: new Date(now.getTime() + 30 * 60000) } },
      take: 100,
    });
    if (!due.length) return;
    const ws = await prisma.workspace.findMany({ where: { id: { in: [...new Set(due.map((a) => a.workspaceId))] } }, select: { id: true, timezone: true } });
    const tzBy = new Map(ws.map((w) => [w.id, w.timezone || config.timezone]));
    for (const a of due) {
      const claim = await prisma.appointment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claim.count) continue;
      const tz = tzBy.get(a.workspaceId) || config.timezone;
      const at = new Date(a.startAt).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      const label = (TYPES[normType(a.type)] || TYPES.other).label;
      await notify({
        workspaceId: a.workspaceId,
        userId: a.userId || null,
        type: 'appointment',
        title: `${label} at ${at}`,
        body: [a.title, a.location].filter(Boolean).join(' · '),
        data: { appointmentId: a.id, clientId: a.clientId, kind: 'appointment_reminder' },
      });
    }
  },
};

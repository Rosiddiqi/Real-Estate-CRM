// Work schedule resolution (WorkSchedule row, one per user).
//
//   weekly:    { mon: { start:'09:00', end:'18:00', off:false }, … }
//   overrides: { '2026-10-03': { start, end, off, bonus, note } }
//   routine:   [{ id, title, start:'07:00', durationMin, days:[1..7] (ISO, Mon=1), kind }]
//   contentBlock: { durationMin:90, preferredStart:'10:00', enabled:true }
//   lunch:        { durationMin:45, preferredStart:'12:30', enabled:true }
const crypto = require('node:crypto');
const prisma = require('../../lib/prisma');
const { weekdayIndex } = require('../../lib/dates');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FALLBACK_WINDOW = { start: 9 * 60, end: 18 * 60 };

const DEFAULT_WEEKLY = {
  mon: { start: '09:00', end: '18:00', off: false },
  tue: { start: '09:00', end: '18:00', off: false },
  wed: { start: '09:00', end: '18:00', off: false },
  thu: { start: '09:00', end: '18:00', off: false },
  fri: { start: '09:00', end: '18:00', off: false },
  sat: { start: '10:00', end: '17:00', off: false },
  sun: { start: '11:00', end: '16:00', off: false },
};
const DEFAULT_CONTENT = { durationMin: 90, preferredStart: '10:00', enabled: true };
const DEFAULT_LUNCH = { durationMin: 45, preferredStart: '12:30', enabled: true };

function hhmmToMin(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}
function minToHHMM(min) {
  const h = Math.floor(min / 60); const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeSchedule(row) {
  const weekly = { ...DEFAULT_WEEKLY, ...((row && row.weekly) || {}) };
  return {
    id: row?.id || null,
    weekly,
    overrides: (row && row.overrides) || {},
    routine: Array.isArray(row?.routine) ? row.routine : [],
    contentBlock: { ...DEFAULT_CONTENT, ...((row && row.contentBlock) || {}) },
    lunch: { ...DEFAULT_LUNCH, ...((row && row.lunch) || {}) },
    known: !!row,
  };
}

async function getSchedule({ workspaceId, userId, create = true }) {
  let row = await prisma.workSchedule.findUnique({ where: { userId } });
  if (!row && create) {
    try {
      row = await prisma.workSchedule.create({
        data: { workspaceId, userId, weekly: DEFAULT_WEEKLY, contentBlock: DEFAULT_CONTENT, lunch: DEFAULT_LUNCH },
      });
    } catch {
      row = await prisma.workSchedule.findUnique({ where: { userId } });
    }
  }
  return normalizeSchedule(row);
}

// Effective working window for a calendar day.
// → { known, off, start, end, bonus, source: 'override'|'weekly'|'default' }
function resolveDay(schedule, dateKey) {
  const ov = schedule.overrides && schedule.overrides[dateKey];
  const dow = DAY_KEYS[weekdayIndex(dateKey)];
  const wk = schedule.weekly && schedule.weekly[dow];
  if (ov) {
    if (ov.off) return { known: true, off: true, start: null, end: null, bonus: false, source: 'override', note: ov.note || null };
    const start = hhmmToMin(ov.start) ?? hhmmToMin(wk?.start) ?? FALLBACK_WINDOW.start;
    const end = hhmmToMin(ov.end) ?? hhmmToMin(wk?.end) ?? FALLBACK_WINDOW.end;
    if (end > start) return { known: true, off: false, start, end, bonus: !!ov.bonus || !!(wk && wk.off), source: 'override', note: ov.note || null };
  }
  if (wk) {
    if (wk.off) return { known: true, off: true, start: null, end: null, bonus: false, source: 'weekly' };
    const start = hhmmToMin(wk.start); const end = hhmmToMin(wk.end);
    if (start != null && end != null && end > start) return { known: true, off: false, start, end, bonus: false, source: 'weekly' };
  }
  return { known: false, off: false, ...FALLBACK_WINDOW, bonus: false, source: 'default' };
}

// ISO weekday 1..7 (Mon=1 … Sun=7) for a date key. Routine `days` use this;
// a stray 0 is treated as Sunday.
function isoWeekday(dateKey) {
  const d = weekdayIndex(dateKey);
  return d === 0 ? 7 : d;
}

const LUNCH_RE = /lunch|brunch|\bmeal\b|\beat\b|\bfood\b/i;

function routineFor(schedule, dateKey) {
  const iso = isoWeekday(dateKey);
  return (schedule.routine || [])
    .filter((b) => b && b.start && (!Array.isArray(b.days) || b.days.length === 0
      || b.days.map((x) => (Number(x) === 0 ? 7 : Number(x))).includes(iso)))
    .map((b) => {
      const start = hhmmToMin(b.start);
      const dur = Math.max(5, Math.min(600, Number(b.durationMin) || 30));
      return {
        id: b.id || crypto.createHash('sha1').update(`${b.title}|${b.start}`).digest('hex').slice(0, 10),
        title: b.title || 'Routine',
        startMin: start,
        durationMin: dur,
        kind: b.kind || (LUNCH_RE.test(b.title || '') ? 'lunch' : 'routine'),
        isLunch: b.kind === 'lunch' || LUNCH_RE.test(b.title || ''),
      };
    })
    .filter((b) => b.startMin != null)
    .sort((a, b) => a.startMin - b.startMin);
}

function sanitizeRoutine(list) {
  return (Array.isArray(list) ? list : []).slice(0, 24).map((b) => ({
    id: b.id || crypto.randomUUID(),
    title: String(b.title || 'Routine').slice(0, 60),
    start: minToHHMM(Math.max(0, Math.min(1439, hhmmToMin(b.start) ?? 420))),
    durationMin: Math.max(5, Math.min(600, Number(b.durationMin) || 30)),
    days: Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort() : [1, 2, 3, 4, 5, 6, 7],
    kind: ['routine', 'lunch', 'gym', 'family', 'commute', 'personal'].includes(b.kind) ? b.kind : (LUNCH_RE.test(b.title || '') ? 'lunch' : 'routine'),
  })).sort((a, b) => a.start.localeCompare(b.start));
}

module.exports = {
  getSchedule, resolveDay, routineFor, normalizeSchedule, sanitizeRoutine,
  hhmmToMin, minToHHMM, isoWeekday, LUNCH_RE, DAY_KEYS, DEFAULT_WEEKLY, DEFAULT_CONTENT, DEFAULT_LUNCH,
};

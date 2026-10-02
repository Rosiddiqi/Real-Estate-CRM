// Time-zone-aware day math. NEVER compute "today" in server-local or UTC —
// always in the agent's zone (workspace.timezone / user.timezone).
const DEFAULT_TZ = require('../config').timezone;

function partsIn(date, tz = DEFAULT_TZ) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day,
    hour: +o.hour % 24, minute: +o.minute, second: +o.second, weekday: o.weekday,
  };
}

// 'YYYY-MM-DD' for a Date in tz
function dayKey(date = new Date(), tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Offset (minutes) of tz at a given instant: localTime - UTC
function tzOffsetMin(date, tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Instant for a wall-clock time in tz: zonedTime('2026-10-02', 9, 30, tz)
function zonedTime(dayStr, hour = 0, minute = 0, tz = DEFAULT_TZ) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const off = tzOffsetMin(guess, tz);
  const t = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffsetMin(t, tz); // DST edge correction
  return off2 === off ? t : new Date(guess.getTime() - off2 * 60000);
}

function dayBounds(dayStr, tz = DEFAULT_TZ) {
  const start = zonedTime(dayStr, 0, 0, tz);
  const [y, m, d] = dayStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedTime(next.toISOString().slice(0, 10), 0, 0, tz);
  return { start, end };
}

function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Minutes since local midnight for an instant in tz
function minuteOfDay(date, tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  return p.hour * 60 + p.minute;
}

function weekdayIndex(dayStr) { // 0=Sun..6=Sat
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function monthBounds(date = new Date(), tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  const first = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
  const nextMonth = p.month === 12 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, '0')}-01`;
  return { start: zonedTime(first, 0, 0, tz), end: zonedTime(nextMonth, 0, 0, tz) };
}

function yearBounds(date = new Date(), tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  return { start: zonedTime(`${p.year}-01-01`, 0, 0, tz), end: zonedTime(`${p.year + 1}-01-01`, 0, 0, tz) };
}

module.exports = { partsIn, dayKey, tzOffsetMin, zonedTime, dayBounds, addDays, minuteOfDay, weekdayIndex, monthBounds, yearBounds };

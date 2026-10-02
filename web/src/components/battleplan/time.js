// Time helpers for the Battle Plan rail (minute-of-day math, labels).

// "8:30 AM" / "8 AM" — whole hours drop the :00.
export const fmtMin = (m) => {
  if (m == null || Number.isNaN(m)) return '';
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60); const r = mm % 60;
  const a = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return r ? `${h12}:${String(r).padStart(2, '0')} ${a}` : `${h12} ${a}`;
};

export const durLabel = (d) => {
  if (!d) return '';
  if (d < 60) return `${d}m`;
  const h = Math.floor(d / 60); const m = d % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const hhmmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const minToHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Date key YYYY-MM-DD of an instant, in the agent's zone (see setAgentTz).
export function dateKey(d = new Date()) { return keyIn(d); }
// Calendar key from y / month index / day (no instant involved).
export function calKey(y, m, d) {
  const x = new Date(Date.UTC(y, m, d));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
// A Date holding the calendar day of a key (device-local noon) — for labels
// (weekday / month names) and calendar math only, never as an instant.
export function keyToDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function shiftKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  return calKey(y, m - 1, d + days);
}
// Minute of the day of an instant, in the agent's zone.
export const minuteOfDay = (d) => minIn(d);

// "FRIDAY OCTOBER 2" (rail header eyebrow — no comma)
export const dateLine = (d) => `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getDate()}`.toUpperCase();

export function weekdayKey(key) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][keyToDate(key).getDay()];
}

// Work window for a date from the schedule payload (weekly + overrides).
export function resolveWindow(schedule, key) {
  if (!schedule) return null;
  const ov = schedule.overrides && schedule.overrides[key];
  const wk = schedule.weekly && schedule.weekly[weekdayKey(key)];
  if (ov) {
    if (ov.off) return { off: true, override: true };
    const s = hhmmToMin(ov.start || (wk && wk.start)); const e = hhmmToMin(ov.end || (wk && wk.end));
    if (s != null && e != null && e > s) return { start: s, end: e, override: true, bonus: !!ov.bonus };
  }
  if (wk) {
    if (wk.off) return { off: true };
    const s = hhmmToMin(wk.start); const e = hhmmToMin(wk.end);
    if (s != null && e != null && e > s) return { start: s, end: e };
  }
  return null;
}

// "9-6" compact hours label for calendar cells.
export function compactHours(w) {
  if (!w || w.off || w.start == null) return null;
  const f = (min) => { const h = Math.floor(min / 60); const m = min % 60; const h12 = (h % 12) || 12; return m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12}`; };
  return `${f(w.start)}-${f(w.end)}`;
}

// ── Agent time zone ──────────────────────────────────────────────────────
// The plan, appointments and "today" are computed on the server in the
// agent's zone (user.timezone || workspace.timezone). The client renders in
// that same zone — not the device's — so the NOW line, the 7 PM flip and
// every tile agree with the server even when the phone is elsewhere.
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/New_York'; } })();
let AGENT_TZ = LOCAL_TZ;
export function setAgentTz(tz) { if (tz) AGENT_TZ = tz; }
export function agentTz() { return AGENT_TZ; }

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }));
  }
  return fmtCache.get(tz);
}
export function partsIn(date, tz = AGENT_TZ) {
  const o = {};
  const x = new Date(date);
  if (Number.isNaN(x.getTime())) return { y: NaN, m: NaN, d: NaN, h: NaN, min: NaN };
  let f;
  try { f = partsFmt(tz); } catch { f = partsFmt(LOCAL_TZ); } // unknown zone → device
  for (const p of f.formatToParts(x)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, min: +o.minute };
}
export function keyIn(date, tz = AGENT_TZ) {
  const p = partsIn(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function minIn(date, tz = AGENT_TZ) { const p = partsIn(date, tz); return p.h * 60 + p.min; }
export function hourIn(date, tz = AGENT_TZ) { return partsIn(date, tz).h; }
export function todayIn(tz = AGENT_TZ) { return keyIn(new Date(), tz); }
// Instant for a wall-clock minute on a date key in tz (DST-safe).
export function zonedDate(key, minute, tz = AGENT_TZ) {
  const [y, m, d] = String(key).split('-').map(Number);
  const h = Math.floor(minute / 60); const mm = minute % 60;
  const guess = Date.UTC(y, m - 1, d, h, mm);
  if (!Number.isFinite(guess)) return new Date(NaN);
  const offAt = (t) => { const p = partsIn(new Date(t), tz); return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - t) / 60000; };
  const off = offAt(guess);
  let t = guess - off * 60000;
  const off2 = offAt(t);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
// "Fri, Oct 2" for an instant, in tz
export function dayLabelIn(date, tz = AGENT_TZ, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(date).toLocaleDateString('en-US', { ...opts, timeZone: tz });
}

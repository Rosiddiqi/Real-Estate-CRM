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

// Local date key YYYY-MM-DD.
export function dateKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function keyToDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function shiftKey(key, days) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
export const minuteOfDay = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };

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

// Natural-language day/time resolution in the agent's time zone. The model
// (and the offline router) pass loose phrases — "tomorrow", "Friday",
// "10/14", "2pm", "14:30", "after lunch" — and the SERVER resolves the instant,
// so nobody does time-zone math in a prompt.
const { dayKey, zonedTime, addDays, weekdayIndex, partsIn } = require('../../lib/dates');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function todayKey(tz) { return dayKey(new Date(), tz); }

// → 'YYYY-MM-DD' or null
function parseDay(input, tz) {
  if (!input) return null;
  const s = String(input).toLowerCase().trim();
  const today = todayKey(tz);
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(s)) return today;
  if (/\b(day after tomorrow)\b/.test(s)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) return addDays(today, 1);
  if (/\byesterday\b/.test(s)) return addDays(today, -1);
  if ((m = /\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/.exec(s))) {
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const n = words[m[1]] || parseInt(m[1], 10) || 1;
    return addDays(today, /week/.test(m[2]) ? n * 7 : n);
  }
  if (/\bnext week\b/.test(s)) {
    const wd = weekdayIndex(today);
    return addDays(today, ((8 - wd) % 7) || 7); // next Monday
  }
  if (/\b(this )?weekend\b/.test(s)) {
    const wd = weekdayIndex(today);
    return addDays(today, wd === 6 ? 0 : wd === 0 ? 0 : 6 - wd);
  }
  // weekday names ("friday", "next tue")
  const wdMatch = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/.exec(s);
  if (wdMatch) {
    const name = wdMatch[2];
    const target = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : WD_SHORT[name];
    if (target != null) {
      // The coming occurrence; naming today's weekday means a week out.
      const wd = weekdayIndex(today);
      const delta = (target - wd + 7) % 7;
      return addDays(today, delta === 0 ? 7 : delta);
    }
  }
  // "10/14", "10/14/2026"
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
    let key = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    if (!m[3] && key < today) key = `${y + 1}${key.slice(4)}`;
    return key;
  }
  // "oct 14", "october 14th", "14 oct"
  if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s))
    || (m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/.exec(s))) {
    const monTok = /\d/.test(m[1]) ? m[2] : m[1];
    const dayTok = /\d/.test(m[1]) ? m[1] : m[2];
    const mon = MONTHS.indexOf(monTok.slice(0, 3)) + 1;
    const y = Number(today.slice(0, 4));
    let key = `${y}-${String(mon).padStart(2, '0')}-${String(dayTok).padStart(2, '0')}`;
    if (key < today) key = `${y + 1}${key.slice(4)}`;
    return key;
  }
  return null;
}

// → { h, m } or null. Bare hours 1–7 read as PM (business hours), 8–11 as AM.
function parseTime(input) {
  if (!input) return null;
  const s = String(input).toLowerCase().trim();
  let m;
  if (/\bnoon\b/.test(s)) return { h: 12, m: 0 };
  if (/\bmidnight\b/.test(s)) return { h: 0, m: 0 };
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
  if ((m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/.exec(s))) {
    let h = Number(m[1]) % 12;
    if (/p/.test(m[3])) h += 12;
    return { h, m: Number(m[2] || 0) };
  }
  if ((m = /\b(?:at|@|by|around|for)\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:days?|weeks?|mins?|minutes?|hours?|\/|bd|ba|beds?|baths?|sq))/.exec(s))) {
    let h = Number(m[1]);
    if (h >= 1 && h <= 7) h += 12;
    if (h > 23) return null;
    return { h, m: Number(m[2] || 0) };
  }
  if ((m = /\b(\d{1,2}):(\d{2})\b/.exec(s))) {
    let h = Number(m[1]);
    if (h >= 1 && h <= 7) h += 12;
    return { h: Math.min(23, h), m: Number(m[2]) };
  }
  if (/\bmorning\b/.test(s)) return { h: 9, m: 0 };
  if (/\bafter lunch\b/.test(s)) return { h: 13, m: 30 };
  if (/\blunch\b/.test(s)) return { h: 12, m: 0 };
  if (/\bafternoon\b/.test(s)) return { h: 14, m: 0 };
  if (/\b(evening|tonight)\b/.test(s)) return { h: 18, m: 0 };
  if (/\b(end of (the )?day|eod)\b/.test(s)) return { h: 17, m: 0 };
  return null;
}

// Resolve a {date, time} pair (either may be loose text) to a Date instant in tz.
// An ISO datetime with an offset is honored as-is; an offsetless one is read
// as wall-clock time in tz.
function resolveWhen({ date, time, defaultTime = { h: 9, m: 0 } } = {}, tz) {
  if (date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(date))) {
    const s = String(date);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
    const [d, t] = s.split('T');
    const [h, mi] = t.split(':').map(Number);
    return zonedTime(d, h, mi, tz);
  }
  const day = parseDay(date, tz) || parseDay(time, tz) || todayKey(tz);
  const t = parseTime(time) || parseTime(date) || defaultTime;
  return zonedTime(day, t.h, t.m, tz);
}

// Local "HH:MM" for an instant in tz.
function localHM(d, tz) {
  const p = partsIn(new Date(d), tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

module.exports = { parseDay, parseTime, resolveWhen, todayKey, localHM };

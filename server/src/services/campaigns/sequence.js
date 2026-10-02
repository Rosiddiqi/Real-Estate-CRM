// Lane sequence parser + step time resolution (ported from RevMatch
// sequenceParser.js / campaignEngine.resolveStepTime). Deterministic: the
// agent EXPLAINS a lane in plain language ("remind them the evening before at
// 6, and again the morning of"), this turns it into timed steps
// { timing:{kind, n?, atHour?}, label, brief }.
//
// *_before / morning_of anchor to the EVENT (Campaign.event.startAt);
// immediate / *_later / next_* anchor to the REPLY time. Wall-clock hours are
// resolved in the WORKSPACE timezone (RevMatch hard-coded New York — fixed).
const { zonedTime, partsIn } = require('../../lib/dates');

const LANE_DEFAULTS = {
  green: { timing: { kind: 'days_later', n: 1 }, label: 'NEXT DAY' },
  yellow: { timing: { kind: 'days_later', n: 2 }, label: '2 DAYS LATER' },
  red: { timing: { kind: 'immediate' }, label: 'RIGHT AWAY' },
};
const EVENT_LANE_DEFAULTS = {
  green: { timing: { kind: 'evening_before', atHour: 18 }, label: 'EVENING BEFORE · 6:00 PM' },
};

function hourLabel(h) {
  const hour = ((h % 24) + 24) % 24;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${ampm}`;
}

function toHour24(raw, ampm, defaultPm) {
  let h = parseInt(raw, 10);
  if (Number.isNaN(h)) return null;
  const suffix = (ampm || '').toLowerCase();
  if (suffix === 'pm' && h < 12) h += 12;
  else if (suffix === 'am' && h === 12) h = 0;
  else if (!suffix && defaultPm && h >= 1 && h <= 11) h += 12;
  return h;
}

// Ordered specific → generic; first match wins inside a clause.
const MATCHERS = [
  { re: /(\d+)\s*hours?\s*before/i, make: (m) => ({ kind: 'hours_before', n: parseInt(m[1], 10), label: `${m[1]} HOURS BEFORE` }) },
  { re: /\ban?\s+hour\s+before/i, make: () => ({ kind: 'hours_before', n: 1, label: '1 HOUR BEFORE' }) },
  {
    re: /\bafternoon\s+before(?:\s*,?\s*(?:at|around)\s*(\d{1,2})(?::\d{2})?\s*(pm|am)?)?/i,
    make: (m) => { const h = m[1] ? toHour24(m[1], m[2], true) : 14; return { kind: 'afternoon_before', atHour: h, label: `AFTERNOON BEFORE · ${hourLabel(h)}` }; },
  },
  {
    re: /(?:evening|night)\s+before(?:\s*,?\s*(?:at|around)\s*(\d{1,2})(?::\d{2})?\s*(pm|am)?)?/i,
    make: (m) => { const h = m[1] ? toHour24(m[1], m[2], true) : 18; return { kind: 'evening_before', atHour: h, label: `EVENING BEFORE · ${hourLabel(h)}` }; },
  },
  {
    re: /(\d+)\s*days?\s*before(?:\s*,?\s*(?:at|around)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?)?/i,
    make: (m) => { const n = parseInt(m[1], 10); const h = m[2] ? toHour24(m[2], m[3], true) : 10; return { kind: 'days_before', n, atHour: h, label: `${n} DAY${n === 1 ? '' : 'S'} BEFORE · ${hourLabel(h)}` }; },
  },
  {
    re: /\b(?:day|morning)\s+before(?:\s*,?\s*(?:at|around)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?)?/i,
    make: (m) => { const h = m[1] ? toHour24(m[1], m[2], false) : 10; return { kind: 'day_before', atHour: h, label: m[1] ? `DAY BEFORE · ${hourLabel(h)}` : 'DAY BEFORE' }; },
  },
  {
    re: /\bmorning\s+of(?:\s*,?\s*(?:at|around)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?)?/i,
    make: (m) => { const h = m[1] ? toHour24(m[1], m[2], false) : 9; return { kind: 'morning_of', atHour: h, label: m[1] ? `MORNING OF · ${hourLabel(h)}` : 'MORNING OF' }; },
  },
  { re: /\bnext\s+morning/i, make: () => ({ kind: 'next_morning', atHour: 9, label: 'NEXT MORNING' }) },
  { re: /\b(next\s+day|tomorrow)\b/i, make: () => ({ kind: 'next_day', atHour: 10, label: 'NEXT DAY' }) },
  { re: /(\d+)\s*days?\s*(later|after)/i, make: (m) => { const n = parseInt(m[1], 10); return { kind: 'days_later', n, label: `${n} DAY${n === 1 ? '' : 'S'} LATER` }; } },
  { re: /(?:a\s+)?couple\s+(?:of\s+)?days(?:\s+later)?/i, make: () => ({ kind: 'days_later', n: 2, label: '2 DAYS LATER' }) },
  { re: /(?:a\s+)?few\s+days(?:\s+later)?/i, make: () => ({ kind: 'days_later', n: 3, label: '3 DAYS LATER' }) },
  { re: /a\s+week\s+(later|after)/i, make: () => ({ kind: 'days_later', n: 7, label: 'A WEEK LATER' }) },
  { re: /(\d+)\s*weeks?\s*(later|after)/i, make: (m) => { const w = parseInt(m[1], 10); return { kind: 'days_later', n: w * 7, label: `${w} WEEK${w === 1 ? '' : 'S'} LATER` }; } },
  { re: /(\d+)\s*hours?\s*(later|after)/i, make: (m) => { const n = parseInt(m[1], 10); return { kind: 'hours_later', n, label: `${n} HOUR${n === 1 ? '' : 'S'} LATER` }; } },
  { re: /right\s+away|immediately|right\s+now|\basap\b/i, make: () => ({ kind: 'immediate', label: 'RIGHT AWAY' }) },
];

function findTiming(clause) {
  for (const m of MATCHERS) {
    const hit = String(clause || '').match(m.re);
    if (hit) {
      const { label, ...timing } = m.make(hit);
      return { timing, label };
    }
  }
  return null;
}

function hasTimePhrase(fragment) { return MATCHERS.some((m) => m.re.test(fragment)); }

function cleanBrief(text) {
  let t = String(text || '').trim().replace(/^(?:and|then|also|,|\s)+/i, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.replace(/\s*[—–]\s*/g, ', ');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

function splitClauses(text) {
  const rough = String(text || '').split(/[.;!\n]+/).flatMap((part) => part.split(',')).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const piece of rough) {
    let rest = piece;
    let guard = 0;
    while (guard++ < 6) {
      const m = rest.match(/\b(?:and|then)\b/i);
      if (!m) break;
      const head = rest.slice(0, m.index).trim();
      const tail = rest.slice(m.index + m[0].length).trim();
      if (tail && hasTimePhrase(tail)) { if (head) out.push(head); rest = tail; } else break;
    }
    if (rest) out.push(rest);
  }
  return out;
}

// parseSequence(text, lane, { hasEvent }) -> { steps: [{ timing, label, brief }] }
function parseSequence(text, lane = 'green', { hasEvent = false } = {}) {
  const clauses = splitClauses(text);
  const steps = [];
  const orphans = [];
  for (const clause of clauses) {
    const found = findTiming(clause);
    if (found) {
      const step = { timing: found.timing, label: found.label, brief: cleanBrief(clause) };
      if (orphans.length) { step.brief = cleanBrief(`${orphans.join(', ')}, ${clause}`); orphans.length = 0; }
      steps.push(step);
    } else if (steps.length) {
      const prev = steps[steps.length - 1];
      prev.brief = cleanBrief(`${prev.brief.replace(/\.$/, '')}, ${clause}`);
    } else {
      orphans.push(clause);
    }
  }
  if (!steps.length) {
    const def = (hasEvent && EVENT_LANE_DEFAULTS[lane]) || LANE_DEFAULTS[lane] || LANE_DEFAULTS.green;
    const brief = cleanBrief(text) || 'Follow up.';
    return { steps: [{ timing: { ...def.timing }, label: def.label, brief }] };
  }
  if (orphans.length) {
    const first = steps[0];
    first.brief = cleanBrief(`${first.brief.replace(/\.$/, '')}, ${orphans.join(', ')}`);
  }
  return { steps: steps.slice(0, 4) };
}

const BEFORE_KINDS = ['hours_before', 'afternoon_before', 'evening_before', 'day_before', 'days_before', 'morning_of'];
function needsEvent(steps) { return (steps || []).some((s) => s && s.timing && BEFORE_KINDS.includes(s.timing.kind)); }

// Gray "no reply" timer: "2 DAYS" → 48. Bare number = days. Default 48h.
function timerTextToHours(text) {
  const t = String(text || '').trim().toLowerCase();
  let m = t.match(/(\d+)\s*hours?/); if (m) return parseInt(m[1], 10);
  m = t.match(/(\d+)\s*days?/); if (m) return parseInt(m[1], 10) * 24;
  if (/a\s+week|1\s*week/.test(t)) return 168;
  m = t.match(/(\d+)\s*weeks?/); if (m) return parseInt(m[1], 10) * 168;
  m = t.match(/^(\d+)$/); if (m) return parseInt(m[1], 10) * 24;
  return 48;
}

// Wall-clock hour h on the calendar day of `d` in tz.
function atHour(d, h, tz) {
  const p = partsIn(new Date(d), tz);
  return zonedTime(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, h, 0, tz);
}

// Resolve a step's fire time. Event-relative kinds anchor to eventAt; without
// an event they degrade to reply-relative offsets.
function resolveStepTime(step, { eventAt, base, tz = 'America/New_York' } = {}) {
  const t = (step && step.timing) || {};
  const b = base ? new Date(base) : new Date();
  const ev = eventAt ? new Date(eventAt) : null;
  const H = 3600000;
  const D = 24 * H;
  switch (t.kind) {
    case 'immediate': return new Date(b.getTime() + 2 * 60000);
    case 'hours_later': return new Date(b.getTime() + (t.n || 1) * H);
    case 'days_later': return atHour(new Date(b.getTime() + (t.n || 1) * D), 10, tz);
    case 'next_morning': return ev ? atHour(ev, t.atHour || 9, tz) : atHour(new Date(b.getTime() + D), t.atHour || 9, tz);
    case 'next_day': return atHour(new Date(b.getTime() + D), t.atHour || 10, tz);
    case 'hours_before': return ev ? new Date(ev.getTime() - (t.n || 1) * H) : new Date(b.getTime() + 2 * H);
    case 'afternoon_before': return ev ? atHour(new Date(ev.getTime() - D), t.atHour || 14, tz) : new Date(b.getTime() + 4 * H);
    case 'evening_before': return ev ? atHour(new Date(ev.getTime() - D), t.atHour || 18, tz) : new Date(b.getTime() + 4 * H);
    case 'day_before': return ev ? atHour(new Date(ev.getTime() - D), t.atHour || 10, tz) : atHour(new Date(b.getTime() + D), 10, tz);
    case 'days_before': return ev ? atHour(new Date(ev.getTime() - (t.n || 1) * D), t.atHour || 10, tz) : atHour(new Date(b.getTime() + D), 10, tz);
    case 'morning_of': return ev ? atHour(ev, t.atHour || 9, tz) : atHour(new Date(b.getTime() + D), t.atHour || 9, tz);
    default: return new Date(b.getTime() + D);
  }
}

// First reminder step still in the future (event-anchored). If all are past
// but the event is > 1h away, salvage ONE nudge at T-1h; else nothing.
function resolveReminderSchedule(steps, fromIndex, eventAt, now = new Date(), tz) {
  if (!Array.isArray(steps) || !steps.length || !eventAt) return null;
  const nowMs = new Date(now).getTime();
  const evMs = new Date(eventAt).getTime();
  if (!Number.isFinite(evMs)) return null;
  let lastPast = null;
  for (let i = Math.max(0, fromIndex || 0); i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || !step.timing) continue;
    const at = resolveStepTime(step, { eventAt, base: now, tz });
    if (at && at.getTime() > nowMs) return { index: i, at, step };
    lastPast = { index: i, step };
  }
  if (lastPast && evMs - nowMs > 3600000) return { index: lastPast.index, at: new Date(evMs - 3600000), step: lastPast.step, salvaged: true };
  return null;
}

module.exports = { parseSequence, findTiming, splitClauses, hourLabel, timerTextToHours, resolveStepTime, resolveReminderSchedule, needsEvent, LANE_DEFAULTS, BEFORE_KINDS };

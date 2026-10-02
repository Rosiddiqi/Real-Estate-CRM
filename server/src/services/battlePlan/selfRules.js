// Natural-language self-rules for the Battle Plan engine (ported from RevMatch).
//
// The agent states standing directives in plain English ("no calls before
// 8am", "block 45 min for lunch", "1.5h content block daily"). parseRuleText()
// compiles each ONCE into a structured constraint via deterministic heuristics
// (no per-rule LLM cost); compileConstraints() folds a list of parsed rules into
// the constraint object the placer + candidate generator consume. Anything we
// can't parse is kept as an `advisory` — handed to the copy LLM as context but
// never enforced.

// "8am" / "8 am" / "13:30" / "1:30 pm" / "noon" → minute-of-day, or null.
function parseClock(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (t === 'noon') return 12 * 60;
  if (t === 'midnight') return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (h > 23 || min > 59) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

// Pull a duration in minutes from free text: "90 min", "1.5h", "2 hours".
function parseDurationMin(text) {
  let m = String(text).match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hour)/i);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = String(text).match(/(\d+)\s*(?:m\b|min|minute)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|noon)';

// Compile a single natural-language rule into a structured constraint.
// Returns { type, ...params }. type==='advisory' when we can't enforce it.
function parseRuleText(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();

  // calls before / after <time>  ("don't schedule calls before 8am")
  let m = lower.match(new RegExp(`calls?\\s+before\\s+${CLOCK}`));
  if (m) {
    const min = parseClock(m[1]);
    if (min != null) return { type: 'no_call_before', minute: min };
  }
  m = lower.match(new RegExp(`calls?\\s+after\\s+${CLOCK}`));
  if (m) {
    const min = parseClock(m[1]);
    if (min != null) return { type: 'no_call_after', minute: min };
  }

  // content block duration ("plan 1.5h for content", "content shoot 2 hours")
  if (/content|shoot/.test(lower)) {
    return { type: 'content_shoot', durationMin: parseDurationMin(lower) || 90 };
  }

  // lunch block ("block 45 min for lunch", "lunch at 12:30")
  if (/lunch/.test(lower)) {
    const dur = parseDurationMin(lower) || 45;
    const at = lower.match(new RegExp(`at\\s+${CLOCK}`));
    const start = at ? parseClock(at[1]) : 12 * 60;
    return { type: 'lunch', startMinute: start != null ? start : 12 * 60, durationMin: dur };
  }

  // cap the day ("cap my day at 8 moves", "no more than 6 tasks")
  m = lower.match(/(?:cap|no more than|max(?:imum)?|limit)\D*(\d+)\s*(?:moves|tasks|things|items|suggestions)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 50) return { type: 'max_moves', count: n };
  }

  // time-boxed personal block ("block 30 min from 6pm to 7pm for the gym")
  m = lower.match(new RegExp(`block.*?from\\s+${CLOCK}\\s*(?:to|until|-)\\s*${CLOCK}`));
  if (m) {
    const start = parseClock(m[1]); const end = parseClock(m[2]);
    if (start != null && end != null && end > start) {
      return { type: 'block_window', startMinute: start, endMinute: end, label: t };
    }
  }

  // already the placer default — accept it so it's not flagged unparsed.
  if (/same\s+(?:contact|client|person)\s+twice|twice\s+(?:a|per)\s+day/.test(lower)) {
    return { type: 'no_double_contact' };
  }

  return { type: 'advisory', text: t };
}

// Human label for a parsed rule (shown under the rule in the UI).
function describeParsed(p) {
  if (!p) return 'Noted';
  const clock = (min) => {
    const h = Math.floor(min / 60); const mm = min % 60;
    const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12;
    return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  };
  switch (p.type) {
    case 'no_call_before': return `Enforced · no calls before ${clock(p.minute)}`;
    case 'no_call_after': return `Enforced · no calls after ${clock(p.minute)}`;
    case 'content_shoot': return `Enforced · ${p.durationMin}-min content block`;
    case 'lunch': return `Enforced · ${p.durationMin}-min lunch from ${clock(p.startMinute)}`;
    case 'max_moves': return `Enforced · at most ${p.count} suggestions a day`;
    case 'block_window': return `Enforced · blocked ${clock(p.startMinute)}–${clock(p.endMinute)}`;
    case 'no_double_contact': return 'Enforced · one call and one text per person a day';
    default: return 'Noted as context for the planner';
  }
}

// Fold a list of stored rules into the constraint object the placer +
// candidate generator consume.
function compileConstraints(rules) {
  const out = {
    noCallBeforeMin: null,
    noCallAfterMin: null,
    lunchWindow: null,        // { start, end } when a lunch rule exists
    lunchDurationMin: null,
    contentBlockMin: null,    // overrides the schedule default when set
    maxMoves: null,
    blockWindows: [],         // extra occupied ranges (gym, school run…)
    advisories: [],           // unparsed rules → copy-LLM context
  };
  for (const r of (rules || [])) {
    if (r && r.active === false) continue;
    const p = (r && r.parsed && r.parsed.type) ? r.parsed : parseRuleText(r && r.text);
    switch (p.type) {
      case 'no_call_before':
        out.noCallBeforeMin = Math.max(out.noCallBeforeMin ?? 0, p.minute); break;
      case 'no_call_after':
        out.noCallAfterMin = out.noCallAfterMin == null ? p.minute : Math.min(out.noCallAfterMin, p.minute); break;
      case 'content_shoot':
        out.contentBlockMin = p.durationMin; break;
      case 'lunch':
        out.lunchDurationMin = p.durationMin;
        out.lunchWindow = { start: p.startMinute, end: p.startMinute + Math.max(p.durationMin, 30) + 45 };
        break;
      case 'max_moves':
        out.maxMoves = p.count; break;
      case 'block_window':
        out.blockWindows.push({ start: p.startMinute, end: p.endMinute, label: p.label }); break;
      case 'advisory':
        out.advisories.push(p.text); break;
      default: break; // no_double_contact is already the placer default
    }
  }
  return out;
}

module.exports = { parseRuleText, compileConstraints, parseClock, parseDurationMin, describeParsed };

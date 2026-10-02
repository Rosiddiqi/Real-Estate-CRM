// Deterministic placer (ported from RevMatch battlePlanPlacer.js).
//
// The LLM never chooses times or which moves exist. Given scored candidates,
// the day's occupied ranges (appointments, routine blocks, timed to-dos,
// self-rule blocks, "already past" for today) and the work window, this:
//   1. places LUNCH (slides later past covering appointments, never earlier)
//   2. places the mandatory CONTENT block (preferred start if free, else the
//      start of the largest remaining gap)
//   3. places TASK moves greedily by score — one call + one text per contact
//      per day, calls biased before noon, 15-min grid, 5-min buffer, cap 12.
// Everything that doesn't fit lands in `overflow` with a reason.

const NOON = 12 * 60;
const DEFAULT_BUFFER_MIN = 5;
const DEFAULT_MAX_MOVES = 12;
const DEFAULT_LUNCH_WINDOW = { start: 12 * 60, end: 13 * 60 + 30 }; // 12:00–13:30

const MANDATORY_KINDS = new Set(['content.block', 'personal.lunch']);

function roundUpTo15(mins) { return Math.ceil(mins / 15) * 15; }

function minutesToHHMM(m) {
  const h = Math.floor(m / 60); const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function localMinuteOfDay(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return (Number(o.hour) % 24) * 60 + Number(o.minute);
}

// call | text — kinds ending .call are calls; everything else is a text.
function channelOf(cand) {
  if (cand && cand.channel) return cand.channel === 'call' ? 'call' : 'text';
  return /\.call$/.test(String(cand && cand.kind)) ? 'call' : 'text';
}

function freeGaps(window, occupied) {
  const clipped = (occupied || [])
    .map((r) => ({ start: Math.max(r.start, window.start), end: Math.min(r.end, window.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = window.start;
  for (const r of clipped) {
    if (r.start > cursor) gaps.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}

function findSlot(gaps, durMin, { earliest = null, latestStart = null } = {}) {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    let start = roundUpTo15(earliest != null ? Math.max(g.start, earliest) : g.start);
    if (start < g.start) start = roundUpTo15(g.start);
    if (latestStart != null && start > latestStart) continue;
    if (start + durMin <= g.end) return { startMin: start, gapIndex: i };
  }
  return null;
}

function consume(gaps, gapIndex, startMin, durMin, buffer) {
  const g = gaps[gapIndex];
  const afterEnd = Math.min(g.end, startMin + durMin + buffer);
  const left = { start: g.start, end: startMin };
  const right = { start: afterEnd, end: g.end };
  const replacement = [];
  if (left.end - left.start >= 15) replacement.push(left); // keep usable remnants only
  if (right.end - right.start >= 15) replacement.push(right);
  gaps.splice(gapIndex, 1, ...replacement);
}

function largestGapIndex(gaps, durMin) {
  let best = -1; let bestLen = -1;
  for (let i = 0; i < gaps.length; i++) {
    const len = gaps[i].end - gaps[i].start;
    if (len >= durMin && len > bestLen) { bestLen = len; best = i; }
  }
  return best;
}

// Gap index that fully contains [start, start+dur), or -1.
function gapContaining(gaps, start, dur) {
  return gaps.findIndex((g) => g.start <= start && start + dur <= g.end);
}

function placeCandidates(candidates, occupied, window, constraints = {}) {
  const buffer = constraints.bufferMin ?? DEFAULT_BUFFER_MIN;
  const maxMoves = constraints.maxMoves ?? DEFAULT_MAX_MOVES;
  const noCallBefore = constraints.noCallBeforeMin ?? null;
  const noCallAfter = constraints.noCallAfterMin ?? null;
  const lunchWindow = constraints.lunchWindow ?? DEFAULT_LUNCH_WINDOW;
  const contentPreferred = constraints.contentPreferredMin ?? null;

  const warnings = [];
  const overflow = [];
  const placed = [];
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  const contentCand = list.find((c) => c.kind === 'content.block') || null;
  const lunchCand = list.find((c) => c.kind === 'personal.lunch') || null;
  const taskCands = list.filter((c) => !MANDATORY_KINDS.has(c.kind));
  taskCands.sort((a, b) => (b.score || 0) - (a.score || 0));

  const gaps = freeGaps(window, occupied || []);
  const emit = (cand, startMin) => placed.push({
    ...cand, startMin, suggestedTimeLocal: minutesToHHMM(startMin), durationMinutes: cand.durationMin,
  });

  // 1. LUNCH — slides LATER past covering appointments; never earlier than its window.
  if (lunchCand) {
    const covering = (occupied || []).filter((r) => !r.soft && r.start < lunchWindow.end && r.end > lunchWindow.start);
    if (covering.length) {
      const afterAppts = Math.max(lunchWindow.start, ...covering.map((r) => r.end));
      const slot = findSlot(gaps, lunchCand.durationMin, { earliest: afterAppts });
      if (slot) {
        emit({ ...lunchCand, movedForAppt: true }, slot.startMin);
        consume(gaps, slot.gapIndex, slot.startMin, lunchCand.durationMin, buffer);
      } else {
        overflow.push({ ...lunchCand, reason: 'lunch_window_covered_by_appt' });
        warnings.push(`No ${lunchCand.durationMin}-min window for lunch after your appointments today.`);
      }
    } else {
      const slot = findSlot(gaps, lunchCand.durationMin, { earliest: lunchWindow.start, latestStart: lunchWindow.end - lunchCand.durationMin });
      if (slot) {
        emit(lunchCand, slot.startMin);
        consume(gaps, slot.gapIndex, slot.startMin, lunchCand.durationMin, buffer);
      } else {
        overflow.push({ ...lunchCand, reason: 'no_slot_in_lunch_window' });
        warnings.push(`No ${lunchCand.durationMin}-min window for lunch today.`);
      }
    }
  }

  // 2. CONTENT — mandatory. The agent's preferred start when it's free,
  //    otherwise the START of the LARGEST remaining gap.
  if (contentCand) {
    const dur = contentCand.durationMin;
    let done = false;
    if (contentPreferred != null) {
      const start = roundUpTo15(contentPreferred);
      const gi = gapContaining(gaps, start, dur);
      if (gi >= 0) { emit(contentCand, start); consume(gaps, gi, start, dur, buffer); done = true; }
    }
    if (!done) {
      const gi = largestGapIndex(gaps, dur);
      if (gi >= 0 && roundUpTo15(gaps[gi].start) + dur <= gaps[gi].end) {
        const startMin = roundUpTo15(gaps[gi].start);
        emit(contentCand, startMin);
        consume(gaps, gi, startMin, dur, buffer);
      } else {
        overflow.push({ ...contentCand, reason: 'no_gap_for_content' });
        warnings.push(`No ${dur}-min open gap for the content block today.`);
      }
    }
  }

  // 3. TASKS — greedy by score; no double-contact per channel; cap; call windows;
  //    calls biased before noon.
  const touched = new Map();
  let placedTasks = 0;
  for (const cand of taskCands) {
    if (placedTasks >= maxMoves) { overflow.push({ ...cand, reason: 'over_daily_cap' }); continue; }
    const channel = channelOf(cand);
    if (cand.contactId) {
      const set = touched.get(cand.contactId);
      if (set && set.has(channel)) { overflow.push({ ...cand, reason: 'double_contact_same_channel' }); continue; }
    }
    const callKind = channel === 'call';
    const earliest = callKind && noCallBefore != null ? noCallBefore : null;
    const callLatest = (callKind && noCallAfter != null) ? noCallAfter - cand.durationMin : null;
    let slot = null;
    if (callKind) {
      const morningLatest = callLatest != null ? Math.min(NOON - cand.durationMin, callLatest) : NOON - cand.durationMin;
      slot = findSlot(gaps, cand.durationMin, { earliest, latestStart: morningLatest });
    }
    if (!slot) slot = findSlot(gaps, cand.durationMin, { earliest, latestStart: callLatest });
    if (!slot) { overflow.push({ ...cand, reason: 'no_slot' }); continue; }
    emit(cand, slot.startMin);
    consume(gaps, slot.gapIndex, slot.startMin, cand.durationMin, buffer);
    placedTasks += 1;
    if (cand.contactId) {
      const s = touched.get(cand.contactId) || new Set();
      s.add(channel);
      touched.set(cand.contactId, s);
    }
  }

  placed.sort((a, b) => a.startMin - b.startMin);
  return { placed, overflow, warnings };
}

// Read-time reflow helper: slide [start, start+dur) later until it overlaps no
// busy range. Returns { start, after } (after = the range it was pushed past).
function slideLater(start, dur, busy, guardEnd = 22 * 60) {
  let at = start; let after = null;
  for (let guard = 0; guard < 48; guard += 1) {
    const hit = busy.find((b) => b.start < at + dur && b.end > at);
    if (!hit) break;
    at = Math.max(at, hit.end);
    after = hit;
  }
  if (at + dur > guardEnd) return { start, after: null, failed: true };
  return { start: at, after };
}

// First 15-min-step slot inside window that overlaps nothing (content auto-shift).
function firstFreeSlot(window, dur, busy, from = null) {
  const startAt = roundUpTo15(Math.max(window.start, from ?? window.start));
  for (let s = startAt; s + dur <= window.end; s += 15) {
    if (!busy.some((b) => b.start < s + dur && b.end > s)) return s;
  }
  return null;
}

module.exports = {
  placeCandidates, freeGaps, findSlot, roundUpTo15, minutesToHHMM, localMinuteOfDay,
  channelOf, slideLater, firstFreeSlot, MANDATORY_KINDS, DEFAULT_LUNCH_WINDOW,
};

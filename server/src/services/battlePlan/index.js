// Battle Plan engine — deterministic candidates → scorer → placer → (LLM copy
// only) → PlanDay / PlanMove rows. Two plan slots are simply two dates (today
// + tomorrow), so the day roll never discards tomorrow's plan.
//
//   const bp = require('../services/battlePlan');
//   await bp.getPlanPayload({ workspaceId, userId, date });   // GET /api/battle-plan
//   await bp.generatePlanDay({ workspaceId, userId, date, force: true });
//   await bp.getTodoBoard({ workspaceId, userId });           // To-Do panel
const crypto = require('node:crypto');
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const ai = require('../../ai/claude');
const config = require('../../config');
const { dayKey, addDays, dayBounds, minuteOfDay } = require('../../lib/dates');
const { clientName } = require('../../lib/clients');
const { getSchedule, resolveDay, routineFor, hhmmToMin, LUNCH_RE } = require('./schedule');
const { compileConstraints, parseRuleText, describeParsed } = require('./selfRules');
const { collectCandidates } = require('./signals');
const { scoreAll, isDoNotDisturb } = require('./scorer');
const { placeCandidates, slideLater, firstFreeSlot, roundUpTo15, MANDATORY_KINDS } = require('./placer');
const { fallbackCopy, fallbackSummary, writeCopyWithAI, REASONS, SRC_FOR_KIND } = require('./copy');

const HANDLED_DAYS = 14;
const FAR_FUTURE = new Date('2099-12-31T00:00:00Z');
const locks = new Map();

// ── context ──────────────────────────────────────────────────────────────
async function userContext(workspaceId, userId) {
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, timezone: true, firstName: true, preferences: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, timezone: true, settings: true, market: true } }),
  ]);
  const tz = (user && user.timezone) || (workspace && workspace.timezone) || config.timezone;
  return { user, workspace, tz, settings: (workspace && workspace.settings) || {} };
}

function todayFor(tz) { return dayKey(new Date(), tz); }

async function handledKeys(userId) {
  const rows = await prisma.planHandled.findMany({
    where: { userId, handledAt: { gte: new Date(Date.now() - HANDLED_DAYS * 864e5) } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

async function activeSuppressions(userId) {
  return prisma.planSuppression.findMany({ where: { userId, expiresAt: { gt: new Date() } } });
}

function candidateSuppressed(c, suppressions) {
  if (!c || MANDATORY_KINDS.has(c.kind)) return false;
  const cid = c.contactId || null;
  const src = (c.signal && c.signal.sourceKind) || null;
  for (const s of suppressions) {
    if (s.clientId && s.clientId !== cid) continue;
    if (!s.signalKind && !s.sourceKind) {
      if (s.clientId && s.clientId === cid) return true;
      continue;
    }
    if (s.signalKind && s.signalKind === c.kind) return true;
    if (s.sourceKind && (s.sourceKind === src || s.sourceKind === c.kind)) return true;
  }
  return false;
}

const moveKey = (kind, clientId, fallbackId) => `${clientId || fallbackId || 'none'}:${kind}`;

function apptLabel(a, clients) {
  const c = a.clientId ? clients.get(a.clientId) : null;
  const t = String(a.type || '').replace(/_/g, ' ');
  if (c) return `${c.firstName || clientName(c)}'s ${t || 'appointment'}`;
  return a.type === 'open_house' || a.type === 'broker_open' ? `the ${t}` : (a.title || 'an appointment').slice(0, 40);
}

function apptRange(a, tz) {
  const s = minuteOfDay(new Date(a.startAt), tz);
  let e = minuteOfDay(new Date(a.endAt), tz);
  if (dayKey(new Date(a.endAt), tz) !== dayKey(new Date(a.startAt), tz) || e <= s) e = Math.min(24 * 60, s + Math.max(15, Math.round((new Date(a.endAt) - new Date(a.startAt)) / 60000)));
  return { start: s, end: Math.max(s + 5, e) };
}

async function dayAppointments(workspaceId, date, tz) {
  const { start, end } = dayBounds(date, tz);
  return prisma.appointment.findMany({
    where: { workspaceId, startAt: { gte: start, lt: end }, status: { not: 'cancelled' } },
    orderBy: { startAt: 'asc' },
  });
}

// ── generation ──────────────────────────────────────────────────────────
async function generatePlanDay({ workspaceId, userId, date, force = false, reason = 'auto', metaExtra = null }) {
  const lockKey = `${userId}:${date}`;
  if (locks.has(lockKey)) return locks.get(lockKey);
  const p = (async () => {
    const existing = await prisma.planDay.findUnique({ where: { userId_date: { userId, date } }, include: { moves: true } });
    if (existing && !force) return existing;
    return buildAndPersist({ workspaceId, userId, date, existing, reason, metaExtra });
  })().finally(() => locks.delete(lockKey));
  locks.set(lockKey, p);
  return p;
}

async function buildAndPersist({ workspaceId, userId, date, existing, reason, metaExtra }) {
  const ctx = await userContext(workspaceId, userId);
  const { tz } = ctx;
  const now = new Date();
  const today = todayFor(tz);
  const isToday = date === today;

  const [schedule, rules, appts, suppressions, handled] = await Promise.all([
    getSchedule({ workspaceId, userId }),
    prisma.selfRule.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } }),
    dayAppointments(workspaceId, date, tz),
    activeSuppressions(userId),
    handledKeys(userId),
  ]);
  const constraints = compileConstraints(rules);
  const day = resolveDay(schedule, date);
  const window = day.off ? { start: 9 * 60, end: 18 * 60 } : { start: day.start, end: day.end };
  const routine = routineFor(schedule, date);
  const routineHasLunch = routine.some((b) => b.isLunch);

  // occupied ranges
  const occupied = [];
  const apptClientIds = [...new Set(appts.map((a) => a.clientId).filter(Boolean))];
  const bundlesLabel = new Map((apptClientIds.length ? await prisma.client.findMany({ where: { id: { in: apptClientIds } }, select: { id: true, firstName: true, lastName: true, displayName: true } }) : []).map((c) => [c.id, c]));
  for (const a of appts) {
    if (['cancelled', 'no_show'].includes(a.status)) continue;
    occupied.push({ ...apptRange(a, tz), client: !!a.clientId, appt: true, label: apptLabel(a, bundlesLabel) });
  }
  for (const b of routine) occupied.push({ start: b.startMin, end: b.startMin + b.durationMin, routine: true });
  for (const w of constraints.blockWindows) occupied.push({ start: w.start, end: w.end, rule: true });
  const { start: dStart, end: dEnd } = dayBounds(date, tz);
  const timedTasks = await prisma.task.findMany({ where: { workspaceId, status: 'pending', dueAt: { gte: dStart, lt: dEnd }, durationMin: { not: null } }, select: { dueAt: true, durationMin: true } });
  for (const t of timedTasks) { const s = minuteOfDay(new Date(t.dueAt), tz); occupied.push({ start: s, end: s + (t.durationMin || 30), task: true }); }

  // Today: nothing lands in the past; elapsed / completed standing blocks are kept.
  const preserved = [];
  const nowMin = isToday ? minuteOfDay(now, tz) : null;
  if (isToday) occupied.push({ start: 0, end: roundUpTo15(nowMin + 5), soft: true });
  for (const m of (existing && existing.moves) || []) {
    const elapsed = isToday && m.startMin != null && m.startMin + m.durationMin <= nowMin;
    if (m.mandatory && (m.status !== 'open' || elapsed)) {
      preserved.push(m);
      if (m.startMin != null && m.status !== 'dismissed') occupied.push({ start: m.startMin, end: m.startMin + m.durationMin });
    }
  }
  const preservedKinds = new Set(preserved.map((m) => m.kind));

  // candidates
  const { candidates, bundles } = await collectCandidates({ workspaceId, date, tz, now, settings: ctx.settings, schedule, constraints });
  let pool = candidates.filter((c) => {
    if (MANDATORY_KINDS.has(c.kind)) {
      if (preservedKinds.has(c.kind)) return false;
      if (c.kind === 'personal.lunch' && routineHasLunch) return false;
      if (c.kind === 'personal.lunch' && appts.some((a) => LUNCH_RE.test(a.title || ''))) return false;
      return true;
    }
    if (day.off) return false; // off day: outreach muted (content block stays in case they come in)
    if (candidateSuppressed(c, suppressions)) return false;
    if (handled.has(moveKey(c.kind, c.contactId))) return false;
    if (isDoNotDisturb(bundles.get(c.contactId))) return false;
    return true;
  });
  // User items beat AI duplicates (also re-checked at read time for to-dos added later).
  const openTasks = await prisma.task.findMany({ where: { workspaceId, status: 'pending' }, select: { clientId: true, title: true }, take: 300 });
  const ownedIds = new Set(redundancyFilter(
    pool.filter((c) => c.contactId).map((c) => ({ id: `${c.contactId}:${c.kind}`, clientId: c.contactId, mandatory: false })),
    openTasks,
    new Map([...bundles.entries()].map(([id, b]) => [id, b.client])),
  ).map((m) => m.id));
  pool = pool.filter((c) => !c.contactId || ownedIds.has(`${c.contactId}:${c.kind}`));
  // one candidate per (contact, kind)
  const seen = new Set();
  pool = pool.filter((c) => { const k = moveKey(c.kind, c.contactId, c.kind); if (seen.has(k)) return false; seen.add(k); return true; });

  const scored = scoreAll(pool, { bundles });
  const lunchPref = hhmmToMin(schedule.lunch.preferredStart) ?? 12 * 60;
  const lunchDur = constraints.lunchDurationMin || schedule.lunch.durationMin || 45;
  const lunchWindow = constraints.lunchWindow || { start: lunchPref, end: lunchPref + lunchDur + 60 };
  const { placed, overflow, warnings } = placeCandidates(scored, occupied, window, {
    maxMoves: constraints.maxMoves ?? 12,
    bufferMin: 5,
    noCallBeforeMin: constraints.noCallBeforeMin,
    noCallAfterMin: constraints.noCallAfterMin,
    lunchWindow,
    contentPreferredMin: hhmmToMin(schedule.contentBlock.preferredStart),
  });

  // Moves live in the To-Do list, so a packed calendar shouldn't erase them:
  // task candidates that found no slot stay as untimed suggestions (cap holds).
  const cap = constraints.maxMoves ?? 12;
  let room = cap - placed.filter((c) => !MANDATORY_KINDS.has(c.kind)).length;
  for (const o of overflow) {
    if (room <= 0) break;
    if (o.reason !== 'no_slot' || MANDATORY_KINDS.has(o.kind)) continue;
    placed.push({ ...o, startMin: null, untimed: true });
    o.promoted = true;
    room -= 1;
  }
  const moves = placed.map((c) => {
    const b = c.contactId ? bundles.get(c.contactId) : null;
    const fb = fallbackCopy(c);
    if (c.kind === 'personal.lunch' && c.movedForAppt) {
      const before = occupied.filter((r) => r.appt && r.end <= c.startMin + 1).sort((x, y) => y.end - x.end)[0];
      if (before && before.label) fb.sub = `Moved after ${before.label}`;
    }
    const src = SRC_FOR_KIND[c.kind] || 'internal';
    return {
      id: crypto.randomUUID(),
      workspaceId,
      key: MANDATORY_KINDS.has(c.kind) ? c.kind : moveKey(c.kind, c.contactId),
      kind: c.kind,
      channel: c.channel || (c.kind.endsWith('.call') ? 'call' : 'text'),
      signalKind: (c.signal && c.signal.sourceKind) || null,
      clientId: c.contactId || null,
      dealId: c.dealId || (b && b.deal ? b.deal.id : null),
      listingId: c.listingId || null,
      startMin: c.startMin,
      durationMin: c.durationMin,
      title: fb.title,
      sub: fb.sub || null,
      why: fb.why || null,
      src,
      impact: c.impactDollars || 0,
      score: c.score || 0,
      tone: fb.tone || null,
      action: fb.action || null,
      actionIcon: fb.actionIcon || null,
      status: 'open',
      userPlaced: false,
      mandatory: MANDATORY_KINDS.has(c.kind),
      meta: {
        signal: c.signal ? c.signal.summary : null,
        matchScore: c.matchScore || null,
        movedForAppt: !!c.movedForAppt,
        conversationId: c.conversationId || null,
        appointmentId: c.appointmentId || null,
        propertyId: c.propertyId || null,
        searchId: c.searchId || null,
        ctx: c.ctx || {},
        ev: b ? {
          rating: b.client.rating || 0,
          whale: b.tags.includes('whale'),
          dealValue: b.expectedGci || b.dealGci || c.potentialGci || 0,
          dealStage: b.dealStage,
          propertyPriority: b.propertyPriority,
          tier: b.tier,
          silenceDays: b.silenceDays,
        } : null,
      },
    };
  });

  const fbSummary = fallbackSummary([...preserved, ...moves], { offDay: day.off });
  const meta = {
    window, offDay: !!day.off, known: day.known, source: day.source,
    overflowCount: overflow.filter((o) => !MANDATORY_KINDS.has(o.kind) && !o.promoted).length,
    overflow: overflow.filter((o) => !o.promoted).slice(0, 20).map((o) => ({ kind: o.kind, clientId: o.contactId || null, reason: o.reason })),
    warnings, copySource: 'fallback', reason, advisories: constraints.advisories,
    ...(metaExtra || {}),
  };

  const preservedIds = preserved.map((m) => m.id);
  const planDay = await prisma.$transaction(async (tx) => {
    const pd = await tx.planDay.upsert({
      where: { userId_date: { userId, date } },
      create: { workspaceId, userId, date, summary: fbSummary.summary, narrative: fbSummary.narrative, meta },
      update: { generatedAt: new Date(), summary: fbSummary.summary, narrative: fbSummary.narrative, meta },
    });
    // Replace everything still OPEN (handled moves stay for history; elapsed
    // standing blocks are preserved so a mid-day replan never erases them).
    await tx.planMove.deleteMany({ where: { planDayId: pd.id, status: 'open', id: { notIn: preservedIds } } });
    if (moves.length) await tx.planMove.createMany({ data: moves.map((m) => ({ ...m, planDayId: pd.id })) });
    return tx.planDay.findUnique({ where: { id: pd.id }, include: { moves: true } });
  });

  hub.broadcast(workspaceId, 'plan_updated', { date, reason });
  if (ai.available() && moves.length) {
    setImmediate(() => {
      rewriteCopy({ workspaceId, planDayId: planDay.id, date, tz, placed, moves, advisories: constraints.advisories, offDay: !!day.off })
        .catch((err) => console.warn('[battlePlan] copy rewrite failed:', err.message));
    });
  }
  return planDay;
}

async function rewriteCopy({ workspaceId, planDayId, date, tz, placed, moves, advisories, offDay }) {
  const input = moves.map((m, i) => ({
    id: m.id, kind: m.kind, channel: m.channel, startMin: m.startMin, durationMin: m.durationMin,
    ctx: placed[i].ctx, signal: placed[i].signal, impactDollars: placed[i].impactDollars, matchScore: placed[i].matchScore,
    fallback: { title: m.title, sub: m.sub, why: m.why, tone: m.tone },
  }));
  const out = await writeCopyWithAI({ workspaceId, date, tz, moves: input, advisories });
  if (!out) return;
  const current = await prisma.planMove.findMany({ where: { planDayId, id: { in: moves.map((m) => m.id) }, status: 'open' }, select: { id: true } });
  const live = new Set(current.map((c) => c.id));
  for (const [id, copy] of out.items) {
    if (!live.has(id)) continue;
    await prisma.planMove.update({ where: { id }, data: { title: copy.title, sub: copy.sub, why: copy.why, tone: copy.tone } }).catch(() => {});
  }
  const pd = await prisma.planDay.findUnique({ where: { id: planDayId } });
  if (!pd) return;
  await prisma.planDay.update({
    where: { id: planDayId },
    data: {
      summary: (!offDay && out.summary) || pd.summary,
      narrative: (!offDay && out.narrative) || pd.narrative,
      meta: { ...(pd.meta || {}), copySource: 'ai', copyAt: new Date().toISOString() },
    },
  });
  hub.broadcast(workspaceId, 'plan_updated', { date, reason: 'copy' });
}

async function ensurePlan({ workspaceId, userId, date }) {
  const pd = await prisma.planDay.findUnique({ where: { userId_date: { userId, date } }, include: { moves: true } });
  if (pd) return pd;
  return generatePlanDay({ workspaceId, userId, date, reason: 'on_read' });
}

// ── read-time assembly ──────────────────────────────────────────────────
const KIND_BY_APPT = {
  showing: 'showing', private_tour: 'showing', open_house: 'openhouse', broker_open: 'openhouse',
  closing: 'closing', listing_presentation: 'listing', buyer_consult: 'match',
  inspection: 'prep', appraisal: 'prep', final_walkthrough: 'prep',
  call: 'call', video: 'call', content: 'content', personal: 'personal', meeting: 'email', team: 'neutral', other: 'neutral',
};

async function clientMinis(workspaceId, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.client.findMany({
    where: { workspaceId, id: { in: list } },
    select: { id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, avatarUrl: true, rating: true, isWhale: true, textOptOut: true },
  });
  return new Map(rows.map((c) => [c.id, { ...c, name: clientName(c) }]));
}

function serializeMove(m, clients, date) {
  const c = m.clientId ? clients.get(m.clientId) : null;
  const ev = (m.meta && m.meta.ev) || null;
  const reason = REASONS[m.src] || REASONS.internal;
  return {
    id: m.id,
    date,
    kind: m.kind,
    channel: m.channel,
    src: m.src,
    reasonLabel: reason.label,
    reasonSentence: reason.sentence,
    title: m.title,
    sub: m.sub,
    why: m.why,
    tone: m.tone,
    action: m.action,
    actionIcon: m.actionIcon,
    startMin: m.startMin,
    durationMin: m.durationMin,
    status: m.status,
    mandatory: m.mandatory,
    userPlaced: m.userPlaced,
    impact: m.impact,
    score: m.score,
    clientId: m.clientId,
    clientName: c ? c.name : null,
    firstName: c ? c.firstName : null,
    phone: c ? c.phone : null,
    avatarUrl: c ? c.avatarUrl : null,
    canText: !!(c && c.phone && !c.textOptOut),
    whale: !!(c && (c.isWhale || (c.rating || 0) >= 5)),
    stars: c && c.rating ? Math.max(1, Math.min(5, Math.round(c.rating))) : null,
    dealId: m.dealId,
    listingId: m.listingId,
    conversationId: m.meta ? m.meta.conversationId : null,
    appointmentId: m.meta ? m.meta.appointmentId : null,
    matchScore: m.meta ? m.meta.matchScore : null,
    signal: m.meta ? m.meta.signal : null,
    dealValue: ev ? ev.dealValue : 0,
    dealStage: ev ? ev.dealStage : null,
    propertyPriority: ev ? ev.propertyPriority : null,
    tier: ev ? ev.tier : null,
    createdAt: m.createdAt,
  };
}

// User items beat AI duplicates: a move is redundant when an open to-do is for
// the same client (typed to-dos auto-link a uniquely named client), or its
// title names them — full name, or a surname of 4+ letters (prefix-tolerant).
function redundancyFilter(moves, tasks, clients) {
  const { tokens, tokenMatches } = require('../tasks');
  const taskClientIds = new Set(tasks.map((t) => t.clientId).filter(Boolean));
  const titleTokens = tasks.filter((t) => !t.clientId).map((t) => tokens(t.title));
  return moves.filter((m) => {
    if (m.mandatory || !m.clientId) return true;
    if (taskClientIds.has(m.clientId)) return false;
    const c = clients.get(m.clientId);
    if (!c) return true;
    const fn = String(c.firstName || '').toLowerCase();
    const ln = String(c.lastName || '').toLowerCase();
    for (const toks of titleTokens) {
      const hitFirst = fn.length >= 3 && toks.some((w) => tokenMatches(w, fn));
      const hitLast = ln.length >= 3 && toks.some((w) => tokenMatches(w, ln));
      if ((hitFirst && hitLast) || (hitLast && ln.length >= 4)) return false;
    }
    return true;
  });
}

async function getPlanPayload({ workspaceId, userId, date: dateParam }) {
  const { normType } = require('../calendar');
  const ctx = await userContext(workspaceId, userId);
  const { tz } = ctx;
  const today = todayFor(tz);
  const tomorrow = addDays(today, 1);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateParam || '')) ? dateParam : today;
  const isPlanDay = date === today || date === tomorrow;

  const [schedule, appts, overrides] = await Promise.all([
    getSchedule({ workspaceId, userId }),
    dayAppointments(workspaceId, date, tz),
    prisma.planBlockOverride.findMany({ where: { userId, date } }),
  ]);
  const plan = isPlanDay ? await ensurePlan({ workspaceId, userId, date }) : null;
  const day = resolveDay(schedule, date);
  const window = day.off ? null : { startMin: day.start, endMin: day.end };
  const routine = routineFor(schedule, date);
  const moves = (plan && plan.moves) || [];

  const clientIds = [...appts.map((a) => a.clientId), ...moves.map((m) => m.clientId)];
  const listingIds = appts.map((a) => a.listingId).filter(Boolean);
  const [clients, listings] = await Promise.all([
    clientMinis(workspaceId, clientIds),
    listingIds.length ? prisma.listing.findMany({ where: { workspaceId, id: { in: listingIds } }, select: { id: true, street: true, unitNumber: true, city: true, buildingName: true, title: true, heroPhoto: true, listPrice: true } }) : [],
  ]);
  const listingBy = new Map(listings.map((l) => [l.id, l]));

  const items = [];
  const clientBusy = [];
  const allBusy = [];
  for (const a of appts) {
    const r = apptRange(a, tz);
    const c = a.clientId ? clients.get(a.clientId) : null;
    const l = a.listingId ? listingBy.get(a.listingId) : null;
    const type = normType(a.type);
    if (!['cancelled'].includes(a.status)) {
      allBusy.push({ ...r, label: c ? `${c.firstName || c.name}'s ${type.replace('_', ' ')}` : a.title });
      clientBusy.push({ ...r, label: c ? `${c.firstName || c.name}'s appointment` : (a.title || 'an appointment').slice(0, 40) });
    }
    items.push({
      id: `appt-${a.id}`,
      kind: 'appt',
      apptType: type,
      colorKind: KIND_BY_APPT[type] || 'neutral',
      appointmentId: a.id,
      title: a.title,
      sub: [c ? c.name : null, a.location || (l ? [l.street, l.unitNumber].filter(Boolean).join(' ') : null)].filter(Boolean).join(' · ') || a.notes || null,
      startMin: r.start,
      durationMin: r.end - r.start,
      status: a.status,
      clientId: a.clientId,
      clientName: c ? c.name : null,
      phone: c ? c.phone : null,
      whale: !!(c && (c.isWhale || (c.rating || 0) >= 5)),
      stars: c && c.rating ? c.rating : null,
      listingId: a.listingId,
      location: a.location,
      outcome: a.outcome,
      startAt: a.startAt,
      endAt: a.endAt,
    });
  }

  // routine blocks — lunch-like ones slide after client appointments
  for (const b of routine) {
    let start = b.startMin; let sub = null; let movedForAppt = false;
    if (b.isLunch && clientBusy.length) {
      const r = slideLater(start, b.durationMin, clientBusy);
      if (!r.failed && r.after) { start = r.start; sub = `Moved after ${r.after.label}`; movedForAppt = true; }
    }
    items.push({
      id: `routine-${b.id}-${date}`, kind: 'personal', routine: true, lunch: b.isLunch, title: b.title, sub,
      startMin: start, durationMin: b.durationMin, movedForAppt, originalStartMin: movedForAppt ? b.startMin : null,
    });
    allBusy.push({ start, end: start + b.durationMin });
  }

  // planner standing blocks (content / lunch)
  const ov = new Map(overrides.map((o) => [o.block, o]));
  const lunchMove = moves.find((m) => m.kind === 'personal.lunch' && m.status !== 'dismissed');
  const contentMove = moves.find((m) => m.kind === 'content.block' && m.status !== 'dismissed');
  if (lunchMove) {
    let start = lunchMove.startMin; let dur = lunchMove.durationMin; let userPlaced = lunchMove.userPlaced; let sub = lunchMove.sub; let movedForAppt = false;
    const o = ov.get('lunch');
    if (o) { start = o.startMin; dur = o.durationMin; userPlaced = true; sub = 'Moved by you'; }
    if (!userPlaced && start != null && clientBusy.length && lunchMove.status === 'open') {
      const r = slideLater(start, dur, clientBusy);
      if (!r.failed && r.after) { start = r.start; sub = `Moved after ${r.after.label}`; movedForAppt = true; }
    }
    if (start != null) {
      items.push({ id: lunchMove.id, moveId: lunchMove.id, kind: 'personal', lunch: true, planner: true, title: lunchMove.title, sub, why: lunchMove.why, startMin: start, durationMin: dur, status: lunchMove.status, userPlaced, movedForAppt, mandatory: true });
      allBusy.push({ start, end: start + dur });
    }
  }
  if (contentMove) {
    let start = contentMove.startMin; let dur = contentMove.durationMin; let userPlaced = contentMove.userPlaced; let sub = contentMove.sub; let conflict = false; let shifted = false;
    const o = ov.get('content');
    if (o) { start = o.startMin; dur = o.durationMin; userPlaced = true; sub = 'Moved by you'; }
    if (!userPlaced && start != null && contentMove.status === 'open') {
      const overlaps = allBusy.some((b) => b.start < start + dur && b.end > start);
      if (overlaps) {
        const win = window ? { start: window.startMin, end: window.endMin } : { start: 9 * 60, end: 18 * 60 };
        const s2 = firstFreeSlot(win, dur, allBusy);
        if (s2 != null) { start = s2; shifted = true; sub = `${sub ? `${sub} · ` : ''}Shifted around your calendar`; } else conflict = true;
      }
    }
    if (start != null) items.push({ id: contentMove.id, moveId: contentMove.id, kind: 'content', planner: true, title: contentMove.title, sub, why: contentMove.why, startMin: start, durationMin: dur, status: contentMove.status, userPlaced, shifted, conflict, mandatory: true });
  }
  items.sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999));

  // AI moves for the to-do list (open, non-mandatory) minus user-owned duplicates
  const openTasks = await prisma.task.findMany({ where: { workspaceId, status: 'pending' }, select: { clientId: true, title: true }, take: 300 });
  const openMoves = moves.filter((m) => !m.mandatory && m.status === 'open');
  const visible = redundancyFilter(openMoves, openTasks, clients).map((m) => serializeMove(m, clients, date));

  const meta = (plan && plan.meta) || {};
  return {
    date,
    timeZone: tz,
    today,
    tomorrow,
    isToday: date === today,
    isTomorrow: date === tomorrow,
    isPlanDay,
    generatedAt: plan ? plan.generatedAt : null,
    copySource: meta.copySource || null,
    summary: plan ? plan.summary : null,
    narrative: plan ? plan.narrative : null,
    window,
    offDay: !!day.off,
    workScheduleKnown: day.known,
    scheduleSource: day.source,
    items,
    moves: visible.sort((a, b) => (b.score || 0) - (a.score || 0)),
    counts: {
      appointments: appts.filter((a) => a.status !== 'cancelled').length,
      routine: routine.length,
      moves: visible.length,
      overflow: meta.overflowCount || 0,
    },
    warnings: meta.warnings || [],
    aiAvailable: ai.available(),
  };
}

// ── To-Do board (today + tomorrow, one standing list) ───────────────────
async function getTodoBoard({ workspaceId, userId }) {
  const ctx = await userContext(workspaceId, userId);
  const today = todayFor(ctx.tz);
  const tomorrow = addDays(today, 1);
  const [pToday, pTomorrow] = await Promise.all([
    ensurePlan({ workspaceId, userId, date: today }),
    ensurePlan({ workspaceId, userId, date: tomorrow }),
  ]);
  const { todoBoard } = require('../tasks');
  const board = await todoBoard({ workspaceId, tz: ctx.tz });
  const moves = [
    ...((pToday && pToday.moves) || []).map((m) => ({ m, date: today })),
    ...((pTomorrow && pTomorrow.moves) || []).map((m) => ({ m, date: tomorrow })),
  ].filter(({ m }) => !m.mandatory && m.status === 'open');
  const clients = await clientMinis(workspaceId, moves.map(({ m }) => m.clientId));
  const seen = new Set();
  const deduped = [];
  for (const { m, date } of moves) {
    const k = m.key;
    if (seen.has(k)) continue; // same contact+kind on both days → keep today's
    seen.add(k);
    deduped.push({ m, date });
  }
  const filtered = redundancyFilter(deduped.map(({ m }) => m), board.tasks, clients);
  const keep = new Set(filtered.map((m) => m.id));
  return {
    today,
    tomorrow,
    tasks: board.tasks,
    suggested: board.suggested,
    done: board.done,
    moves: deduped.filter(({ m }) => keep.has(m.id)).map(({ m, date }) => serializeMove(m, clients, date)),
  };
}

// ── actions ─────────────────────────────────────────────────────────────
async function markHandled({ workspaceId, userId, move }) {
  if (!move || move.mandatory) return;
  await prisma.planHandled.upsert({
    where: { userId_key: { userId, key: move.key } },
    create: { workspaceId, userId, key: move.key },
    update: { handledAt: new Date() },
  });
}

async function findMove(workspaceId, userId, id) {
  return prisma.planMove.findFirst({ where: { id, workspaceId, planDay: { userId } }, include: { planDay: true } });
}

async function actOnItem({ workspaceId, userId, itemId, action, body = {} }) {
  const id = String(itemId || '');
  const calendar = require('../calendar');
  const tasks = require('../tasks');
  if (id.startsWith('appt-')) {
    const apptId = id.slice(5);
    if (action === 'done') return { appointment: await calendar.updateAppointment({ workspaceId, id: apptId, patch: { status: 'completed' } }) };
    if (action === 'skip' || action === 'dismiss') return { appointment: await calendar.updateAppointment({ workspaceId, id: apptId, patch: { status: 'cancelled' } }) };
    if (action === 'retime') {
      const appt = await prisma.appointment.findFirst({ where: { id: apptId, workspaceId } });
      if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404 });
      const ctx = await userContext(workspaceId, userId);
      const { zonedTime } = require('../../lib/dates');
      const d = dayKey(new Date(appt.startAt), ctx.tz);
      const startMin = Math.max(0, Math.min(1439, Number(body.startMin)));
      const startAt = zonedTime(d, Math.floor(startMin / 60), startMin % 60, ctx.tz);
      return { appointment: await calendar.updateAppointment({ workspaceId, id: apptId, patch: { startAt, durationMin: body.durationMin || undefined } }) };
    }
    throw Object.assign(new Error('Unsupported action'), { status: 400 });
  }
  if (id.startsWith('task-')) {
    const taskId = id.slice(5);
    if (action === 'done') return { task: await tasks.completeTask({ workspaceId, id: taskId }) };
    if (action === 'skip' || action === 'dismiss') return { task: await tasks.updateTask({ workspaceId, id: taskId, patch: { status: 'cancelled' } }) };
    throw Object.assign(new Error('Unsupported action'), { status: 400 });
  }
  if (id.startsWith('routine-')) return { ok: true, noop: true }; // standing routine can't be "done"

  const move = await findMove(workspaceId, userId, id);
  if (!move) throw Object.assign(new Error('Plan item no longer exists — refresh and try again'), { status: 404 });
  const date = move.planDay.date;
  if (action === 'retime') {
    const startMin = Math.max(0, Math.min(1439, Math.round(Number(body.startMin))));
    const durationMin = Math.max(5, Math.min(720, Math.round(Number(body.durationMin) || move.durationMin)));
    if (!Number.isFinite(startMin)) throw Object.assign(new Error('startMin is required'), { status: 400 });
    await prisma.planMove.update({ where: { id: move.id }, data: { startMin, durationMin, userPlaced: true } });
    if (move.mandatory) {
      const block = move.kind === 'content.block' ? 'content' : 'lunch';
      await prisma.planBlockOverride.upsert({
        where: { userId_date_block: { userId, date, block } },
        create: { workspaceId, userId, date, block, startMin, durationMin },
        update: { startMin, durationMin },
      });
    }
  } else {
    const status = { done: 'done', dismiss: 'dismissed', skip: 'skipped', reopen: 'open' }[action];
    if (!status) throw Object.assign(new Error('Unsupported action'), { status: 400 });
    await prisma.planMove.update({
      where: { id: move.id },
      data: { status, meta: { ...(move.meta || {}), ...(body.reason ? { statusReason: String(body.reason).slice(0, 280) } : {}) } },
    });
    if (status === 'open') await prisma.planHandled.deleteMany({ where: { userId, key: move.key } });
    else await markHandled({ workspaceId, userId, move });
    if (status === 'done' && move.clientId && !move.mandatory) {
      const { logActivity } = require('../../lib/activity');
      logActivity({ workspaceId, clientId: move.clientId, type: 'ai_insight', title: `Battle plan: ${move.title}`, body: 'Marked done', meta: { moveId: move.id, kind: move.kind }, actor: 'agent' });
    }
  }
  hub.broadcast(workspaceId, 'plan_updated', { date, reason: action, itemId: id });
  return { ok: true };
}

// 👍 / 👎 with reasons → AiFeedback (+ optional 30-day mute, + handled on 👎).
async function recordFeedback({ workspaceId, userId, moveId, isCorrect, reasons = [], note = '', mute = false, kind = 'move', feedback }) {
  const move = moveId ? await findMove(workspaceId, userId, moveId) : null;
  const clients = move && move.clientId ? await clientMinis(workspaceId, [move.clientId]) : new Map();
  const name = move && move.clientId && clients.get(move.clientId) ? clients.get(move.clientId).name : null;
  const describe = move ? [`"${move.title}"`, name ? `contact: ${name}` : null, `type: ${move.src || move.kind}`].filter(Boolean).join(' · ') : '';
  const why = [...(reasons || []), note].filter(Boolean).join('; ');
  const text = feedback || (isCorrect ? `Endorsed move ${describe}` : `Rejected move ${describe}${why ? ` — ${why}` : ''}`);
  const row = await prisma.aiFeedback.create({
    data: { workspaceId, userId, kind, contextId: moveId || null, isCorrect: !!isCorrect, feedback: text.slice(0, 1000), meta: { reasons, note: note || null, moveKind: move ? move.kind : null, clientId: move ? move.clientId : null } },
  });
  if (move && !isCorrect) {
    await prisma.planMove.update({ where: { id: move.id }, data: { status: 'dismissed', meta: { ...(move.meta || {}), statusReason: why || 'not useful' } } });
    await markHandled({ workspaceId, userId, move });
  }
  if (move && mute && move.clientId) {
    await prisma.planSuppression.create({
      data: { workspaceId, userId, clientId: move.clientId, reason: `Tap-to-train: ${why || 'not useful'}`.slice(0, 500), expiresAt: new Date(Date.now() + 30 * 864e5) },
    });
  }
  if (move) hub.broadcast(workspaceId, 'plan_updated', { date: move.planDay.date, reason: 'feedback' });
  return { ok: true, id: row.id };
}

// ── "Tell AI why" coach classifier ──────────────────────────────────────
const COACH_SYSTEM = `You convert a luxury real estate agent's free-text coaching about ONE client into a structured instruction for their daily-plan AI. They are reacting to a suggested move (call / text / follow-up) for this client.
Output ONLY a JSON object: {"action":"dont_show"|"defer"|"other","durationDays":<integer 1-365 or null>,"reason":"<concise paraphrase of their rationale>"}.
- "dont_show": stop suggesting this indefinitely (durationDays=null). Use for done / not interested / bought or listed with another agent / wrong person / "stop showing me this".
- "defer": don't suggest until later (durationDays = days from today). Use when they give or imply a timeframe — "next week"=7, "in a month"=30, "give her two weeks"=14, "after the holidays"/"next quarter"=your best estimate.
- "other": NOT a hide/defer instruction (e.g. "book her Friday at 2", "send him the Fisher Island photos"). durationDays=null.
reason must paraphrase the agent's actual rationale — never invent one they did not imply.`;

function classifyCoachDeterministic(note) {
  const t = String(note || '').toLowerCase();
  const num = t.match(/(\d+)\s*(day|week|month)s?/);
  if (num) {
    const n = Number(num[1]);
    const days = num[2] === 'day' ? n : num[2] === 'week' ? n * 7 : n * 30;
    return { action: 'defer', durationDays: Math.max(1, Math.min(365, days)), reason: note.trim().slice(0, 200) };
  }
  if (/\bnext week\b/.test(t)) return { action: 'defer', durationDays: 7, reason: note.trim().slice(0, 200) };
  if (/\b(next month|a month)\b/.test(t)) return { action: 'defer', durationDays: 30, reason: note.trim().slice(0, 200) };
  if (/\b(next quarter|after the holidays|new year)\b/.test(t)) return { action: 'defer', durationDays: 90, reason: note.trim().slice(0, 200) };
  if (/\b(tomorrow)\b/.test(t)) return { action: 'defer', durationDays: 1, reason: note.trim().slice(0, 200) };
  if (/\b(stop|never|not interested|don'?t (suggest|show)|bought|listed with|another agent|other agent|hired|wrong person|remove|no longer|passed away|moved away)\b/.test(t)) {
    return { action: 'dont_show', durationDays: null, reason: note.trim().slice(0, 200) };
  }
  if (/^(call|text|send|book|schedule|email|show|set up|invite|ask)\b/.test(t.trim())) return { action: 'other', durationDays: null, reason: note.trim().slice(0, 200) };
  return null;
}

async function coach({ workspaceId, userId, clientId, note, moveId }) {
  const clean = String(note || '').trim();
  if (!clean) throw Object.assign(new Error('Tell the AI why — even one line helps'), { status: 400 });
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, firstName: true, lastName: true, displayName: true } });
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
  const ctx = await userContext(workspaceId, userId);
  const move = moveId ? await findMove(workspaceId, userId, moveId) : null;
  let result = null; let fallback = false;
  if (ai.available()) {
    try {
      const out = await ai.json({
        system: COACH_SYSTEM,
        prompt: `Today is ${todayFor(ctx.tz)} (${ctx.tz}).\nClient: ${clientName(client)}\nSuggested move: ${move ? `${move.title} (${move.kind})` : 'n/a'}\nAgent coaching: """${clean.slice(0, 1200)}"""\n\nReturn the JSON object only.`,
        schema: { type: 'object', properties: { action: { type: 'string', enum: ['dont_show', 'defer', 'other'] }, durationDays: { type: ['integer', 'null'] }, reason: { type: 'string' } } },
        effort: 'low', maxTokens: 1500, feature: 'battle_plan_coach', workspaceId,
      });
      if (out && ['dont_show', 'defer', 'other'].includes(out.action)) result = out;
    } catch (err) { if (err.code !== 'ai_unavailable') console.warn('[battlePlan] coach AI failed:', err.message); }
  }
  if (!result) {
    result = classifyCoachDeterministic(clean);
    if (!result) { result = { action: 'defer', durationDays: 30, reason: clean.slice(0, 200) }; }
    fallback = true;
  }
  if (result.action === 'other') {
    await prisma.note.create({ data: { workspaceId, clientId: client.id, body: `Coaching: ${clean}`, source: 'agent' } }).catch(() => {});
    const { logActivity } = require('../../lib/activity');
    logActivity({ workspaceId, clientId: client.id, type: 'note', title: 'Coaching note for the AI planner', body: clean, actor: 'agent' });
    return { handled: false, reason: 'not_a_suppression', savedNote: true, contactName: clientName(client) };
  }
  let days = result.action === 'defer' ? Number(result.durationDays) : null;
  if (result.action === 'defer' && (!Number.isFinite(days) || days < 1)) days = 7;
  if (days) days = Math.min(365, Math.round(days));
  const expiresAt = result.action === 'dont_show' ? FAR_FUTURE : new Date(Date.now() + days * 864e5);
  const scope = move && move.clientId === client.id ? 'signal' : 'contact';
  // replace any existing entry with the same scope key
  await prisma.planSuppression.deleteMany({ where: { userId, clientId: client.id, signalKind: scope === 'signal' ? move.kind : null, sourceKind: null } });
  await prisma.planSuppression.create({
    data: { workspaceId, userId, clientId: client.id, signalKind: scope === 'signal' ? move.kind : null, reason: `Coach: ${result.reason || clean}`.slice(0, 500), expiresAt },
  });
  if (move && move.status === 'open') {
    await prisma.planMove.update({ where: { id: move.id }, data: { status: 'dismissed', meta: { ...(move.meta || {}), statusReason: `coach: ${result.reason || clean}`.slice(0, 280) } } });
  }
  await prisma.planMove.updateMany({
    where: { workspaceId, clientId: client.id, status: 'open', mandatory: false, ...(scope === 'signal' ? { kind: move.kind } : {}), planDay: { userId } },
    data: { status: 'dismissed' },
  });
  hub.broadcast(workspaceId, 'plan_updated', { date: move ? move.planDay.date : todayFor(ctx.tz), reason: 'coach' });
  return {
    handled: true, action: result.action, durationDays: result.action === 'dont_show' ? null : days, reason: result.reason || clean,
    contactName: clientName(client), expiresAt, scope, fallback,
  };
}

// ── suppressions ────────────────────────────────────────────────────────
async function listSuppressions({ workspaceId, userId }) {
  const rows = await activeSuppressions(userId);
  const clients = await clientMinis(workspaceId, rows.map((r) => r.clientId));
  return rows.map((r) => ({ ...r, contactName: r.clientId && clients.get(r.clientId) ? clients.get(r.clientId).name : null, indefinite: new Date(r.expiresAt).getUTCFullYear() >= 2099 }));
}

async function suppress({ workspaceId, userId, clientId, reason, durationDays }) {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, firstName: true, lastName: true, displayName: true } });
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
  await prisma.planSuppression.deleteMany({ where: { userId, clientId } });
  const expiresAt = durationDays ? new Date(Date.now() + Math.max(1, Math.min(365, Number(durationDays))) * 864e5) : FAR_FUTURE;
  const row = await prisma.planSuppression.create({ data: { workspaceId, userId, clientId, reason: String(reason || '').slice(0, 500) || null, expiresAt } });
  await prisma.planMove.updateMany({ where: { workspaceId, clientId, status: 'open', mandatory: false, planDay: { userId } }, data: { status: 'dismissed' } });
  hub.broadcast(workspaceId, 'plan_updated', { reason: 'suppress' });
  return { suppression: { ...row, contactName: clientName(client) } };
}

async function unsuppress({ workspaceId, userId, clientId }) {
  await prisma.planSuppression.deleteMany({ where: { workspaceId, userId, clientId } });
  hub.broadcast(workspaceId, 'plan_updated', { reason: 'unsuppress' });
  return { ok: true };
}

// ── self-rules ──────────────────────────────────────────────────────────
function serializeRule(r) {
  const parsed = r.parsed && r.parsed.type ? r.parsed : parseRuleText(r.text);
  return { id: r.id, text: r.text, parsed, label: describeParsed(parsed), active: r.active, createdAt: r.createdAt };
}

async function listRules({ userId }) {
  const rows = await prisma.selfRule.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return rows.map(serializeRule);
}

async function regenerateUpcoming({ workspaceId, userId, reason }) {
  const ctx = await userContext(workspaceId, userId);
  const today = todayFor(ctx.tz);
  await generatePlanDay({ workspaceId, userId, date: today, force: true, reason });
  await generatePlanDay({ workspaceId, userId, date: addDays(today, 1), force: true, reason });
}

async function addRule({ workspaceId, userId, text }) {
  const clean = String(text || '').trim().slice(0, 280);
  if (!clean) throw Object.assign(new Error('Rule text is required'), { status: 400 });
  const count = await prisma.selfRule.count({ where: { userId } });
  if (count >= 30) throw Object.assign(new Error('You can keep up to 30 rules'), { status: 409 });
  const row = await prisma.selfRule.create({ data: { workspaceId, userId, text: clean, parsed: parseRuleText(clean) } });
  regenerateUpcoming({ workspaceId, userId, reason: 'self_rule' }).catch((e) => console.warn('[battlePlan] regen after rule failed:', e.message));
  return serializeRule(row);
}

async function removeRule({ workspaceId, userId, id }) {
  await prisma.selfRule.deleteMany({ where: { id, userId } });
  regenerateUpcoming({ workspaceId, userId, reason: 'self_rule' }).catch((e) => console.warn('[battlePlan] regen after rule failed:', e.message));
  return { ok: true };
}

module.exports = {
  generatePlanDay, ensurePlan, getPlanPayload, getTodoBoard, actOnItem, recordFeedback, coach,
  listSuppressions, suppress, unsuppress, listRules, addRule, removeRule, regenerateUpcoming,
  userContext, candidateSuppressed, classifyCoachDeterministic, redundancyFilter, KIND_BY_APPT,
};

// Campaign engine — the dispatcher for every automated text (campaign
// announcements, no-reply nudges, lane follow-ups, close-outs, event
// reminders, automation triggers, agent-approved drafts).
//
// The recipient row IS the queue (meta.queue + nextSendAt, restart-safe).
// Per tick (10s): schedules → janitor → claim ≤8 due rows (optimistic,
// status+updatedAt guarded, so two API processes can never double-send) →
// processRow:
//   master switch → parent running? → reply-only guard → event guard →
//   finish-by → SENDER GUARD checkSend → draft (AI per recipient, template
//   fallback) → checkContent (redraft on duplicates) → transport.deliver →
//   recordSend → advance the state machine → broadcast campaign_updated.
// No path sends a campaign text without passing the Sender Guard.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const guard = require('./senderGuard');
const transport = require('./transport');
const drafter = require('./drafter');
const seq = require('./sequence');
const Q = require('./queue');
const ics = require('./ics');
const store = require('./settingsStore');
const { resolveAudience } = require('./audience');
const { refreshCached } = require('./stats');
const { CLAIMABLE, NOT_SENT, SEQUENCE_KINDS, AUTOMATION_DEFS } = require('./constants');

const TAKE = 8;
const DRAFTING_STALE_MS = 5 * 60000;
const EVENT_GRACE_MS = 3 * 3600000;

function emit(workspaceId, payload) {
  try { hub.broadcast(workspaceId, 'campaign_updated', { ...payload, at: new Date().toISOString() }); } catch { /* noop */ }
}

const throttles = new Map();
function refreshSoon(campaignId) {
  if (throttles.has(campaignId)) return;
  throttles.set(campaignId, setTimeout(() => { throttles.delete(campaignId); refreshCached(campaignId).catch(() => {}); }, 1500));
}

function runFrame(campaign) { return (campaign && campaign.stats && campaign.stats.run) || {}; }

function guessMime(url) {
  const u = String(url || '').toLowerCase();
  if (/\.(png)(\?|$)/.test(u)) return 'image/png';
  if (/\.(webp)(\?|$)/.test(u)) return 'image/webp';
  if (/\.(gif)(\?|$)/.test(u)) return 'image/gif';
  if (/\.(mp4|mov)(\?|$)/.test(u)) return 'video/mp4';
  if (/\.(pdf)(\?|$)/.test(u)) return 'application/pdf';
  return 'image/jpeg';
}

async function loadListing(workspaceId, listingId) {
  if (!listingId) return null;
  return prisma.listing.findFirst({ where: { id: listingId, workspaceId } }).catch(() => null);
}

// ── Launch ─────────────────────────────────────────────────────────────
async function launchCampaign({ workspaceId, campaignId, startAt, endAt }) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  if (campaign.kind === 'automation') throw new HttpError(400, 'Automations turn on from their switch');
  if (campaign.status !== 'draft') throw new HttpError(409, 'This campaign already launched');
  if (!String(campaign.brief || '').trim()) throw new HttpError(400, 'Tell your AI what to say first (the Message step)');

  const now = Date.now();
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && Number.isNaN(start.getTime())) throw new HttpError(400, 'Bad start time');
  if (end && Number.isNaN(end.getTime())) throw new HttpError(400, 'Bad finish-by time');
  if (end && end.getTime() <= now) throw new HttpError(400, 'The finish-by time is in the past');
  if (start && end && end <= start) throw new HttpError(400, 'The finish-by time is before the start');
  const lanes = campaign.lanes || {};
  const laneSteps = ['green', 'yellow'].flatMap((k) => (lanes[k] && lanes[k].enabled !== false && Array.isArray(lanes[k].steps) ? lanes[k].steps : []));
  if (seq.needsEvent(laneSteps) && !(campaign.event && campaign.event.startAt)) {
    throw new HttpError(400, 'Your follow-ups are timed to the event ("the morning of", "the day before"). Set the event date first on the Event step.');
  }

  const { people } = await resolveAudience(workspaceId, campaign.audience, { limit: 5000 });
  if (!people.length) throw new HttpError(400, 'No one in this audience can be texted');

  const scheduled = !!(start && start.getTime() > now + 60000);
  const base = scheduled ? start.getTime() : now + 5000;
  const clients = await prisma.client.findMany({ where: { workspaceId, id: { in: people.map((p) => p.id) } }, select: { id: true, phone: true, lastInboundAt: true, deviceMode: true } });
  const byId = new Map(clients.map((c) => [c.id, c]));
  const plan = await guard.planLaunch({
    workspaceId, pacing: campaign.pacing, baseMs: base, now: new Date(now),
    people: people.map((p) => ({ id: p.id, phone: p.phone, client: byId.get(p.id) || { id: p.id, phone: p.phone } })),
  });
  let { slots } = plan;
  const rawSpan = slots.length ? slots[slots.length - 1].at.getTime() - base : 0;
  if (end && rawSpan > 0) {
    const available = Math.max(0, end.getTime() - 5 * 60000 - base);
    if (rawSpan > available) {
      const scale = available / rawSpan;
      slots = slots.map((s) => ({ ...s, at: new Date(base + Math.floor((s.at.getTime() - base) * scale)) }));
    }
  }
  await prisma.campaignRecipient.createMany({
    data: slots.map((s) => {
      const q = [Q.item('initial_send', s.at)];
      return { workspaceId, campaignId, clientId: s.id, status: scheduled ? 'scheduled' : 'pending', lane: 'none', nextSendAt: s.at, meta: { queue: q, tier: s.tier, isNew: s.isNew } };
    }),
    skipDuplicates: true,
  });
  const status = scheduled ? 'scheduled' : 'running';
  const prevStats = campaign.stats && typeof campaign.stats === 'object' ? campaign.stats : {};
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status,
      launchedAt: new Date(base),
      pacing: plan.effectivePace,
      stats: { ...prevStats, run: { startAt: scheduled ? start.toISOString() : null, endAt: end ? end.toISOString() : null, launchedAt: new Date(now).toISOString() } },
    },
  });
  await refreshCached(campaignId);
  emit(workspaceId, { campaignId, kind: 'status', status });
  return {
    ok: true, recipients: slots.length, status,
    guard: { coldCount: plan.coldCount, newCount: plan.newCount, existingCount: plan.existingCount, estimatedDays: plan.estimatedDays, dailyNewTarget: plan.dailyNewTarget, pace: plan.effectivePace },
  };
}

// ── Pause / resume / stop ──────────────────────────────────────────────
async function pauseCampaign({ workspaceId, campaignId }) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c) throw new HttpError(404, 'Campaign not found');
  if (!['running', 'scheduled'].includes(c.status)) throw new HttpError(409, 'Only a running campaign can be paused');
  const stats = { ...(c.stats || {}), run: { ...runFrame(c), pausedAt: new Date().toISOString(), pausedFrom: c.status } };
  await prisma.campaign.update({ where: { id: c.id }, data: { status: 'paused', stats } });
  emit(workspaceId, { campaignId, kind: 'status', status: 'paused' });
  return { ok: true, status: 'paused' };
}

async function resumeCampaign({ workspaceId, campaignId }) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c) throw new HttpError(404, 'Campaign not found');
  if (c.status !== 'paused') throw new HttpError(409, 'This campaign is not paused');
  const run = runFrame(c);
  const shift = run.pausedAt ? Date.now() - new Date(run.pausedAt).getTime() : 0;
  if (shift > 1000) {
    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id, nextSendAt: { not: null } }, select: { id: true, meta: true } });
    for (const r of rows) {
      const q = Q.queueOf(r).map((i) => (i.kind === 'reminder_step' ? i : { ...i, at: new Date(new Date(i.at).getTime() + shift).toISOString() }));
      await prisma.campaignRecipient.update({ where: { id: r.id }, data: Q.withQueue(Q.metaOf(r), q) }).catch(() => {});
    }
  }
  const next = run.pausedFrom === 'scheduled' && c.launchedAt && new Date(c.launchedAt).getTime() + shift > Date.now() ? 'scheduled' : 'running';
  const { pausedAt, pausedFrom, ...rest } = run;
  await prisma.campaign.update({
    where: { id: c.id },
    data: { status: next, ...(next === 'scheduled' && c.launchedAt ? { launchedAt: new Date(new Date(c.launchedAt).getTime() + shift) } : {}), stats: { ...(c.stats || {}), run: rest } },
  });
  emit(workspaceId, { campaignId, kind: 'status', status: next });
  return { ok: true, status: next };
}

async function stopCampaign({ workspaceId, campaignId }) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c) throw new HttpError(404, 'Campaign not found');
  if (c.kind === 'automation') throw new HttpError(400, 'Turn the automation off instead');
  if (['draft', 'completed'].includes(c.status)) throw new HttpError(409, 'Nothing is running');
  const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id }, select: { id: true, status: true, meta: true, lastSentAt: true } });
  for (const r of rows) {
    const unsent = NOT_SENT.includes(r.status) && !r.lastSentAt;
    await prisma.campaignRecipient.update({
      where: { id: r.id },
      data: { ...Q.withQueue(Q.metaOf(r), []), ...(unsent ? { status: 'canceled', error: 'Campaign stopped before their text' } : {}) },
    }).catch(() => {});
  }
  await prisma.aiInsight.updateMany({ where: { workspaceId, type: 'campaign_reply_suggestion', status: 'new', data: { path: ['campaignId'], equals: c.id } }, data: { status: 'dismissed' } }).catch(() => {});
  await prisma.campaign.update({
    where: { id: c.id },
    data: { status: 'completed', completedAt: new Date(), stats: { ...(c.stats || {}), run: { ...runFrame(c), canceledAt: new Date().toISOString() } } },
  });
  await refreshCached(c.id);
  emit(workspaceId, { campaignId, kind: 'status', status: 'completed' });
  return { ok: true, status: 'completed' };
}

// ── Schedules (one pass per tick) ──────────────────────────────────────
let tickCount = 0;
async function enforceSchedules(now = new Date()) {
  const toStart = await prisma.campaign.findMany({ where: { status: 'scheduled', launchedAt: { lte: now } }, select: { id: true, workspaceId: true } });
  for (const c of toStart) {
    await prisma.campaign.update({ where: { id: c.id }, data: { status: 'running' } }).catch(() => {});
    await prisma.campaignRecipient.updateMany({ where: { campaignId: c.id, status: 'scheduled' }, data: { status: 'pending' } }).catch(() => {});
    emit(c.workspaceId, { campaignId: c.id, kind: 'status', status: 'running' });
  }
  const running = await prisma.campaign.findMany({ where: { status: 'running', kind: { not: 'automation' } }, select: { id: true, workspaceId: true, stats: true, event: true } });
  for (const c of running) {
    const run = runFrame(c);
    if (run.endAt && new Date(run.endAt) <= now) {
      const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id }, select: { id: true, status: true, meta: true, lastSentAt: true } });
      for (const r of rows) {
        const q = Q.queueOf(r).filter((i) => !['initial_send', 'gray_check'].includes(i.kind));
        const unsent = NOT_SENT.includes(r.status) && !r.lastSentAt;
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { ...Q.withQueue(Q.metaOf(r), q), ...(unsent ? { status: 'canceled', error: 'Finish-by time reached' } : {}) } }).catch(() => {});
      }
      await prisma.campaign.update({ where: { id: c.id }, data: { status: 'completed', completedAt: now } }).catch(() => {});
      await refreshCached(c.id);
      emit(c.workspaceId, { campaignId: c.id, kind: 'status', status: 'completed' });
      continue;
    }
    // Auto-complete a fully-sent blast once its listening window has passed
    // (72h after its event, or 14 days after the last text) and nothing is queued.
    if (tickCount % 6 === 0) {
      const queued = await prisma.campaignRecipient.count({ where: { campaignId: c.id, OR: [{ nextSendAt: { not: null } }, { status: { in: NOT_SENT } }] } });
      if (!queued) {
        const last = await prisma.campaignRecipient.findFirst({ where: { campaignId: c.id, lastSentAt: { not: null } }, orderBy: { lastSentAt: 'desc' }, select: { lastSentAt: true } });
        const evAt = c.event && c.event.startAt ? new Date(c.event.startAt) : null;
        const doneAt = evAt ? evAt.getTime() + 72 * 3600000 : (last ? new Date(last.lastSentAt).getTime() + 14 * 86400000 : 0);
        if (doneAt && doneAt < now.getTime()) {
          await prisma.campaign.update({ where: { id: c.id }, data: { status: 'completed', completedAt: now } }).catch(() => {});
          emit(c.workspaceId, { campaignId: c.id, kind: 'status', status: 'completed' });
        }
      }
    }
  }
}

// ── Janitor ────────────────────────────────────────────────────────────
async function janitor(now = new Date()) {
  const stale = await prisma.campaignRecipient.findMany({ where: { status: 'drafting', updatedAt: { lt: new Date(now.getTime() - DRAFTING_STALE_MS) } }, select: { id: true, meta: true } });
  for (const r of stale) {
    const m = Q.metaOf(r);
    await prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'drafting' }, data: { status: m.claimedFrom || (m.initialSentAt ? 'sent' : 'pending') } }).catch(() => {});
  }
  const back = await prisma.campaignRecipient.findMany({ where: { status: 'rate_deferred', nextSendAt: { lte: now } }, select: { id: true, meta: true, lastSentAt: true, repliedAt: true } });
  for (const r of back) {
    const m = Q.metaOf(r);
    const resume = m.resumeStatus && m.resumeStatus !== 'rate_deferred' ? m.resumeStatus : (r.repliedAt ? 'replied' : r.lastSentAt ? 'sent' : 'pending');
    await prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'rate_deferred' }, data: { status: resume } }).catch(() => {});
  }
}

// ── Finish a claimed row safely ────────────────────────────────────────
// build(latest, stillOurs) -> data patch. If something else changed the row
// while we were drafting (opt-out, mute, takeover, a reply), their status and
// queue win; we only record the send facts.
async function finish(row, build) {
  for (let i = 0; i < 2; i += 1) {
    const latest = await prisma.campaignRecipient.findUnique({ where: { id: row.id } });
    if (!latest) return;
    if (latest.status === 'drafting') {
      const r = await prisma.campaignRecipient.updateMany({ where: { id: row.id, status: 'drafting', updatedAt: latest.updatedAt }, data: build(latest, true) });
      if (r.count === 1) return;
    } else {
      const { status, ...rest } = build(latest, false); // their status wins
      await prisma.campaignRecipient.update({ where: { id: row.id }, data: rest }).catch(() => {});
      return;
    }
  }
}

// Put the row back as it was (still due or with a new time).
function releaseData(latest, from, patch = {}) {
  return { status: from, ...patch };
}

// Drop one queue item, optionally change status.
function dropItem(latest, itemId, extra = {}) {
  const q = Q.queueOf(latest).filter((i) => i.id !== itemId);
  return { ...Q.withQueue(Q.metaOf(latest), q), ...extra };
}

function guardKind(item) {
  if (item.kind === 'approved_send') return item.payload && item.payload.origin === 'auto_step' ? 'auto_step' : 'lane_step';
  return item.kind;
}

async function initialAttachments({ campaign, listing, agentName, green }) {
  const step0 = (Array.isArray(campaign.steps) && campaign.steps[0]) || {};
  const atts = [];
  if (step0.attachment && step0.attachment.url) atts.push({ url: step0.attachment.url, mimeType: step0.attachment.mimeType || guessMime(step0.attachment.url), fileName: step0.attachment.fileName || 'attachment' });
  if (step0.includePhoto && listing) {
    const photo = listing.heroPhoto || (listing.photoUrls || [])[0];
    if (photo) atts.push({ url: photo, mimeType: guessMime(photo), fileName: 'listing.jpg' });
  }
  if (!green && ics.inviteEnabled(campaign)) {
    const f = ics.inviteFile(campaign, { agentName });
    if (f) atts.push({ url: f.url, mimeType: f.mimeType, fileName: f.fileName });
  }
  return atts;
}

// ── processRow ─────────────────────────────────────────────────────────
async function processRow(row, from, ctx) {
  const now = new Date();
  const campaign = row.campaign;
  const { workspaceId } = row;
  const meta = Q.metaOf(row);
  const item = Q.dueItem(row, now);
  if (!item) {
    await finish(row, (l) => ({ status: from, ...Q.withQueue(Q.metaOf(l), Q.queueOf(l)) }));
    return;
  }
  const isAuto = campaign.kind === 'automation';
  const isSeq = SEQUENCE_KINDS.includes(item.kind);
  const run = runFrame(campaign);

  // Master switch: hold (never cancel) every automated text.
  if (ctx.isPaused(workspaceId)) { await finish(row, (l) => releaseData(l, from)); return; }

  // Parent running?
  const running = campaign.status === 'running' || (campaign.status === 'completed' && !isAuto && isSeq && !run.canceledAt);
  if (!running) {
    if (campaign.status === 'completed') {
      await finish(row, (l) => dropItem(l, item.id, { status: from === 'drafting' ? 'sent' : from, ...(NOT_SENT.includes(from) && !l.lastSentAt ? { status: 'canceled' } : {}) }));
    } else {
      await finish(row, (l) => releaseData(l, from));
    }
    return;
  }

  // An automation trigger that sat past its window (automation was off, or a
  // long outage) is skipped, never sent late: no birthday text a week after.
  if (item.kind === 'auto_step' && now.getTime() - new Date(item.at).getTime() > 36 * 3600000 && !item.deferred) {
    await finish(row, (l) => dropItem(l, item.id, { status: from, error: 'Skipped: the moment for this text passed' }));
    return;
  }

  // Follow-ups answer a reply: never to someone who never wrote back (unless
  // the agent placed them in a lane), never after the agent took over.
  if (['lane_step', 'close_out'].includes(item.kind) && !meta.lastInboundAt && !meta.laneLockedByAgent) {
    await finish(row, (l) => dropItem(l, item.id, { status: from }));
    return;
  }
  if (from === 'taken_over' && item.kind !== 'reminder_step') {
    await finish(row, (l) => dropItem(l, item.id, { status: 'taken_over' }));
    return;
  }

  // Iron-clad event guard: no anticipation text after the event.
  const eventAt = campaign.event && campaign.event.startAt ? new Date(campaign.event.startAt) : null;
  const isEventReminder = (item.kind === 'lane_step' && ['green', 'yellow'].includes(row.lane)) || item.kind === 'reminder_step';
  if (eventAt && isEventReminder && now.getTime() > eventAt.getTime() + EVENT_GRACE_MS) {
    await finish(row, (l) => dropItem(l, item.id, { status: from, error: 'Event passed, reminder skipped' }));
    return;
  }
  // Finish-by kills unsent announcements and the nudge.
  if (run.endAt && new Date(run.endAt) <= now && ['initial_send', 'gray_check'].includes(item.kind)) {
    await finish(row, (l) => dropItem(l, item.id, item.kind === 'initial_send' ? { status: 'canceled', error: 'Finish-by time reached' } : { status: from }));
    return;
  }

  const client = await prisma.client.findFirst({ where: { id: row.clientId, workspaceId } });
  if (!client || !client.phone) {
    await finish(row, (l) => dropItem(l, item.id, { status: 'failed', error: client ? 'No phone number on file' : 'Client not found' }));
    return;
  }

  // Automation in draft-approval mode: draft for the agent, send nothing.
  const def = isAuto ? AUTOMATION_DEFS[campaign.trigger] : null;
  const approval = isAuto ? ((campaign.audience && campaign.audience.approval) || (def && def.approval) || 'auto') : 'auto';
  const listing = await loadListing(workspaceId, (item.payload && item.payload.listingId) || (Array.isArray(campaign.steps) && campaign.steps[0] && campaign.steps[0].listingId));
  const agent = await ctx.agent(workspaceId);

  if (item.kind === 'auto_step' && approval === 'draft') {
    const step = Array.isArray(campaign.steps) ? campaign.steps[item.step || 0] : null;
    const d = await drafter.draft({ workspaceId, campaign, client, kind: 'auto_step', stepIndex: item.step || 0, stepBrief: (step && step.instructions) || campaign.brief, listing, event: null, agent, extra: (item.payload && item.payload.facts) || {} });
    const suggestions = require('./suggestions');
    const insight = await suggestions.createDraftForApproval({ workspaceId, campaign, recipientId: row.id, client, text: d.text, via: d.via, item, listing });
    await finish(row, (l) => dropItem(l, item.id, { status: from, error: null, meta: { ...Q.metaOf(l), queue: Q.queueOf(l).filter((i) => i.id !== item.id), awaitingApproval: insight && insight.id } }));
    emit(workspaceId, { campaignId: campaign.id, kind: 'suggestion', recipientId: row.id });
    return;
  }

  // ── SENDER GUARD: before drafting ──
  const check = await guard.checkSend({ workspaceId, client, kind: guardKind(item), now });
  if (!check.allow) {
    if (check.deferUntil) {
      const at = new Date(check.deferUntil).toISOString();
      await finish(row, (l, ours) => {
        const q = Q.queueOf(l).map((i) => (i.id === item.id ? { ...i, at, deferred: true } : i));
        return { ...Q.withQueue({ ...Q.metaOf(l), resumeStatus: from }, q), ...(ours ? { status: 'rate_deferred', error: check.reason } : {}) };
      });
    } else if (check.code === 'opted_out') {
      await finish(row, (l) => ({ ...Q.withQueue(Q.metaOf(l), []), status: 'opted_out', error: check.reason }));
    } else {
      await finish(row, (l) => dropItem(l, item.id, { status: item.kind === 'initial_send' || (item.kind === 'auto_step' && !l.lastSentAt) ? 'canceled' : from, error: check.reason }));
    }
    emit(workspaceId, { campaignId: campaign.id, kind: 'deferred', recipientId: row.id, reason: check.reason });
    return;
  }

  // ── What to send ──
  const lanes = campaign.lanes || {};
  let text = null;
  let via = 'template';
  let citations = [];
  if (item.kind === 'approved_send') {
    text = item.payload && item.payload.text;
    via = 'approved';
  } else {
    let stepBrief = null;
    let stepIndex = item.step || 0;
    if (item.kind === 'gray_check') stepBrief = (lanes.gray && lanes.gray.text) || 'One easy nudge, no pressure, did they see it';
    else if (item.kind === 'lane_step' || item.kind === 'close_out') {
      const steps = (lanes[row.lane] && lanes[row.lane].steps) || [];
      const step = steps[item.kind === 'close_out' ? 0 : stepIndex];
      stepBrief = (step && step.brief) || (lanes[row.lane] && lanes[row.lane].text) || null;
    } else if (item.kind === 'reminder_step') {
      const steps = (lanes.reminders && lanes.reminders.steps) || [];
      const step = steps[stepIndex];
      stepBrief = (step && step.brief) || 'A short reminder with the time and address';
    } else if (item.kind === 'auto_step') {
      const step = Array.isArray(campaign.steps) ? campaign.steps[stepIndex] : null;
      stepBrief = (step && step.instructions) || campaign.brief;
    }
    const d = await drafter.draft({
      workspaceId, campaign, client, kind: item.kind, lane: row.lane, stepIndex, stepBrief, listing,
      event: isAuto ? null : campaign.event, agent, tier: check.tier, extra: (item.payload && item.payload.facts) || {},
    });
    ({ text, via, citations } = d);
  }
  if (!text || !String(text).trim()) {
    await finish(row, (l) => dropItem(l, item.id, { status: 'failed', error: 'Could not write this text' }));
    return;
  }

  let attachments = [];
  if (item.kind === 'initial_send') attachments = await initialAttachments({ campaign, listing, agentName: agent.firstName, green: check.green });
  else if (item.kind === 'auto_step' && listing && (listing.heroPhoto || (listing.photoUrls || [])[0]) && campaign.steps && campaign.steps[item.step || 0] && campaign.steps[item.step || 0].includePhoto) {
    const photo = listing.heroPhoto || listing.photoUrls[0];
    attachments = [{ url: photo, mimeType: guessMime(photo), fileName: 'listing.jpg' }];
  } else if (item.kind === 'approved_send' && Array.isArray(item.payload && item.payload.attachments)) attachments = item.payload.attachments;
  if (check.stripAttachment) attachments = [];

  // ── SENDER GUARD: after drafting (duplicates → redraft) ──
  let content = await guard.checkContent({ check, text, attachments, now });
  for (let attempt = 1; !content.allow && content.redraft && item.kind !== 'approved_send' && attempt <= 3; attempt += 1) {
    const d = await drafter.draft({ workspaceId, campaign, client, kind: item.kind, lane: row.lane, stepIndex: item.step || 0, stepBrief: null, listing, event: isAuto ? null : campaign.event, agent, tier: check.tier, attempt });
    ({ text, via, citations } = d);
    content = await guard.checkContent({ check, text, attachments, now });
  }
  if (!content.allow) {
    const at = new Date(content.deferUntil || now.getTime() + 6 * 3600000).toISOString();
    await finish(row, (l, ours) => {
      const q = Q.queueOf(l).map((i) => (i.id === item.id ? { ...i, at } : i));
      return { ...Q.withQueue({ ...Q.metaOf(l), resumeStatus: from }, q), ...(ours ? { status: 'rate_deferred', error: content.reason } : {}) };
    });
    return;
  }

  // ── Send ──
  let sent;
  try {
    sent = await transport.deliver({ workspaceId, client, body: text, attachments, campaignId: campaign.id, recipientId: row.id, aiGenerated: true });
  } catch (err) {
    const offline = /offline|kill ?switch|disabled|not connected|unavailable|paused/i.test(String(err.message || ''));
    if (offline) {
      const at = new Date(now.getTime() + 5 * 60000).toISOString();
      await finish(row, (l, ours) => ({ ...Q.withQueue({ ...Q.metaOf(l), resumeStatus: from }, Q.queueOf(l).map((i) => (i.id === item.id ? { ...i, at } : i))), ...(ours ? { status: 'rate_deferred', error: 'Messaging is offline. Retrying shortly' } : {}) }));
    } else {
      await guard.recordFailure({ workspaceId, now }).catch(() => {});
      await finish(row, (l) => dropItem(l, item.id, { status: item.kind === 'initial_send' ? 'failed' : from, error: `Send failed: ${String(err.message || err).slice(0, 160)}` }));
    }
    emit(workspaceId, { campaignId: campaign.id, kind: 'failed', recipientId: row.id });
    return;
  }
  const message = sent && sent.message;
  if (!message || message.status === 'failed') {
    await guard.recordFailure({ workspaceId, now }).catch(() => {});
    await finish(row, (l) => dropItem(l, item.id, { status: item.kind === 'initial_send' ? 'failed' : from, error: (message && message.error) || 'The text did not go out' }));
    emit(workspaceId, { campaignId: campaign.id, kind: 'failed', recipientId: row.id });
    return;
  }
  await guard.recordSend({ workspaceId, check, service: message.service, now }).catch((e) => console.error('[campaigns/engine] recordSend failed:', e.message));

  // ── Advance the state machine ──
  const sendRec = { messageId: message.id, kind: item.kind, lane: row.lane, step: item.step || 0, at: now.toISOString(), preview: String(text).slice(0, 140), via, citations };
  const conversationId = (sent.conversation && sent.conversation.id) || message.conversationId;
  await finish(row, (l, ours) => {
    const m = Q.metaOf(l);
    let q = Q.queueOf(l).filter((i) => i.id !== item.id);
    const data = { lastSentAt: now, draft: String(text).slice(0, 2000), error: null };
    const { claimedFrom: _c, resumeStatus: _r, ...base } = m;
    const nextMeta = { ...base, conversationId: conversationId || m.conversationId, sends: [...(m.sends || []), sendRec].slice(-12), draftAttempts: 0 };
    if (item.kind === 'initial_send' || item.kind === 'auto_step') {
      if (!m.initialSentAt) nextMeta.initialSentAt = now.toISOString();
      if (nextMeta.awaitingApproval) delete nextMeta.awaitingApproval;
      if (ours && !isAuto) {
        const gray = lanes.gray || {};
        const grayHours = gray.enabled !== false && String(gray.text || '').trim() ? (Number(gray.timerHours) || 48) : 0;
        if (grayHours && item.kind === 'initial_send') {
          const at = new Date(now.getTime() + grayHours * 3600000);
          if (!run.endAt || at < new Date(run.endAt)) q.push(Q.item('gray_check', at));
        }
        const rem = lanes.reminders || {};
        if (item.kind === 'initial_send' && rem.enabled && rem.audience === 'everyone' && eventAt && !q.some((i) => i.kind === 'reminder_step')) {
          const first = seq.resolveReminderSchedule(rem.steps || [], 0, eventAt, now, agent.tz);
          if (first) q.push(Q.item('reminder_step', first.at, { step: first.index }));
        }
      }
    } else if (item.kind === 'lane_step' && ours) {
      const steps = (lanes[l.lane] && lanes[l.lane].steps) || [];
      const nextIndex = (item.step || 0) + 1;
      const nextStep = steps[nextIndex];
      if (nextStep && lanes[l.lane].enabled !== false) {
        q.push(Q.item('lane_step', seq.resolveStepTime(nextStep, { eventAt, base: now, tz: agent.tz }), { step: nextIndex, lane: l.lane }));
        data.stepIndex = nextIndex;
      }
    } else if (item.kind === 'reminder_step') {
      const rem = lanes.reminders || {};
      const next = seq.resolveReminderSchedule(rem.steps || [], (item.step || 0) + 1, eventAt, now, agent.tz);
      if (next) q.push(Q.item('reminder_step', next.at, { step: next.index }));
    } else if (item.kind === 'approved_send' && item.payload && item.payload.insightId) {
      prisma.aiInsight.update({ where: { id: item.payload.insightId }, data: { status: 'acted' } }).catch(() => {});
    }
    if (ours) data.status = l.repliedAt ? (from === 'taken_over' ? 'taken_over' : 'replied') : (from === 'taken_over' ? 'taken_over' : 'sent');
    return { ...data, ...Q.withQueue(nextMeta, q) };
  });

  if (item.kind === 'initial_send' || item.kind === 'auto_step') {
    try {
      const { logActivity } = require('../../lib/activity');
      logActivity({ workspaceId, clientId: client.id, type: 'campaign', title: isAuto ? `${campaign.name} text sent` : `Campaign text: ${campaign.name}`, body: String(text).slice(0, 280), meta: { campaignId: campaign.id, recipientId: row.id, messageId: message.id, kind: item.kind }, actor: 'ai' });
    } catch { /* timeline is best effort */ }
  }
  refreshSoon(campaign.id);
  emit(workspaceId, { campaignId: campaign.id, kind: 'progress', recipientId: row.id, sendKind: item.kind });
}

// ── Tick ───────────────────────────────────────────────────────────────
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  tickCount += 1;
  try {
    const now = new Date();
    await enforceSchedules(now).catch((e) => console.error('[campaigns/engine] schedules:', e.message));
    await janitor(now).catch((e) => console.error('[campaigns/engine] janitor:', e.message));
    const pausedRows = await prisma.$queryRaw`SELECT id FROM "Workspace" WHERE settings->>'aiTextingPausedAt' IS NOT NULL`.catch(() => []);
    const pausedIds = pausedRows.map((r) => r.id);
    const due = await prisma.campaignRecipient.findMany({
      where: { status: { in: CLAIMABLE }, nextSendAt: { not: null, lte: now }, campaign: { status: { in: ['running', 'completed'] } }, ...(pausedIds.length ? { workspaceId: { notIn: pausedIds } } : {}) },
      include: { campaign: true },
      orderBy: { nextSendAt: 'asc' },
      take: TAKE,
    });
    if (!due.length) return;
    const pausedCache = new Map();
    const agentCache = new Map();
    for (const ws of new Set(due.map((r) => r.workspaceId))) {
      const v = await store.getKey(ws, 'aiTextingPausedAt').catch(() => null);
      pausedCache.set(ws, !!v);
    }
    const ctx = {
      isPaused: (ws) => !!pausedCache.get(ws),
      agent: async (ws) => {
        if (!agentCache.has(ws)) agentCache.set(ws, await drafter.agentInfo(ws));
        return agentCache.get(ws);
      },
    };
    for (const row of due) {
      if (ctx.isPaused(row.workspaceId)) continue; // held, stays due
      const from = row.status;
      const claim = await prisma.campaignRecipient.updateMany({
        where: { id: row.id, status: from, updatedAt: row.updatedAt },
        data: { status: 'drafting', meta: { ...Q.metaOf(row), claimedFrom: from } },
      });
      if (claim.count !== 1) continue;
      try {
        await processRow(row, from, ctx);
      } catch (err) {
        console.error('[campaigns/engine] row failed:', err);
        await prisma.campaignRecipient.updateMany({ where: { id: row.id, status: 'drafting' }, data: { status: from, nextSendAt: new Date(Date.now() + 10 * 60000), error: `Retrying: ${String(err.message || err).slice(0, 160)}` } }).catch(() => {});
      }
    }
  } finally {
    ticking = false;
  }
}

module.exports = { tick, launchCampaign, pauseCampaign, resumeCampaign, stopCampaign, enforceSchedules, janitor, processRow, emit, refreshSoon, initialAttachments, loadListing };

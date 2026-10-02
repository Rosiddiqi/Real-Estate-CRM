// Campaign reply pipeline — the fishing-boat rule's second half.
//
// onInboundMessage({workspaceId, clientId, conversationId, message}):
//   1. START/UNSTOP → opt back in.  2. Find the client's active recipient row
//   (workspace-scoped; bounded listening: a completed campaign stops claiming
//   replies 72h after its event, or 14 days after its text; a stopped one is
//   record-only).  3. Base update: lastInboundAt/repliedAt, cancel the no-reply
//   nudge, move the thread to the main inbox (Conversation.lane='active').
//   4. STOP / soft no → opted out for good (Client.textOptOut) + the number's
//   breaker + one fixed confirmation on a hard STOP.  5. Classify (AI +
//   keywords): off_topic → stand down (cancel pending automation, no lane, the
//   thread is the agent's); question → lane recorded, NO auto follow-up, and if
//   "When they respond" is on the reply agent DRAFTS an answer for approval;
//   lane → schedule that lane's follow-ups (new lane restarts at step 0).
//   6. Event reminders follow the lane.
// onManualOutbound(...): the agent texting a recipient themselves → that row is
//   taken_over for good (lane steps, close-outs, nudges, drafts die; event
//   reminders survive).
//
// Wiring: no shared event bus — pollReplies() scans new Messages every 15s
// (jobs/campaignReplies.js) from a cursor in Workspace.settings.campaignCursor.
// Each (recipient, message) pair is claimed atomically, so it is processed once
// even with two API processes running.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const guard = require('./senderGuard');
const Q = require('./queue');
const seq = require('./sequence');
const store = require('./settingsStore');
const { classifyReply } = require('./classifier');
const { LISTENING } = require('./constants');

const COMPLETED_EVENT_GRACE_MS = 72 * 3600000;
const COMPLETED_NO_EVENT_GRACE_MS = 14 * 86400000;
const AUTOMATION_LISTEN_MS = 14 * 86400000;

function emit(workspaceId, payload) {
  try { hub.broadcast(workspaceId, 'campaign_updated', { ...payload, at: new Date().toISOString() }); } catch { /* noop */ }
}

function listening(row, now = new Date()) {
  const c = row.campaign;
  if (!c) return { ok: false };
  const meta = Q.metaOf(row);
  if (c.kind === 'automation') {
    const sent = meta.initialSentAt ? new Date(meta.initialSentAt).getTime() : 0;
    return { ok: !!sent && now.getTime() - sent <= AUTOMATION_LISTEN_MS, recordOnly: false };
  }
  const run = (c.stats && c.stats.run) || {};
  if (['running', 'paused', 'scheduled'].includes(c.status)) return { ok: true, recordOnly: false };
  if (c.status === 'completed') {
    if (run.canceledAt) return { ok: true, recordOnly: true };
    const ev = c.event && c.event.startAt ? new Date(c.event.startAt) : null;
    if (ev && !Number.isNaN(ev.getTime())) return { ok: now.getTime() <= ev.getTime() + COMPLETED_EVENT_GRACE_MS, recordOnly: false };
    const sent = meta.initialSentAt ? new Date(meta.initialSentAt).getTime() : 0;
    return { ok: !!sent && now.getTime() <= sent + COMPLETED_NO_EVENT_GRACE_MS, recordOnly: false };
  }
  return { ok: false };
}

// The client's live recipient row (an exact conversation match wins, then the
// most recently texted).
async function findActiveRecipient({ workspaceId, clientId, conversationId, now = new Date(), statuses = LISTENING }) {
  const rows = await prisma.campaignRecipient.findMany({
    where: { workspaceId, clientId, status: { in: statuses } },
    include: { campaign: true },
    orderBy: [{ lastSentAt: 'desc' }, { createdAt: 'desc' }],
    take: 12,
  });
  const live = rows.filter((r) => listening(r, now).ok);
  live.sort((a, b) => {
    const ac = conversationId && Q.metaOf(a).conversationId === conversationId ? 0 : 1;
    const bc = conversationId && Q.metaOf(b).conversationId === conversationId ? 0 : 1;
    return ac - bc;
  });
  return live[0] || null;
}

// Claim (recipient, message) once — atomic jsonb append guarded by "not seen".
async function claimMessage(recipientId, messageId) {
  const n = await prisma.$executeRaw`UPDATE "CampaignRecipient"
    SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{seen}',
      (COALESCE(meta->'seen', '[]'::jsonb) || to_jsonb(${messageId}::text)), true)
    WHERE id = ${recipientId} AND NOT (COALESCE(meta->'seen', '[]'::jsonb) ? ${messageId})`;
  return n === 1;
}

async function threadTail(conversationId) {
  if (!conversationId) return [];
  const msgs = await prisma.message.findMany({ where: { conversationId, body: { not: null } }, orderBy: { sentAt: 'desc' }, take: 8, select: { body: true, isFromMe: true } }).catch(() => []);
  return msgs.reverse().map((m) => `${m.isFromMe ? 'AGENT' : 'CLIENT'}: ${String(m.body).slice(0, 220)}`);
}

async function moveThreadToInbox(workspaceId, conversationId) {
  if (!conversationId) return;
  try {
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId } });
    if (conv && conv.lane === 'automations') {
      const updated = await prisma.conversation.update({ where: { id: conv.id }, data: { lane: 'active' } });
      hub.broadcast(workspaceId, 'conversation_updated', updated);
    }
  } catch (err) { console.error('[campaigns/replies] lane move failed:', err.message); }
}

// Lane landing + (re)scheduling — shared by the live reply path and the
// agent's manual lane correction.
function laneData({ row, lane, now, tz, kind = 'lane' }) {
  const c = row.campaign || {};
  const lanes = c.lanes || {};
  const rules = lanes[lane] || null;
  const enabled = rules && rules.enabled !== false;
  const meta = Q.metaOf(row);
  const eventAt = c.event && c.event.startAt ? c.event.startAt : null;
  // Drop pending conversation follow-ups + the nudge; keep event reminders.
  let q = Q.queueOf(row).filter((i) => !['lane_step', 'close_out', 'gray_check'].includes(i.kind));
  const switching = row.lane !== lane;
  let stepIndex = switching ? 0 : row.stepIndex;
  if (kind === 'lane' && enabled) {
    const steps = Array.isArray(rules.steps) ? rules.steps : [];
    if (lane === 'red') {
      if (steps.length || String(rules.text || '').trim()) q.push(Q.item('close_out', new Date(now.getTime() + 2 * 60000), { lane: 'red' }));
    } else if (steps[stepIndex]) {
      q.push(Q.item('lane_step', seq.resolveStepTime(steps[stepIndex], { eventAt, base: now, tz }), { step: stepIndex, lane }));
    }
  }
  // Event reminders follow the lane (default audience = people who said yes).
  const rem = lanes.reminders || {};
  const wantReminders = rem.enabled && eventAt && Array.isArray(rem.steps) && rem.steps.length
    && (rem.audience === 'everyone' ? lane !== 'red' : lane === 'green');
  if (!wantReminders) q = q.filter((i) => i.kind !== 'reminder_step');
  else if (!q.some((i) => i.kind === 'reminder_step')) {
    const first = seq.resolveReminderSchedule(rem.steps, 0, eventAt, now, tz);
    if (first) q.push(Q.item('reminder_step', first.at, { step: first.index }));
  }
  if (switching) stepIndex = 0;
  return { lane, stepIndex, ...Q.withQueue({ ...meta, laneSetAt: switching ? now.toISOString() : (meta.laneSetAt || now.toISOString()) }, q) };
}

async function onInboundMessage({ workspaceId, clientId, conversationId, message }) {
  if (!workspaceId || !clientId || !message) return { handled: false };
  const now = new Date();
  const text = String(message.body || '').trim();

  // START / UNSTOP from someone who opted out: let them back in.
  if (guard.isOptIn(text)) {
    const c = await prisma.client.findFirst({ where: { id: clientId, workspaceId, textOptOut: true }, select: { id: true } });
    if (c) { await guard.optIn({ workspaceId, clientId }); emit(workspaceId, { kind: 'opt_in', clientId }); }
  }

  const row = await findActiveRecipient({ workspaceId, clientId, conversationId, now });
  const hardStop = guard.isHardStop(text);
  if (!row) {
    // Not in a campaign: a hard STOP still flags them so nothing automated
    // ever reaches them (the inbox owns any reply to a manual thread).
    if (hardStop) {
      await prisma.client.updateMany({ where: { id: clientId, workspaceId, textOptOut: false }, data: { textOptOut: true, textOptOutAt: now, textOptOutReason: `stop: ${text.slice(0, 120)}` } }).catch(() => {});
    }
    return { handled: false };
  }
  if (!(await claimMessage(row.id, message.id))) return { handled: false, duplicate: true };
  const { recordOnly } = listening(row, now);
  const campaign = row.campaign;
  const meta = Q.metaOf(row);
  const convId = conversationId || message.conversationId || meta.conversationId || null;
  const lastReply = { body: text.slice(0, 280), at: (message.sentAt ? new Date(message.sentAt) : now).toISOString(), messageId: message.id };

  // 1) Fish on the boat: record the reply, cancel the nudge, move the thread.
  const baseMeta = { ...meta, seen: [...new Set([...(meta.seen || []), message.id])].slice(-40), lastInboundAt: now.toISOString(), lastReply, conversationId: convId || meta.conversationId };
  await moveThreadToInbox(workspaceId, convId);

  // 2) STOP / soft no: terminal, no model call.
  const softNo = !hardStop && guard.isSoftNo(text);
  if (hardStop || softNo) {
    await prisma.campaignRecipient.update({
      where: { id: row.id },
      data: { status: 'opted_out', lane: 'red', repliedAt: row.repliedAt || now, nextSendAt: null, error: hardStop ? 'Replied STOP' : 'Said they are not interested', meta: { ...baseMeta, queue: [], lastReplyKind: 'opt_out' } },
    });
    await guard.optOut({ workspaceId, clientId, text, hard: hardStop, now });
    if (hardStop) await guard.sendOptOutConfirmation({ workspaceId, clientId, campaignId: campaign.id });
    await dismissSuggestions(workspaceId, row.id);
    emit(workspaceId, { campaignId: campaign.id, kind: 'reply', recipientId: row.id, lane: 'opted_out' });
    return { handled: true, kind: 'opt_out' };
  }

  // 3) Not texted yet: hold their announcement (they're live with you).
  if (!meta.initialSentAt) {
    const q = Q.queueOf(row).filter((i) => !['initial_send', 'auto_step'].includes(i.kind));
    await prisma.campaignRecipient.update({ where: { id: row.id }, data: { ...Q.withQueue({ ...baseMeta, pausedForReply: true }, q), error: 'Held: they texted you first' } });
    emit(workspaceId, { campaignId: campaign.id, kind: 'reply', recipientId: row.id, held: true });
    return { handled: true, kind: 'held' };
  }

  // 4) Classify with the thread + their current lane.
  const tail = await threadTail(convId);
  const currentLane = ['green', 'yellow', 'red'].includes(row.lane) ? row.lane : null;
  const verdict = await classifyReply({ workspaceId, text, campaign, threadTail: tail, currentLane });
  const firstReply = !row.repliedAt;

  // OFF-TOPIC: the machine goes silent. No lane change, every pending
  // automated follow-up cancelled (event reminders included only if they
  // weren't in a lane), nothing drafted. The thread is the agent's.
  if (verdict.kind === 'off_topic') {
    const q = Q.queueOf(row).filter((i) => i.kind === 'reminder_step' && currentLane === 'green');
    await prisma.campaignRecipient.update({
      where: { id: row.id },
      data: { ...Q.withQueue({ ...baseMeta, lastReplyKind: 'off_topic', lastReplyVia: verdict.via }, q), repliedAt: row.repliedAt || now, status: row.status === 'taken_over' ? 'taken_over' : 'replied' },
    });
    emit(workspaceId, { campaignId: campaign.id, kind: 'reply', recipientId: row.id, lane: row.lane, replyKind: 'off_topic' });
    return { handled: true, kind: 'off_topic' };
  }

  // Stopped campaign: record the lane, schedule nothing.
  if (recordOnly) {
    await prisma.campaignRecipient.update({ where: { id: row.id }, data: { lane: verdict.lane, repliedAt: row.repliedAt || now, status: 'replied', ...Q.withQueue({ ...baseMeta, lastReplyKind: verdict.kind, laneSetAt: now.toISOString() }, []) } });
    emit(workspaceId, { campaignId: campaign.id, kind: 'reply', recipientId: row.id, lane: verdict.lane });
    return { handled: true, kind: verdict.kind, lane: verdict.lane };
  }

  const { timezone } = await store.readSettings(workspaceId);
  const merged = { ...row, meta: baseMeta };
  const data = laneData({ row: merged, lane: verdict.lane, now, tz: timezone, kind: verdict.kind });
  data.meta = { ...data.meta, lastReplyKind: verdict.kind, lastReplyVia: verdict.via };
  await prisma.campaignRecipient.update({
    where: { id: row.id },
    data: { ...data, repliedAt: row.repliedAt || now, status: row.status === 'taken_over' ? 'taken_over' : 'replied', error: null },
  });

  // QUESTION: no canned follow-up; the reply agent drafts an answer for the
  // agent's approval when "When they respond" is on (draft-first, always).
  const aiReply = (campaign.lanes && campaign.lanes.aiReply) || {};
  if (verdict.kind === 'question' && ['draft', 'suggest'].includes(aiReply.mode) && row.status !== 'taken_over') {
    const suggestions = require('./suggestions');
    suggestions.draftReplySuggestion({ workspaceId, row: { ...row, meta: data.meta }, campaign, question: text, threadTail: tail, conversationId: convId, messageId: message.id, tz: timezone })
      .catch((e) => console.error('[campaigns/replies] reply draft failed:', e.message));
  } else if (firstReply) {
    try {
      const { notify } = require('../../lib/notify');
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firstName: true, lastName: true, displayName: true } });
      const name = client ? (client.displayName || [client.firstName, client.lastName].filter(Boolean).join(' ')) : 'A client';
      notify({ workspaceId, type: 'message', title: `${name} replied to ${campaign.name}`, body: text.slice(0, 140), data: { campaignId: campaign.id, clientId, conversationId: convId, screen: 'thread' } });
    } catch { /* best effort */ }
  }
  require('./engine').refreshSoon(campaign.id);
  emit(workspaceId, { campaignId: campaign.id, kind: 'reply', recipientId: row.id, lane: verdict.lane, replyKind: verdict.kind });
  return { handled: true, kind: verdict.kind, lane: verdict.lane };
}

// The agent texted a recipient themselves → that conversation is theirs, for good.
async function onManualOutbound({ workspaceId, clientId, conversationId, message }) {
  if (!workspaceId || !clientId || !message || message.campaignId) return { handled: false };
  const rows = await prisma.campaignRecipient.findMany({
    where: { workspaceId, clientId, status: { in: ['pending', 'scheduled', 'sent', 'replied', 'rate_deferred'] } },
    include: { campaign: true },
  });
  let n = 0;
  for (const r of rows) {
    if (!listening(r).ok) continue;
    const meta = Q.metaOf(r);
    // Only enrollments that already reached them (or are live) — an agent
    // texting someone whose announcement is still queued also stands it down.
    if (!(await claimMessage(r.id, message.id))) continue;
    const q = Q.queueOf(r).filter((i) => i.kind === 'reminder_step'); // logistics survive
    await prisma.campaignRecipient.update({
      where: { id: r.id },
      data: { status: 'taken_over', ...Q.withQueue({ ...meta, seen: [...new Set([...(meta.seen || []), message.id])].slice(-40), takenOverAt: new Date().toISOString() }, q), error: null },
    });
    await dismissSuggestions(workspaceId, r.id);
    n += 1;
    emit(workspaceId, { campaignId: r.campaignId, kind: 'taken_over', recipientId: r.id });
  }
  return { handled: n > 0, count: n };
}

async function dismissSuggestions(workspaceId, recipientId) {
  await prisma.aiInsight.updateMany({
    where: { workspaceId, type: 'campaign_reply_suggestion', status: 'new', data: { path: ['recipientId'], equals: recipientId } },
    data: { status: 'dismissed' },
  }).catch(() => {});
}

// ── The 15s poller ─────────────────────────────────────────────────────
// Scans Messages created since the workspace cursor: inbound → reply pipeline;
// the agent's own outbound (no campaignId) → takeover. Cursor never advances
// past a message whose recipient row is mid-send (it's retried next pass).
async function pollReplies({ maxPerWorkspace = 200 } = {}) {
  const workspaces = await prisma.$queryRaw`SELECT DISTINCT "workspaceId" AS id FROM "CampaignRecipient"`.catch(() => []);
  let processed = 0;
  for (const { id: workspaceId } of workspaces) {
    const { settings } = await store.readSettings(workspaceId);
    const now = new Date();
    let cursor = settings.campaignCursor ? new Date(settings.campaignCursor) : new Date(now.getTime() - 15 * 60000);
    if (Number.isNaN(cursor.getTime())) cursor = new Date(now.getTime() - 15 * 60000);
    const msgs = await prisma.message.findMany({
      where: { workspaceId, createdAt: { gt: new Date(cursor.getTime() - 5000) }, kind: { notIn: ['system', 'note', 'call'] } },
      orderBy: { createdAt: 'asc' },
      take: maxPerWorkspace,
      select: { id: true, conversationId: true, clientId: true, isFromMe: true, body: true, status: true, sentAt: true, createdAt: true, campaignId: true, aiGenerated: true, conversation: { select: { clientId: true, isGroup: true } } },
    });
    let high = cursor;
    let blocked = false;
    for (const m of msgs) {
      const clientId = m.clientId || (m.conversation && m.conversation.clientId);
      if (!clientId || (m.conversation && m.conversation.isGroup)) { if (!blocked && m.createdAt > high) high = m.createdAt; continue; }
      const busy = await prisma.campaignRecipient.count({ where: { workspaceId, clientId, status: 'drafting' } });
      if (busy) { blocked = true; continue; }
      try {
        if (!m.isFromMe) {
          await onInboundMessage({ workspaceId, clientId, conversationId: m.conversationId, message: m });
        } else if (!m.campaignId && ['queued', 'sending', 'sent', 'delivered', 'read'].includes(m.status)) {
          await onManualOutbound({ workspaceId, clientId, conversationId: m.conversationId, message: m });
        }
        processed += 1;
      } catch (err) {
        console.error('[campaigns/replies] message failed:', m.id, err.message);
      }
      if (!blocked && m.createdAt > high) high = m.createdAt;
    }
    if (high > cursor) await store.setKey(workspaceId, 'campaignCursor', high.toISOString());
    else if (!settings.campaignCursor) await store.setKey(workspaceId, 'campaignCursor', cursor.toISOString());
  }
  return { processed };
}

module.exports = { onInboundMessage, onManualOutbound, pollReplies, laneData, findActiveRecipient, listening, claimMessage, moveThreadToInbox, dismissSuggestions };

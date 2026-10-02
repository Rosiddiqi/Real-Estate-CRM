// Row builders (part B): conversations/messages/attachments/reactions, calls,
// notes, tasks, appointments, campaigns, waitlists, notifications, Serena, insights.
const { uid, phone, img, EXT, INT, DAY } = require('./util');
const { deepT, clean } = require('./build_a');
const { dayKey, zonedTime, addDays } = require('../../src/lib/dates');

const AGENT_HANDLE = '3055550100';
const name = (c) => (c ? (c.displayName || `${c.firstName} ${c.lastName}`.trim()) : null);
const groupName = (a, b) => (a.lastName === b.lastName ? `${a.firstName} & ${b.firstName} ${a.lastName}` : `${name(a)} & ${name(b)}`);

// Resolve a day spec (number | 'close:<deal>[±n]') + 'HH:MM' to an instant.
function when(S, day, time) {
  const { ctx } = S;
  const [h, m] = String(time || '10:00').split(':').map(Number);
  if (typeof day === 'string' && day.startsWith('close:')) {
    const mm = day.slice(6).match(/^([a-z0-9_]+)([+-]\d+)?$/i);
    const base = S.closedPlan[mm[1]].at;
    const ds = addDays(dayKey(base, ctx.TZ), mm[2] ? Number(mm[2]) : 0);
    return zonedTime(ds, h, m, ctx.TZ);
  }
  return ctx.at(day, h, m);
}
// Same, but never in the future (and not before local midnight today).
function pastWhen(S, day, time, guardMin = 3) {
  const t = when(S, day, time);
  const lim = S.ctx.now.getTime() - guardMin * 60000;
  if (t.getTime() <= lim) return t;
  return new Date(Math.max(lim, S.ctx.startOfToday.getTime() + 60000));
}

function attachmentUrls(S, specs) {
  const out = [];
  for (const s of specs || []) {
    const [kind, a, b] = s.split(':');
    if (kind === 'listing') out.push(...S.listingRow[a].photoUrls.slice(0, Number(b || 1)));
    else if (kind === 'int') out.push(img(INT[Number(a) % INT.length]));
    else if (kind === 'ext') out.push(img(EXT[Number(a) % EXT.length]));
  }
  return out;
}

// ── Conversations ─────────────────────────────────────────────────────────
function buildThreads(S, threads, injections) {
  const { ctx, rng, WS } = S;
  const conv = []; const msgs = []; const atts = []; const reacts = [];
  S.convId = {}; S.convByClient = {}; S.asks = {}; S.campaignMsgs = []; S.threadMsgs = {};
  for (const raw of threads) {
    const t = deepT(ctx, raw);
    const id = uid(`conv:${t.key}`);
    S.convId[t.key] = id;
    const c = t.client ? S.clientDefs[t.client] : null;
    const channel = t.channel || (c && c.deviceMode === 'sms' ? 'sms' : 'imessage');
    const handle = t.isGroup ? t.handle : phone(t.handle || (c && c.phone));
    const list = [...(t.msgs || []), ...deepT(ctx, injections[t.key] || [])].map((m, i) => {
      const [day, time, who, text, x = {}] = m;
      return { day, time, who, text, x, i, at: when(S, day, time) };
    }).sort((a, b) => a.at - b.at || a.i - b.i);
    // Pull anything scheduled after "now" back into the past, preserving order.
    let next = ctx.now.getTime() - 3 * 60000;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].at.getTime() > next) list[i].at = new Date(next);
      next = list[i].at.getTime() - 20000;
    }
    const participants = t.isGroup ? t.participants.map((k) => ({ handle: phone(S.clientDefs[k].phone), name: name(S.clientDefs[k]), clientId: S.clientId[k] })) : null;
    const rows = list.map((m, idx) => {
      const fromMe = m.who === 'me';
      const senderKey = fromMe ? null : (m.who === 'c' ? t.client : m.who === 'x' ? null : m.who);
      const sender = senderKey ? S.clientDefs[senderKey] : null;
      const urls = attachmentUrls(S, m.x.att);
      const L = m.x.listing ? S.listingRow[m.x.listing] : null;
      const laterInbound = list.slice(idx + 1).find((n) => n.who !== 'me');
      let status = m.x.status || (fromMe ? (channel === 'sms' ? 'delivered' : (laterInbound ? 'read' : 'delivered')) : 'received');
      if (fromMe && !m.x.status && channel === 'imessage' && !laterInbound && (ctx.now - m.at) > 6 * 3600e3) status = 'read';
      const deliveredAt = ['delivered', 'read'].includes(status) ? new Date(m.at.getTime() + rng.int(3, 18) * 1000) : null;
      let readAt = null;
      if (status === 'read') {
        const cap = laterInbound ? laterInbound.at.getTime() - 20000 : ctx.now.getTime() - 60000;
        readAt = new Date(Math.max(deliveredAt.getTime() + 1000, Math.min(m.at.getTime() + rng.int(1, 25) * 60000, cap)));
      }
      const mid = uid(`msg:${t.key}:${idx}`);
      const campaignKey = m.x.campaign || null;
      const row = clean({
        id: mid, workspaceId: WS, conversationId: id, clientId: fromMe ? (c ? S.clientId[t.client] : null) : (senderKey ? S.clientId[senderKey] : null),
        isFromMe: fromMe, body: m.text, kind: L ? 'listing' : (urls.length ? 'attachment' : 'text'), service: channel, status, error: m.x.error,
        sentAt: m.at, deliveredAt, readAt, senderName: fromMe ? null : (sender ? name(sender) : null),
        senderHandle: fromMe ? AGENT_HANDLE : (sender ? phone(sender.phone) : handle),
        campaignId: campaignKey ? uid(`campaign:${campaignKey}`) : null,
        campaignRecipientId: campaignKey && t.client ? uid(`cr:${campaignKey}:${t.client}`) : null,
        aiGenerated: !!m.x.aiGenerated,
        meta: L ? { listingId: L.id, title: L.title, price: L.listPrice || L.priceGuide, heroPhoto: L.heroPhoto, status: L.status } : null,
        createdAt: m.at,
      });
      urls.forEach((u, k) => atts.push({ id: uid(`att:${mid}:${k}`), workspaceId: WS, messageId: mid, url: u, mimeType: 'image/jpeg', fileName: `IMG_${4100 + rng.int(0, 899)}.jpeg`, size: rng.int(1200, 3900) * 1000, width: 1600, height: 1067, thumbnailUrl: u.replace('w=1600', 'w=400'), kind: 'image', createdAt: m.at }));
      for (const r of m.x.react || []) {
        const by = r.by ? S.clientDefs[r.by] : c;
        reacts.push({ id: uid(`rx:${mid}:${r.type}:${r.fromMe}`), workspaceId: WS, messageId: mid, type: r.type, isFromMe: !!r.fromMe, senderHandle: r.fromMe ? AGENT_HANDLE : phone(by && by.phone), createdAt: new Date(Math.min(m.at.getTime() + rng.int(1, 6) * 60000, ctx.now.getTime() - 60000)) });
      }
      if (m.x.ask) S.asks[m.x.ask] = { text: m.text, at: m.at, messageId: mid, conversationId: id, clientKey: senderKey };
      if (campaignKey) S.campaignMsgs.push({ campaignKey, clientKey: t.client, at: m.at, messageId: mid });
      return { ...row, _senderKey: senderKey, _campaign: campaignKey };
    });
    const last = rows[rows.length - 1];
    const preview = (r) => (r.kind === 'listing' ? `🏠 ${r.meta.title}` : r.kind === 'attachment' ? `📷 ${r.body || 'Photo'}` : r.body);
    const trailingIn = (() => { let n = 0; for (let i = rows.length - 1; i >= 0 && !rows[i].isFromMe; i -= 1) n += 1; return n; })();
    conv.push(clean({
      id, workspaceId: WS, clientId: c ? S.clientId[t.client] : null, handle, channel,
      displayName: t.displayName || (t.isGroup ? groupName(S.clientDefs[t.participants[0]], S.clientDefs[t.participants[1]]) : name(c)),
      isGroup: !!t.isGroup, groupName: t.groupName, participants,
      lastMessageAt: last.sentAt, lastMessagePreview: preview(last).slice(0, 160), lastMessageFromMe: last.isFromMe, lastMessageStatus: last.status,
      unreadCount: Math.min(t.unread || 0, trailingIn), pinned: !!t.pinned, lane: t.lane || 'active',
      deliveryMode: channel, deliveryModeReason: c ? c.deviceModeReason : null,
      aiSummary: t.aiSummary, aiSummaryAt: t.aiSummary ? new Date(Math.max(last.sentAt.getTime() - 5 * 60000, ctx.now.getTime() - 3 * 3600e3)) : null,
      createdAt: rows[0].sentAt,
    }));
    if (c && !S.convByClient[t.client]) S.convByClient[t.client] = id;
    if (t.isGroup) for (const k of t.participants) if (!S.convByClient[k]) S.convByClient[k] = id;
    S.threadMsgs[t.key] = { client: t.client, isGroup: !!t.isGroup, participants: t.participants, rows };
    msgs.push(...rows.map(({ _senderKey, _campaign, ...r }) => r));
  }
  return { conv, msgs, atts, reacts };
}

// ── Calls + notes ─────────────────────────────────────────────────────────
function buildCalls(S, calls) {
  const { ctx, WS } = S;
  return calls.map((raw, i) => {
    const d = deepT(ctx, raw);
    const c = S.clientDefs[d.client];
    const startedAt = d.day === 0 ? pastWhen(S, 0, d.time, 2 + Math.ceil(d.dur / 60)) : when(S, d.day, d.time);
    const answered = d.status === 'completed';
    const lines = d.transcript || [];
    const transcript = lines.length ? lines.map(([sp, text], k) => ({ speaker: sp === 'a' ? 'agent' : 'client', text, t: Math.round((k * d.dur) / lines.length) })) : null;
    const inbound = d.dir === 'inbound';
    return clean({
      id: uid(`call:${i}`), workspaceId: WS, clientId: S.clientId[d.client], conversationId: S.convByClient[d.client] || null,
      direction: d.dir, status: d.status, fromNumber: inbound ? phone(c.phone) : AGENT_HANDLE, toNumber: inbound ? AGENT_HANDLE : phone(c.phone),
      startedAt, answeredAt: answered ? new Date(startedAt.getTime() + 7000) : null, endedAt: new Date(startedAt.getTime() + (d.dur + (answered ? 7 : 25)) * 1000),
      durationSec: d.dur, transcript, summary: d.summary, summaryBullets: d.bullets, aiSuggestions: d.suggestions, sentiment: d.sentiment,
      voicemailTranscript: d.voicemail ? d.voicemail.text : null, voicemailHeard: d.voicemail ? !!d.voicemail.heard : false,
      voicemailUrl: d.voicemail ? `/uploads/demo/voicemail-${d.client}.m4a` : null,
      meta: answered ? { provider: 'demo', recorded: !!transcript } : { provider: 'demo' }, createdAt: startedAt,
    });
  });
}

function buildNotes(S, notes) {
  const { ctx, WS } = S;
  return notes.map((raw, i) => {
    const d = deepT(ctx, raw);
    const at = pastWhen(S, d.day ?? -3, `${9 + (i % 9)}:${String((i * 7) % 60).padStart(2, '0')}`);
    return clean({
      id: uid(`note:${i}`), workspaceId: WS, clientId: S.clientId[d.client], dealId: d.deal ? S.dealId[d.deal] : null, listingId: d.listing ? S.listingId[d.listing] : null,
      body: d.body, pinned: !!d.pinned, source: d.source || 'agent', createdAt: at,
    });
  });
}

// ── Tasks + appointments ──────────────────────────────────────────────────
function buildTasks(S, tasks) {
  const { ctx, WS, USER } = S;
  return tasks.map((raw, i) => {
    const d = deepT(ctx, raw);
    const status = d.status || 'pending';
    const ask = d.source === 'ai_capture' && status === 'suggested' ? Object.values(S.asks).find((a) => d.notes && d.notes.includes(a.text)) : null;
    const created = ask ? new Date(ask.at.getTime() + 90000) : pastWhen(S, Math.min(d.dueDate ?? 0, 0) - 2, '18:00');
    return clean({
      id: uid(`task:${i}`), workspaceId: WS, userId: USER, clientId: d.client ? S.clientId[d.client] : null, dealId: d.deal ? S.dealId[d.deal] : null,
      listingId: d.listing ? S.listingId[d.listing] : null, title: d.title, notes: d.notes, status, source: d.source || 'user', kind: d.kind,
      dueAt: d.dueAt ? when(S, d.dueAt[0], d.dueAt[1]) : null, dueDate: d.dueDate != null ? ctx.day(d.dueDate) : null, durationMin: d.durationMin,
      priority: d.priority || 0, rolledFrom: d.rolledFrom != null ? ctx.day(d.rolledFrom) : null,
      completedAt: d.completedAt ? pastWhen(S, d.completedAt[0], d.completedAt[1]) : null, dismissedAt: d.dismissedAt ? pastWhen(S, d.dismissedAt[0], d.dismissedAt[1]) : null,
      meta: ask ? { capturedFrom: { conversationId: ask.conversationId, messageId: ask.messageId } } : null, createdAt: created,
    });
  });
}

// Flexible appointments (e.g. this month's closings, whose dates move with the
// run date) are dropped unless clearly in the past, then nudged off overlaps.
function placeFlex(S, list) {
  const { ctx } = S;
  const busy = (a, b) => a.start < b.end && b.start < a.end;
  const placed = list.filter((x) => !x.d.flex);
  for (const x of list.filter((y) => y.d.flex)) {
    if (x.end > new Date(ctx.now.getTime() - 3600e3)) { x.skip = true; continue; }
    const day = dayKey(x.start, ctx.TZ);
    const dur = x.end - x.start;
    const slots = [x.start, ...[9, 10, 11, 12, 13, 14, 15, 16, 17, 8, 18].map((h) => zonedTime(day, h, 0, ctx.TZ))];
    const free = slots.find((st) => st.getTime() + dur <= ctx.now.getTime() - 3600e3 && !placed.some((p) => p.d.status !== 'cancelled' && busy({ start: st, end: new Date(st.getTime() + dur) }, p)));
    if (!free) { x.skip = true; continue; }
    x.start = free; x.end = new Date(free.getTime() + dur);
    placed.push(x);
  }
  return list.filter((x) => !x.skip);
}

function buildAppointments(S, appts) {
  const { ctx, WS, USER } = S;
  const timed = appts.map((raw) => {
    const d = deepT(ctx, raw);
    const start = when(S, d.day, d.time);
    return { d, start, end: new Date(start.getTime() + d.dur * 60000) };
  });
  return placeFlex(S, timed).map(({ d, start: startAt, end: endAt }, i) => {
    const L = d.listing ? S.listingRow[d.listing] : null;
    const status = d.status || (endAt < ctx.now ? 'completed' : (startAt - ctx.now < 2 * DAY ? 'confirmed' : 'scheduled'));
    const created = new Date(Math.min(startAt.getTime() - (3 + (i % 5)) * DAY, ctx.now.getTime() - (2 + (i % 7)) * 3600e3));
    return clean({
      id: uid(`appt:${i}`), workspaceId: WS, userId: USER, clientId: d.client ? S.clientId[d.client] : null, dealId: d.deal ? S.dealId[d.deal] : null, listingId: L ? L.id : null,
      type: d.type, title: d.title, notes: d.notes, location: d.location || (L ? L.fullAddress : null), startAt, endAt, allDay: false, status,
      source: d.source || (d.briefing ? 'serena' : 'user'), attendees: d.attendees, reminders: [{ minutesBefore: d.type === 'closing' ? 1440 : 60 }],
      reminderSentAt: startAt < ctx.now ? new Date(startAt.getTime() - 3600e3) : null,
      briefing: d.briefing, briefingAt: d.briefing ? new Date(Math.min(startAt.getTime() - 3600e3, ctx.now.getTime() - 10 * 60000)) : null,
      outcome: d.outcome, followUpLoggedAt: d.outcome && endAt < ctx.startOfToday ? new Date(endAt.getTime() + 40 * 60000) : null,
      imageUrl: L ? L.heroPhoto : null, createdAt: created,
    });
  });
}

// ── Campaigns, waitlists, notifications, Serena, insights ──────────────────
function buildCampaigns(S, campaigns) {
  const { ctx, WS } = S;
  const rows = []; const recips = [];
  for (const raw of campaigns) {
    const d = deepT(ctx, raw);
    const id = uid(`campaign:${d.key}`);
    if (d.event && d.event.listingKey) { d.event.listingId = S.listingId[d.event.listingKey]; delete d.event.listingKey; }
    rows.push(clean({ id, workspaceId: WS, name: d.name, kind: d.kind, trigger: d.trigger, status: d.status, audience: d.audience, brief: d.brief, steps: d.steps, lanes: d.lanes, event: d.event, pacing: d.pacing, stats: d.stats, launchedAt: d.launchedAt, completedAt: d.completedAt, createdAt: d.createdAt }));
    d.recipients.forEach(([key, status, lane, replied, nextSendAt], i) => {
      const sent = S.campaignMsgs.find((m) => m.campaignKey === d.key && m.clientKey === key);
      recips.push(clean({
        id: uid(`cr:${d.key}:${key}`), workspaceId: WS, campaignId: id, clientId: S.clientId[key], status, lane: lane || 'none',
        stepIndex: sent ? 1 : 0, nextSendAt: nextSendAt || (status === 'scheduled' ? ctx.at(1, 10, 2 * i) : null), lastSentAt: sent ? sent.at : null,
        repliedAt: replied ? when(S, replied[0], replied[1]) : null, meta: { conversationId: S.convByClient[key] || null, messageId: sent ? sent.messageId : null },
        createdAt: d.launchedAt || d.createdAt,
      }));
    });
  }
  return { rows, recips };
}

function buildWaitlists(S, lists) {
  const { WS } = S;
  const rows = []; const entries = [];
  for (const d of lists) {
    const id = uid(`wl:${d.key}`);
    rows.push(clean({ id, workspaceId: WS, name: d.name, buildingName: d.buildingName, neighborhood: d.neighborhood, description: d.description, position: d.position, createdAt: S.ctx.daysAgo(120 - d.position * 30) }));
    d.entries.forEach(([key, status, pos, notes, done], i) => entries.push(clean({
      id: uid(`wle:${d.key}:${key}`), waitlistId: id, clientId: S.clientId[key], position: pos || i + 1, status, notes,
      doneAt: status === 'got_one' ? (typeof done === 'string' ? when(S, done, '16:00') : S.ctx.at(done || -30, 12)) : null, createdAt: S.ctx.daysAgo(90 - i * 9),
    })));
  }
  return { rows, entries };
}

function mapKeys(S, data) {
  if (!data) return null;
  const out = { ...data };
  if (out.conversationKey) { out.conversationId = S.convId[out.conversationKey]; delete out.conversationKey; }
  if (out.clientKey) { out.clientId = S.clientId[out.clientKey]; delete out.clientKey; }
  if (out.listingKey) { out.listingId = S.listingId[out.listingKey]; delete out.listingKey; }
  if (out.dealKey) { out.dealId = S.dealId[out.dealKey]; delete out.dealKey; }
  return out;
}

function buildNotifications(S, list) {
  const { ctx, WS, USER } = S;
  return list.map((raw, i) => {
    const d = deepT(ctx, raw);
    const at = pastWhen(S, d.at[0], d.at[1]);
    return clean({ id: uid(`notif:${i}`), workspaceId: WS, userId: USER, type: d.type, title: d.title, body: d.body, data: mapKeys(S, d.data), readAt: d.read ? new Date(Math.min(at.getTime() + 12 * 60000, ctx.now.getTime() - 60000)) : null, createdAt: at });
  });
}

function buildSerena(S, serena) {
  const { ctx, WS, USER } = S;
  const d = deepT(ctx, serena);
  const threadId = uid('serena:thread');
  let prev = 0;
  const messages = d.messages.map(([role, at, content, actions], i) => {
    let t = pastWhen(S, at[0], at[1], 8 - i).getTime();
    if (t <= prev) t = prev + 20000;
    prev = t;
    return clean({ id: uid(`serena:msg:${i}`), workspaceId: WS, threadId, role, content, actions: actions ? actions.map((a) => mapKeys(S, a)) : null, createdAt: new Date(t) });
  });
  const thread = { id: threadId, workspaceId: WS, userId: USER, title: d.title, lastMessageAt: messages[messages.length - 1].createdAt, createdAt: messages[0].createdAt };
  const memories = d.memories.map(([kind, text, source], i) => ({ id: uid(`mem:${i}`), workspaceId: WS, userId: USER, kind, text, source, createdAt: ctx.daysAgo(60 - i * 7) }));
  return { thread, messages, memories };
}

function buildInsights(S, list) {
  const { ctx, WS } = S;
  return list.map((raw, i) => {
    const d = deepT(ctx, raw);
    const at = pastWhen(S, d.at[0], d.at[1]);
    return clean({
      id: uid(`insight:${i}`), workspaceId: WS, clientId: d.client ? S.clientId[d.client] : null, dealId: d.deal ? S.dealId[d.deal] : null,
      conversationId: d.conversation ? S.convId[d.conversation] : null, type: d.type, title: d.title, body: d.body, data: d.data, status: 'new',
      expiresAt: d.type === 'reply_suggestion' ? new Date(ctx.now.getTime() + 2 * DAY) : null, createdAt: at,
    });
  });
}

module.exports = { buildThreads, buildCalls, buildNotes, buildTasks, buildAppointments, buildCampaigns, buildWaitlists, buildNotifications, buildSerena, buildInsights, when, pastWhen, name, AGENT_HANDLE };

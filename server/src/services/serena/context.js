// The volatile context block Serena sees every turn (never cached): the
// wall clock in the agent's zone, today's schedule, unread threads, hot deals,
// top to-dos, what she remembers about the agent, and what's on screen.
const prisma = require('../../lib/prisma');
const { dayKey, dayBounds } = require('../../lib/dates');
const U = require('./util');

async function snapshot({ workspaceId, userId, tz }) {
  const now = new Date();
  const day = dayKey(now, tz);
  const { start, end } = dayBounds(day, tz);
  const [appts, unread, unreadCount, deals, tasks, memories, missed] = await Promise.all([
    prisma.appointment.findMany({ where: { workspaceId, startAt: { gte: start, lt: end }, status: { not: 'cancelled' } }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { startAt: 'asc' }, take: 12 }),
    prisma.conversation.findMany({ where: { workspaceId, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { lastMessageAt: 'desc' }, take: 5 }),
    prisma.conversation.count({ where: { workspaceId, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' } }),
    prisma.deal.findMany({ where: { workspaceId, archivedAt: null, stage: { in: ['offer_submitted', 'offer_received', 'under_contract'] } }, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ closingDate: 'asc' }], take: 6 }),
    prisma.task.findMany({ where: { workspaceId, status: 'pending', OR: [{ dueDate: { lte: day } }, { dueAt: { lt: end } }] }, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }], take: 6 }),
    userId ? prisma.serenaMemory.findMany({ where: { workspaceId, userId }, orderBy: { updatedAt: 'desc' }, take: 30 }) : [],
    prisma.phoneCall.count({ where: { workspaceId, direction: 'inbound', status: { in: ['missed', 'no_answer', 'voicemail'] }, startedAt: { gte: start } } }),
  ]);
  return { now, day, appts, unread, unreadCount, deals, tasks, memories, missed };
}

async function selectedFocus(workspaceId, context = {}) {
  const out = [];
  if (context.clientId) {
    const c = await U.getClientLite(workspaceId, context.clientId);
    if (c) out.push(`The agent is looking at ${U.nameOf(c)}'s client card (client id ${c.id}). Treat "this client", "him", "her", "them" with no other referent as ${U.nameOf(c)}.`);
  }
  if (context.dealId) {
    const d = await prisma.deal.findFirst({ where: { id: context.dealId, workspaceId }, select: { id: true, title: true, stage: true, clientId: true } });
    if (d) out.push(`Open deal on screen: ${d.title || 'deal'} (deal id ${d.id}, stage ${d.stage}).`);
  }
  if (context.listingId) {
    const l = await prisma.listing.findFirst({ where: { id: context.listingId, workspaceId }, select: { id: true, street: true, neighborhood: true, listPrice: true } });
    if (l) out.push(`Open listing on screen: ${U.addressOf(l)}${l.neighborhood ? `, ${l.neighborhood}` : ''} (listing id ${l.id}).`);
  }
  if (context.screen) out.push(`Current screen: ${context.screen}.`);
  return out;
}

// Text block for the system prompt (volatile — placed after the cached prompt).
async function contextBlock({ workspaceId, userId, tz, context }) {
  const s = await snapshot({ workspaceId, userId, tz });
  const wall = s.now.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = [];
  lines.push('CURRENT DATE AND TIME (use this for anything time-relative):');
  lines.push(`  - Wall clock (${tz}): ${wall}`);
  lines.push(`  - Today is ${s.day}. ISO UTC: ${s.now.toISOString()}`);
  lines.push('Times inside tool results ending in _local are already in the agent\'s zone — quote them as-is. When you pass dates to tools use "today"/"tomorrow"/a weekday/YYYY-MM-DD and times as HH:MM 24h local; the server does the time-zone math.');
  lines.push('');
  lines.push('TODAY AT A GLANCE (a snapshot — call tools for detail before acting):');
  if (s.appts.length) {
    lines.push(`Appointments (${s.appts.length}):`);
    for (const a of s.appts) lines.push(`  - ${U.fmtTime(a.startAt, tz)} ${a.title}${a.client ? ` [client ${U.nameOf(a.client)} · id ${a.clientId}]` : ''} [appointment id ${a.id}]`);
  } else lines.push('Appointments: none today.');
  lines.push(`Unread text threads: ${s.unreadCount}${s.unread.length ? '' : '.'}`);
  for (const u of s.unread) lines.push(`  - ${u.client ? U.nameOf(u.client) : (u.displayName || U.formatPhone(u.handle))}: "${U.clip(u.lastMessagePreview, 90)}" (${U.relAgo(u.lastMessageAt)}${u.clientId ? `, client id ${u.clientId}` : ''})`);
  if (s.missed) lines.push(`Missed calls today: ${s.missed}.`);
  if (s.deals.length) {
    lines.push('Hot deals:');
    for (const d of s.deals) lines.push(`  - ${d.title || d.propertyAddress || 'Deal'} — ${d.client ? U.nameOf(d.client) : ''}, ${d.stage.replace(/_/g, ' ')}${d.closingDate ? `, closing ${U.fmtDate(d.closingDate, tz)}` : ''} [deal id ${d.id}]`);
  }
  if (s.tasks.length) {
    lines.push('Top to-dos due today/overdue:');
    for (const t of s.tasks) lines.push(`  - ${t.title}${t.client ? ` (${U.nameOf(t.client)})` : ''} [task id ${t.id}]`);
  }
  const focus = await selectedFocus(workspaceId, context || {});
  if (focus.length) {
    lines.push('');
    lines.push('ON SCREEN:');
    for (const f of focus) lines.push(`  ${f}`);
  }
  if (s.memories.length) {
    lines.push('');
    lines.push('WHAT YOU REMEMBER ABOUT THE AGENT (their standing preferences — honor them):');
    for (const m of s.memories) lines.push(`  - ${m.text}`);
  }
  return lines.join('\n');
}

module.exports = { snapshot, contextBlock, selectedFocus };

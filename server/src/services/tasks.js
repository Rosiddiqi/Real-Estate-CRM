// To-dos / client tasks — the ONE writer for the Task table (dashboard owns it).
//
// Other builders import these instead of writing Task rows directly:
//   const tasks = require('../services/tasks');
//   await tasks.createTask({ workspaceId, userId, title, clientId, dueAt, source: 'call' });
//   await tasks.completeTask({ workspaceId, id });
//
// Status: pending (YOUR LIST) | suggested (SERENA SUGGESTS — needs Add) |
//         done | dismissed | cancelled.
// Priority (Int): -1 low · 0 normal · 1 high · 2 urgent.
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const { logActivity } = require('../lib/activity');
const { clientName } = require('../lib/clients');
const { dayKey, addDays, dayBounds } = require('../lib/dates');
const config = require('../config');

const OPEN = ['pending'];
const PRIORITY = { low: -1, normal: 0, high: 1, urgent: 2 };
const STAGE_ODDS = {
  new_lead: 0.2, seller_lead: 0.2, consultation: 0.35, listing_appt: 0.35, touring: 0.5, active: 0.5,
  offer_submitted: 0.7, offer_received: 0.7, under_contract: 0.9, unit_selection: 0.5, pricing_received: 0.6,
  priority_list: 0.7, reserved: 0.85,
};

const STOP = new Set(['follow', 'with', 'the', 'and', 'for', 'about', 'his', 'her', 'their', 'them', 'him', 'check', 'text',
  'call', 'send', 'reply', 'email', 'get', 'back', 'today', 'tomorrow', 'update', 'both', 'new', 'from', 'this', 'that', 're']);

function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
}
const tokenMatches = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));

function normPriority(p) {
  if (p == null || p === '') return undefined;
  if (typeof p === 'number') return Math.max(-1, Math.min(2, Math.round(p)));
  return PRIORITY[String(p).toLowerCase()] ?? 0;
}

// Auto-link a contact when exactly one client's first/last name matches a word
// of the title (prefix-tolerant ≥4 chars: "greg" ↔ "Gregory"). Ties never guess.
async function autoLinkClient(workspaceId, title) {
  const words = tokens(title);
  if (!words.length) return null;
  const candidates = await prisma.client.findMany({
    where: {
      workspaceId, archivedAt: null, contactKind: 'client',
      OR: words.flatMap((w) => [
        { firstName: { startsWith: w.slice(0, 4), mode: 'insensitive' } },
        { lastName: { startsWith: w.slice(0, 4), mode: 'insensitive' } },
      ]),
    },
    select: { id: true, firstName: true, lastName: true },
    take: 60,
  });
  let best = null; let bestScore = 0; let tie = false;
  for (const c of candidates) {
    const fn = String(c.firstName || '').toLowerCase();
    const ln = String(c.lastName || '').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (fn.length >= 3 && tokenMatches(w, fn)) score += 2;
      if (ln.length >= 3 && tokenMatches(w, ln)) score += 1;
    }
    if (score > bestScore) { best = c; bestScore = score; tie = false; } else if (score && score === bestScore) tie = true;
  }
  return bestScore > 0 && !tie ? best.id : null;
}

function serializeTask(t, tz = config.timezone) {
  if (!t) return t;
  const today = dayKey(new Date(), tz);
  const dueKey = t.dueDate || (t.dueAt ? dayKey(new Date(t.dueAt), tz) : null);
  const rolledOver = t.status === 'pending' && !!dueKey && dueKey < today && dueKey >= addDays(today, -14);
  return {
    ...t,
    dueKey,
    rolledOver,
    overdue: t.status === 'pending' && !!dueKey && dueKey < today,
    client: t.client ? {
      id: t.client.id, name: clientName(t.client), firstName: t.client.firstName, lastName: t.client.lastName,
      phone: t.client.phone, avatarUrl: t.client.avatarUrl, rating: t.client.rating, isWhale: t.client.isWhale,
    } : null,
  };
}

const CLIENT_SELECT = { select: { id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, avatarUrl: true, rating: true, isWhale: true } };

// EV inputs for client-side ranking (value = expected GCI, odds from stage + stars).
async function attachEv(workspaceId, tasks) {
  const ids = [...new Set(tasks.map((t) => t.clientId).filter(Boolean))];
  if (!ids.length) return tasks.map((t) => ({ ...t, ev: null }));
  const deals = await prisma.deal.findMany({
    where: { workspaceId, clientId: { in: ids }, archivedAt: null, stage: { notIn: ['closed', 'lost'] } },
    select: { clientId: true, stage: true, price: true, listPrice: true, contractPrice: true, estimatedGci: true, sideRate: true, buyRate: true, listRate: true, side: true, splitShare: true },
  });
  const best = new Map();
  for (const d of deals) {
    const price = d.contractPrice || d.price || d.listPrice || 0;
    const rate = d.sideRate || (d.side === 'listing' ? d.listRate || 0.03 : d.side === 'dual' ? (d.listRate || 0.03) + (d.buyRate || 0.025) : d.buyRate || 0.025);
    const gci = d.estimatedGci || Math.round(price * rate * (d.splitShare || 1));
    const prev = best.get(d.clientId);
    if (!prev || gci > prev.gci) best.set(d.clientId, { gci, stage: d.stage, price });
  }
  const { propertyPriority } = require('./battlePlan/priority');
  return tasks.map((t) => {
    if (!t.clientId) return { ...t, ev: null };
    const d = best.get(t.clientId);
    const c = t.client || {};
    return {
      ...t,
      ev: {
        rating: c.rating || 0,
        whale: !!(c.isWhale || (c.rating || 0) >= 5),
        dealValue: d ? d.gci : 0,
        dealStage: d ? d.stage : null,
        dealOdds: d ? (STAGE_ODDS[d.stage] ?? 0.5) : null,
        propertyPriority: d && d.price ? propertyPriority(d.price) : null,
      },
    };
  });
}

async function tzFor(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  return (ws && ws.timezone) || config.timezone;
}

async function createTask({
  workspaceId, userId = null, title, clientId, dealId = null, listingId = null, kind = null, dueAt = null, dueDate = null,
  durationMin = null, priority, status = 'pending', source = 'user', notes = null, meta = null, autoLink = true, actor = 'agent',
}) {
  const clean = String(title || '').trim().slice(0, 280);
  if (!clean) throw Object.assign(new Error('Title is required'), { status: 400 });
  let cid = clientId || null;
  if (cid) {
    const ok = await prisma.client.findFirst({ where: { id: cid, workspaceId }, select: { id: true } });
    if (!ok) cid = null;
  } else if (autoLink && clientId === undefined) {
    cid = await autoLinkClient(workspaceId, clean);
  }
  const row = await prisma.task.create({
    data: {
      workspaceId, userId, clientId: cid, dealId, listingId, title: clean, kind, notes,
      dueAt: dueAt ? new Date(dueAt) : null, dueDate: dueDate || null, durationMin,
      priority: normPriority(priority) ?? 0, status, source, meta,
    },
    include: { client: CLIENT_SELECT },
  });
  const tz = await tzFor(workspaceId);
  const task = serializeTask(row, tz);
  hub.broadcast(workspaceId, 'task_updated', { task, action: 'created' });
  if (cid && status === 'pending') {
    logActivity({ workspaceId, clientId: cid, type: 'task_created', title: `To-do: ${clean}`, meta: { taskId: row.id, source }, actor });
  }
  return task;
}

async function updateTask({ workspaceId, id, patch = {}, actor = 'agent' }) {
  const current = await prisma.task.findFirst({ where: { id, workspaceId } });
  if (!current) throw Object.assign(new Error('Task not found'), { status: 404 });
  const data = {};
  for (const k of ['title', 'notes', 'kind', 'dueDate', 'durationMin', 'meta', 'dealId', 'listingId']) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.clientId !== undefined) data.clientId = patch.clientId || null;
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.priority !== undefined) data.priority = normPriority(patch.priority) ?? 0;
  if (patch.status !== undefined && patch.status !== current.status) {
    data.status = patch.status;
    if (patch.status === 'done') data.completedAt = new Date();
    if (patch.status === 'pending') { data.completedAt = null; data.dismissedAt = null; }
    if (patch.status === 'dismissed' || patch.status === 'cancelled') data.dismissedAt = new Date();
  }
  const row = await prisma.task.update({ where: { id }, data, include: { client: CLIENT_SELECT } });
  const tz = await tzFor(workspaceId);
  const task = serializeTask(row, tz);
  hub.broadcast(workspaceId, 'task_updated', { task, action: 'updated' });
  if (data.status === 'done' && row.clientId) {
    logActivity({ workspaceId, clientId: row.clientId, type: 'task_done', title: `Done: ${row.title}`, meta: { taskId: row.id }, actor });
  }
  if (current.status === 'suggested' && data.status === 'pending' && row.clientId) {
    logActivity({ workspaceId, clientId: row.clientId, type: 'task_created', title: `To-do: ${row.title}`, meta: { taskId: row.id, source: row.source }, actor });
  }
  return task;
}

const completeTask = ({ workspaceId, id, actor }) => updateTask({ workspaceId, id, patch: { status: 'done' }, actor });

async function deleteTask({ workspaceId, id }) {
  const current = await prisma.task.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!current) throw Object.assign(new Error('Task not found'), { status: 404 });
  await prisma.task.delete({ where: { id } });
  hub.broadcast(workspaceId, 'task_updated', { id, action: 'deleted' });
  return { ok: true };
}

async function listTasks({ workspaceId, clientId, open, status, source, completedSince, dueFrom, dueTo, limit = 200, withEv = true }) {
  const where = { workspaceId };
  if (clientId) where.clientId = clientId;
  if (open) where.status = { in: OPEN };
  else if (status) where.status = { in: String(status).split(',') };
  if (source) where.source = { in: String(source).split(',') };
  if (completedSince) where.completedAt = { gte: new Date(completedSince) };
  if (dueFrom || dueTo) where.dueAt = { ...(dueFrom ? { gte: new Date(dueFrom) } : {}), ...(dueTo ? { lt: new Date(dueTo) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({ where, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], take: Math.min(500, limit), include: { client: CLIENT_SELECT } }),
    prisma.task.count({ where }),
  ]);
  const tz = await tzFor(workspaceId);
  let tasks = rows.map((r) => serializeTask(r, tz));
  if (withEv) tasks = await attachEv(workspaceId, tasks);
  return { tasks, total };
}

// The to-do board: YOUR LIST (pending) · SERENA SUGGESTS (suggested ≤7 days) ·
// DONE TODAY (completed since local midnight).
async function todoBoard({ workspaceId, tz }) {
  const zone = tz || await tzFor(workspaceId);
  const midnight = dayBounds(dayKey(new Date(), zone), zone).start;
  const [mine, suggested, done] = await Promise.all([
    prisma.task.findMany({ where: { workspaceId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 300, include: { client: CLIENT_SELECT } }),
    prisma.task.findMany({ where: { workspaceId, status: 'suggested', createdAt: { gte: new Date(Date.now() - 7 * 864e5) } }, orderBy: { createdAt: 'desc' }, take: 60, include: { client: CLIENT_SELECT } }),
    prisma.task.findMany({ where: { workspaceId, status: 'done', completedAt: { gte: midnight } }, orderBy: { completedAt: 'desc' }, take: 60, include: { client: CLIENT_SELECT } }),
  ]);
  const ser = (r) => serializeTask(r, zone);
  return {
    tasks: await attachEv(workspaceId, mine.map(ser)),
    suggested: await attachEv(workspaceId, suggested.map(ser)),
    done: done.map(ser),
  };
}

module.exports = {
  createTask, updateTask, completeTask, deleteTask, listTasks, todoBoard, autoLinkClient, serializeTask, attachEv,
  tokens, tokenMatches, normPriority, PRIORITY, STAGE_ODDS,
};

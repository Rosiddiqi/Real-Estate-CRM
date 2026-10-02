// Serena thread persistence. One thread per (workspace, user). Each assistant
// SerenaMessage carries `actions` JSON:
//   { status: running|done|error, mode: ai|offline,
//     cards: [{ id, category, label, title, meta, open, undo (server-only), undoneAt, tool }],
//     proposals: [{ id, kind, summary, clientId, clientName, to, channel, body, subject, …, status, decidedAt }],
//     activity: [{ id, name, kind, label, ok, summary }],
//     suggestions: ["follow-up chip", …], entities: [{ type, id, name, sub, phone }] }
const prisma = require('../../lib/prisma');

async function getOrCreateThread(workspaceId, userId) {
  const existing = await prisma.serenaThread.findFirst({ where: { workspaceId, userId }, orderBy: { lastMessageAt: 'desc' } });
  if (existing) return existing;
  return prisma.serenaThread.create({ data: { workspaceId, userId, title: 'Serena' } });
}

function stripCard(c) {
  if (!c) return c;
  const { undo, ...rest } = c;
  return { ...rest, undoable: !!undo && !c.undoneAt, undone: !!c.undoneAt };
}

function serializeMessage(m) {
  const a = (m.actions && typeof m.actions === 'object') ? m.actions : {};
  return {
    id: m.id,
    role: m.role,
    text: m.content || '',
    createdAt: m.createdAt,
    status: a.status || 'done',
    mode: a.mode || null,
    cards: (a.cards || []).map(stripCard),
    proposals: a.proposals || [],
    activity: (a.activity || []).map(({ id, name, kind, label, ok, summary }) => ({ id, name, kind, label, ok, summary })),
    suggestions: a.suggestions || [],
    entities: a.entities || [],
    error: a.error || null,
  };
}

async function loadThread(workspaceId, userId, { limit = 120 } = {}) {
  const thread = await prisma.serenaThread.findFirst({ where: { workspaceId, userId }, orderBy: { lastMessageAt: 'desc' } });
  if (!thread) return { thread: null, messages: [], running: false };
  const rows = await prisma.serenaMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: 'desc' }, take: limit });
  rows.reverse();
  // A turn stuck "running" for > 6 minutes died with the process — close it out.
  const stale = rows.filter((r) => r.actions && r.actions.status === 'running' && Date.now() - new Date(r.createdAt).getTime() > 6 * 60e3);
  for (const r of stale) {
    const actions = { ...r.actions, status: 'error', error: 'interrupted' };
    const content = r.content || 'That one got interrupted before I could finish — ask me again?';
    await prisma.serenaMessage.update({ where: { id: r.id }, data: { actions, content } }).catch(() => {});
    r.actions = actions;
    r.content = content;
  }
  const messages = rows.map(serializeMessage);
  return { thread: { id: thread.id, lastMessageAt: thread.lastMessageAt }, messages, running: messages.some((m) => m.status === 'running') };
}

// Conversation history for the model: last N text turns. Assistant turns get
// a compact ledger of what was actually done so follow-ups ("move that to 3")
// can reference real ids.
async function historyForModel(threadId, { limit = 20, before } = {}) {
  const rows = await prisma.serenaMessage.findMany({
    where: { threadId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  rows.reverse();
  const out = [];
  for (const r of rows) {
    const a = (r.actions && typeof r.actions === 'object') ? r.actions : {};
    if (r.role === 'assistant' && a.status === 'running') continue;
    let content = (r.content || '').trim();
    if (r.role === 'assistant') {
      const ledger = [];
      for (const c of a.cards || []) ledger.push(`${c.label}: ${c.title}${c.meta ? ` (${c.meta})` : ''}${c.undoneAt ? ' — UNDONE by the agent' : ''}`);
      for (const p of a.proposals || []) ledger.push(`Drafted ${p.kind} to ${p.clientName || p.name || 'recipient'} — ${p.status === 'sent' ? 'the agent sent it' : p.status === 'dismissed' ? 'the agent dismissed it' : 'awaiting the agent'}`);
      if (ledger.length) content = `${content}\n\n[What happened this turn: ${ledger.join('; ')}]`.trim();
    }
    if (!content) continue;
    const role = r.role === 'user' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function readMarker(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true, createdAt: true } });
  const at = u && u.preferences && u.preferences.serenaReadAt ? new Date(u.preferences.serenaReadAt) : null;
  return at;
}

async function unreadCount(workspaceId, userId) {
  const thread = await prisma.serenaThread.findFirst({ where: { workspaceId, userId }, orderBy: { lastMessageAt: 'desc' } });
  if (!thread) return 0;
  const since = await readMarker(userId);
  return prisma.serenaMessage.count({ where: { threadId: thread.id, role: 'assistant', content: { not: '' }, ...(since ? { createdAt: { gt: since } } : {}) } });
}

async function markRead(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  if (!u) return;
  const preferences = { ...(u.preferences || {}), serenaReadAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { preferences } });
}

// Find the message + card/proposal for an id like "<messageId>.c2" / ".p0".
async function findItem(workspaceId, itemId) {
  const s = String(itemId || '');
  const dot = s.lastIndexOf('.');
  if (dot < 0) return null;
  const messageId = s.slice(0, dot);
  const msg = await prisma.serenaMessage.findFirst({ where: { id: messageId, workspaceId } });
  if (!msg) return null;
  const a = (msg.actions && typeof msg.actions === 'object') ? msg.actions : {};
  const card = (a.cards || []).find((c) => c.id === s) || null;
  const proposal = (a.proposals || []).find((p) => p.id === s) || null;
  return { msg, actions: a, card, proposal };
}

async function saveActions(messageId, actions) {
  return prisma.serenaMessage.update({ where: { id: messageId }, data: { actions } });
}

module.exports = { getOrCreateThread, loadThread, serializeMessage, stripCard, historyForModel, unreadCount, markRead, findItem, saveActions };

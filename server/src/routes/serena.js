// Serena — the AI chief of staff.
//   GET  /api/serena/thread                 → { thread, messages, running }
//   GET  /api/serena/unread                 → { unread }
//   POST /api/serena/read                   → { ok }
//   POST /api/serena/turn  {text, context}  → text/event-stream (thread.id, turn.start,
//        assistant.thinking, assistant.delta, tool.call, tool.result, action.card,
//        proposal, turn.complete, turn.error). Detached: the turn finishes and
//        persists even if the client disconnects.
//   POST /api/serena/actions/:id/undo       → { ok, card }
//   POST /api/serena/proposals/:id  {action:'send'|'dismiss'|'edit', body, subject}
//   POST /api/serena/thread/reset           → { thread }
//   GET  /api/serena/memory · DELETE /api/serena/memory/:id
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { ah, parse, HttpError } = require('../lib/http');
const store = require('../services/serena/thread');
const agent = require('../services/serena/agent');
const fx = require('../services/serena/effects');
const U = require('../services/serena/util');

const router = express.Router();

router.get('/thread', ah(async (req, res) => {
  const limit = Math.min(300, parseInt(req.query.limit, 10) || 120);
  const out = await store.loadThread(req.workspaceId, req.userId, { limit });
  res.json({ ...out, running: out.running || agent.isRunning(req.userId) });
}));

router.get('/unread', ah(async (req, res) => {
  res.json({ unread: await store.unreadCount(req.workspaceId, req.userId), running: agent.isRunning(req.userId) });
}));

router.post('/read', ah(async (req, res) => {
  await store.markRead(req.userId);
  res.json({ ok: true });
}));

const TurnBody = z.object({
  text: z.string().trim().min(1, 'Say something first').max(6000),
  context: z.object({
    screen: z.string().max(80).optional().nullable(),
    tab: z.string().max(40).optional().nullable(),
    clientId: z.string().max(80).optional().nullable(),
    dealId: z.string().max(80).optional().nullable(),
    listingId: z.string().max(80).optional().nullable(),
    conversationId: z.string().max(80).optional().nullable(),
  }).partial().optional().nullable(),
});

router.post('/turn', ah(async (req, res) => {
  const { text, context } = parse(TurnBody, req.body || {});
  if (agent.isRunning(req.userId)) throw new HttpError(409, 'Serena is still working on your last message.');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': serena turn open\n\n');
  let open = true;
  res.on('close', () => { open = false; });
  const emit = (event, data) => {
    if (!open || res.writableEnded) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { open = false; }
  };
  const keepalive = setInterval(() => { if (open && !res.writableEnded) { try { res.write(': keepalive\n\n'); } catch { /* gone */ } } }, 20000);
  const clean = Object.fromEntries(Object.entries(context || {}).filter(([, v]) => v));
  try {
    await agent.runTurn({ workspaceId: req.workspaceId, userId: req.userId, text, context: clean, emit });
  } catch (err) {
    emit('turn.error', { reason: err.status === 409 ? 'busy' : 'turn_error', message: err.message });
  } finally {
    clearInterval(keepalive);
    if (!res.writableEnded) res.end();
  }
}));

router.post('/actions/:id/undo', ah(async (req, res) => {
  const found = await store.findItem(req.workspaceId, req.params.id);
  if (!found || !found.card) throw new HttpError(404, 'That action is gone.');
  const { msg, actions, card } = found;
  if (card.undoneAt) throw new HttpError(409, 'Already undone.');
  if (!card.undo) throw new HttpError(400, 'This action can’t be undone.');
  const tz = await U.tzFor(req.workspaceId, req.userId);
  try {
    await fx.applyUndo({ workspaceId: req.workspaceId, userId: req.userId, tz, actor: 'agent' }, card.undo);
  } catch (err) {
    throw new HttpError(400, err.message || 'Undo failed');
  }
  const cards = (actions.cards || []).map((c) => (c.id === card.id ? { ...c, undoneAt: new Date().toISOString() } : c));
  await store.saveActions(msg.id, { ...actions, cards });
  res.json({ ok: true, card: store.stripCard(cards.find((c) => c.id === card.id)) });
}));

const ProposalBody = z.object({
  action: z.enum(['send', 'dismiss', 'edit', 'opened']),
  body: z.string().max(4000).optional(),
  subject: z.string().max(300).optional(),
  clientId: z.string().optional(),
});

router.post('/proposals/:id', ah(async (req, res) => {
  const { action, body, subject, clientId } = parse(ProposalBody, req.body || {});
  const found = await store.findItem(req.workspaceId, req.params.id);
  if (!found || !found.proposal) throw new HttpError(404, 'That draft is gone.');
  const { msg, actions, proposal } = found;
  const patch = {};
  let sent = null;
  if (action === 'dismiss') { patch.status = 'dismissed'; patch.decidedAt = new Date().toISOString(); }
  if (action === 'edit') { if (body != null) patch.body = body; if (subject != null) patch.subject = subject; if (clientId) patch.clientId = clientId; }
  if (action === 'opened') { patch.status = 'opened'; patch.decidedAt = new Date().toISOString(); if (body != null) patch.body = body; }
  if (action === 'send') {
    if (proposal.status === 'sent') throw new HttpError(409, 'Already sent.');
    const finalBody = String(body != null ? body : proposal.body || '').trim();
    const to = clientId || proposal.clientId;
    if (!finalBody) throw new HttpError(400, 'The message is empty.');
    if (!to) throw new HttpError(400, 'Pick who it goes to first.');
    const client = await prisma.client.findFirst({ where: { id: to, workspaceId: req.workspaceId } });
    if (!client) throw new HttpError(404, 'Client not found');
    if (proposal.kind === 'text' && client.textOptOut) throw new HttpError(400, `${U.nameOf(client)} opted out of texts.`);
    const mod = U.optionalRequire('../messaging/send');
    const send = U.fnFrom(mod, 'sendMessage');
    if (!send) throw new HttpError(501, 'Sending from Serena isn’t available yet — open the thread to send it.');
    const payload = {
      workspaceId: req.workspaceId,
      userId: req.userId,
      clientId: client.id,
      conversationId: proposal.kind === 'text' && proposal.conversationId && proposal.clientId === client.id ? proposal.conversationId : undefined,
      body: finalBody,
      source: 'serena',
      aiGenerated: true,
    };
    if (proposal.kind === 'email') { payload.service = 'email'; payload.subject = subject != null ? subject : proposal.subject; }
    try {
      sent = await send(payload);
    } catch (err) {
      throw new HttpError(err.status || 502, err.message || 'Couldn’t send that message.');
    }
    Object.assign(patch, { status: 'sent', decidedAt: new Date().toISOString(), body: finalBody, clientId: client.id, clientName: U.nameOf(client) });
    if (subject != null) patch.subject = subject;
    if (sent && sent.conversation) patch.conversationId = sent.conversation.id;
    if (sent && sent.message) patch.sentMessageId = sent.message.id;
  }
  const proposals = (actions.proposals || []).map((p) => (p.id === proposal.id ? { ...p, ...patch } : p));
  await store.saveActions(msg.id, { ...actions, proposals });
  res.json({ ok: true, proposal: proposals.find((p) => p.id === proposal.id), conversationId: patch.conversationId || null });
}));

router.post('/thread/reset', ah(async (req, res) => {
  const thread = await prisma.serenaThread.create({ data: { workspaceId: req.workspaceId, userId: req.userId, title: 'Serena' } });
  await store.markRead(req.userId);
  res.json({ thread: { id: thread.id, lastMessageAt: thread.lastMessageAt } });
}));

router.get('/memory', ah(async (req, res) => {
  const memories = await prisma.serenaMemory.findMany({ where: { workspaceId: req.workspaceId, userId: req.userId }, orderBy: { updatedAt: 'desc' } });
  res.json({ memories, total: memories.length });
}));

router.delete('/memory/:id', ah(async (req, res) => {
  await prisma.serenaMemory.deleteMany({ where: { id: req.params.id, workspaceId: req.workspaceId, userId: req.userId } });
  res.json({ ok: true });
}));

module.exports = router;

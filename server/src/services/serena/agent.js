// Serena's turn runner. One turn = persist the user message → stream the
// reply (AI tool loop when available, deterministic router otherwise) →
// receipts / proposals / activity persisted on the assistant message → memory.
//
// Turns are DETACHED: closing the chat never kills a run. Events go to the
// SSE `emit` while the client is listening; everything is persisted so the
// thread (and the bubble's unread dot) catches up afterwards.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const ai = require('../../ai/claude');
const U = require('./util');
const store = require('./thread');
const { stablePrompt } = require('./prompt');
const { contextBlock } = require('./context');
const { runTool, agentTools } = require('./tools');
const fallback = require('./fallback');
const memory = require('./memory');

const running = new Map(); // userId → { messageId, startedAt }

class Turn {
  constructor({ workspaceId, userId, tz, messageId, emit, agentFirst }) {
    this.ctx = { workspaceId, userId, tz, names: new Map(), actor: 'ai', agentFirst, offline: false };
    this.messageId = messageId;
    this._emit = emit;
    this.text = '';
    this.cards = [];
    this.proposals = [];
    this.activity = [];
    this.suggestions = [];
    this.entities = [];
    this.mode = 'offline';
    this._saveTimer = null;
  }

  emit(event, data) { try { this._emit(event, data); } catch { /* client gone */ } }

  delta(text) {
    if (!text) return;
    this.text += text;
    this.emit('assistant.delta', { text });
  }

  // Offline replies stream in small chunks so they feel alive.
  say(text) {
    if (!text) return;
    const hasText = this.text || (this._pending && this._pending.length);
    const chunk = hasText ? `\n\n${text}` : text;
    this._pending = (this._pending || []).concat(chunk.match(/[\s\S]{1,28}(\s|$)|[\s\S]+$/g) || [chunk]);
  }

  async flushSay() {
    const parts = this._pending || [];
    this._pending = [];
    for (const p of parts) {
      this.delta(p);
      await new Promise((r) => setTimeout(r, 14));
    }
  }

  suggest(...chips) { for (const c of chips) if (c && !this.suggestions.includes(c)) this.suggestions.push(c); }

  addCard(card) {
    const c = { ...card, id: `${this.messageId}.c${this.cards.length}`, createdAt: new Date().toISOString() };
    this.cards.push(c);
    this.emit('action.card', { messageId: this.messageId, card: store.stripCard(c) });
    this.save();
    return c;
  }

  addProposal(p) {
    const prop = { ...p, id: `${this.messageId}.p${this.proposals.length}`, status: 'pending', createdAt: new Date().toISOString() };
    this.proposals.push(prop);
    this.emit('proposal', { messageId: this.messageId, proposal: prop });
    this.save();
    return prop;
  }

  call(name, input) { return runTool(name, input, this); }

  actions(status, extra = {}) {
    return { status, mode: this.mode, cards: this.cards, proposals: this.proposals, activity: this.activity, suggestions: this.suggestions, entities: this.entities, ...extra };
  }

  // Persist progress (cards are undoable the moment they land).
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      prisma.serenaMessage.update({ where: { id: this.messageId }, data: { actions: this.actions('running'), content: this.text } }).catch(() => {});
    }, 150);
  }

  async finish(status, extra) {
    clearTimeout(this._saveTimer);
    await prisma.serenaMessage.update({ where: { id: this.messageId }, data: { content: this.text.trim(), actions: this.actions(status, extra) } });
  }
}

async function runAi(turn, { user, workspace, threadId, before, text, context }) {
  const system = [
    { type: 'text', text: stablePrompt({ user, workspace }), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: await contextBlock({ workspaceId: turn.ctx.workspaceId, userId: turn.ctx.userId, tz: turn.ctx.tz, context }) },
  ];
  const history = await store.historyForModel(threadId, { limit: 20, before });
  const messages = [...history, { role: 'user', content: text }];
  let needBreak = false;
  turn.emit('assistant.thinking', { phase: 'starting' });
  const out = await ai.agent({
    system,
    messages,
    tools: agentTools(turn),
    effort: 'high',
    maxTurns: 10,
    maxTokens: 16000,
    feature: 'serena_turn',
    workspaceId: turn.ctx.workspaceId,
    onText: (d) => {
      if (needBreak && turn.text && !/\n\n$/.test(turn.text)) turn.delta('\n\n');
      needBreak = false;
      turn.delta(d);
    },
    onToolCall: () => { if (turn.text) needBreak = true; },
  });
  if (out && out.text) turn.text = out.text;
  if (!turn.text.trim()) {
    turn.text = turn.cards.length || turn.proposals.length
      ? 'Done.'
      : 'I hit a complexity ceiling on that one — try breaking it into a smaller ask.';
    turn.emit('assistant.delta', { text: turn.text });
  }
}

async function runTurn({ workspaceId, userId, text, context = {}, emit }) {
  if (running.has(userId)) {
    const r = running.get(userId);
    if (Date.now() - r.startedAt < 5 * 60e3) {
      const err = new Error('Serena is still working on your last message.');
      err.status = 409;
      throw err;
    }
  }
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  const tz = (user && user.timezone) || (workspace && workspace.timezone) || require('../../config').timezone;
  const thread = await store.getOrCreateThread(workspaceId, userId);
  emit('thread.id', { threadId: thread.id });

  const userMsg = await prisma.serenaMessage.create({ data: { workspaceId, threadId: thread.id, role: 'user', content: text, actions: context && Object.keys(context).length ? { context } : undefined } });
  const asst = await prisma.serenaMessage.create({ data: { workspaceId, threadId: thread.id, role: 'assistant', content: '', actions: { status: 'running', cards: [], proposals: [], activity: [] } } });
  await prisma.serenaThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }).catch(() => {});
  emit('turn.start', { userMessageId: userMsg.id, messageId: asst.id, createdAt: asst.createdAt });

  running.set(userId, { messageId: asst.id, startedAt: Date.now() });
  const turn = new Turn({ workspaceId, userId, tz, messageId: asst.id, emit, agentFirst: user ? user.firstName : null });
  const started = Date.now();
  let status = 'done';
  let error = null;
  try {
    if (ai.available()) {
      turn.mode = 'ai';
      try {
        await runAi(turn, { user, workspace, threadId: thread.id, before: userMsg.createdAt, text, context });
      } catch (err) {
        const untouched = !turn.text && !turn.cards.length && !turn.proposals.length;
        console.warn('[serena] AI turn failed:', err.code || '', err.message);
        if (untouched) {
          turn.mode = 'offline';
          turn.ctx.offline = true;
          turn.activity.length = 0;
          await fallback.route(turn, text, context);
          await turn.flushSay();
        } else {
          turn.delta('\n\nI lost my connection partway through — everything above is done. Ask me to pick it up from here.');
          error = 'ai_interrupted';
        }
      }
    } else {
      turn.mode = 'offline';
      turn.ctx.offline = true;
      await fallback.route(turn, text, context);
      await turn.flushSay();
    }
  } catch (err) {
    console.error('[serena] turn failed:', err);
    status = 'error';
    error = err.message || 'turn_failed';
    if (!turn.text) turn.delta('Something went wrong on my side — try that again in a moment.');
  } finally {
    running.delete(userId);
  }

  await turn.finish(status, error ? { error } : {});
  await prisma.serenaThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }).catch(() => {});
  const final = await prisma.serenaMessage.findUnique({ where: { id: asst.id } });
  emit(status === 'error' ? 'turn.error' : 'turn.complete', { messageId: asst.id, mode: turn.mode, durationMs: Date.now() - started, message: store.serializeMessage(final), reason: error });
  try { hub.sendToUser(userId, 'serena_event', { type: 'turn.complete', messageId: asst.id }); } catch { /* ignore */ }

  // Memory runs after the reply is out (never delays the turn).
  if (status === 'done') {
    prisma.serenaMemory.findMany({ where: { workspaceId, userId }, select: { text: true }, take: 40 })
      .then((rows) => memory.extractAfterTurn({ workspaceId, userId, userText: text, assistantText: turn.text, existing: rows.map((r) => r.text) }))
      .catch(() => {});
  }
  return { messageId: asst.id, mode: turn.mode };
}

function isRunning(userId) { return running.has(userId); }

module.exports = { runTurn, isRunning, Turn };

// Messaging boot hook: WebSocket handlers for the inbox.
//   web → server  'typing' { conversationId, isTyping }  → relayed to the
//                 rest of the workspace as 'typing' { conversationId, isTyping, from:'agent', userId }
// (The iMessage bridge transport is out of scope for this build — no bridge
// authenticator is registered, so /ws?type=bridge connections are refused.)
const prisma = require('../lib/prisma');

const lastTyping = new Map(); // ws -> { conversationId, at }

function init({ hub }) {
  const relay = async (ctx, payload, isTypingOverride) => {
    const conversationId = payload && payload.conversationId;
    if (!conversationId || typeof conversationId !== 'string') return;
    const isTyping = isTypingOverride != null ? isTypingOverride : !!payload.isTyping;
    // Throttle identical "still typing" pings to one per 2s per socket.
    const prev = lastTyping.get(ctx.ws);
    if (isTyping && prev && prev.conversationId === conversationId && prev.typing && Date.now() - prev.at < 2000) return;
    lastTyping.set(ctx.ws, { conversationId, at: Date.now(), typing: isTyping });
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId }, select: { id: true } }).catch(() => null);
    if (!conv) return;
    hub.broadcast(ctx.workspaceId, 'typing', { conversationId, isTyping, from: 'agent', userId: ctx.userId }, { exclude: ctx.ws });
  };
  hub.on('web', 'typing', (ctx, payload) => relay(ctx, payload));
  // RevMatch-era event names, kept so older clients still work.
  hub.on('web', 'typing_start', (ctx, payload) => relay(ctx, payload, true));
  hub.on('web', 'typing_stop', (ctx, payload) => relay(ctx, payload, false));

  // Resume demo deliveries/replies that a restart interrupted.
  const t = setTimeout(() => {
    require('../services/messaging/providers/demo').recover()
      .then((n) => { if (n) console.log(`[messaging] resumed ${n} in-flight demo message(s)`); })
      .catch((err) => console.error('[messaging] demo recovery failed:', err.message));
  }, 1500);
  if (t.unref) t.unref();
}

module.exports = { init };

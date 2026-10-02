// WebSocket hub — ONE socket server for the whole app (RevMatch pattern).
//
//   /ws?type=web&token=<access JWT>      → the CRM web/PWA client
//   /ws?type=bridge&token=<bridge token> → an iMessage bridge (Mac) client
//
// Envelope (both directions, matches RevMatch): { event, payload, timestamp }
// Bridges may also send { type, ... } — `event || type` is used as the name.
//
// Extend by registering handlers, never by adding a second socket server:
//   hub.on('web', 'typing', (ctx, payload, raw) => {...})
//   hub.on('bridge', 'message_received', (ctx, payload, raw) => {...})
//   hub.onBridgeConnect((ctx) => {...}); hub.onBridgeDisconnect((ctx) => {...})
//   hub.setBridgeAuthenticator(async (token) => ({ bridgeId, workspaceId }) | null)
const { WebSocketServer } = require('ws');
const { verifyAccess } = require('../lib/auth');

const webClients = new Map(); // workspaceId -> Set<ws>
const bridgeClients = new Map(); // bridgeId -> ws
const handlers = { web: new Map(), bridge: new Map() };
const lifecycle = { bridgeConnect: [], bridgeDisconnect: [], webConnect: [] };
let bridgeAuthenticator = null;
let wss = null;

function envelope(event, payload) {
  return JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) ws.send(data, { compress: false });
  } catch (_) { /* socket died mid-send */ }
}

function broadcast(workspaceId, event, payload, { exclude } = {}) {
  const set = webClients.get(workspaceId);
  if (!set || !set.size) return 0;
  const msg = envelope(event, payload);
  let n = 0;
  for (const ws of set) {
    if (ws === exclude) continue;
    safeSend(ws, msg);
    n++;
  }
  return n;
}

function sendToUser(userId, event, payload) {
  const msg = envelope(event, payload);
  for (const set of webClients.values()) {
    for (const ws of set) if (ws.ctx && ws.ctx.userId === userId) safeSend(ws, msg);
  }
}

function sendToBridge(bridgeId, event, payload) {
  const ws = bridgeClients.get(bridgeId);
  if (!ws || ws.readyState !== 1) return false;
  safeSend(ws, envelope(event, payload));
  return true;
}

function sendRawToBridge(bridgeId, obj) {
  const ws = bridgeClients.get(bridgeId);
  if (!ws || ws.readyState !== 1) return false;
  safeSend(ws, JSON.stringify(obj));
  return true;
}

const isBridgeConnected = (bridgeId) => {
  const ws = bridgeClients.get(bridgeId);
  return !!ws && ws.readyState === 1;
};

function on(kind, event, fn) {
  const map = handlers[kind];
  if (!map) throw new Error(`hub.on: unknown kind ${kind}`);
  if (!map.has(event)) map.set(event, []);
  map.get(event).push(fn);
}

const onBridgeConnect = (fn) => lifecycle.bridgeConnect.push(fn);
const onBridgeDisconnect = (fn) => lifecycle.bridgeDisconnect.push(fn);
const onWebConnect = (fn) => lifecycle.webConnect.push(fn);
const setBridgeAuthenticator = (fn) => { bridgeAuthenticator = fn; };

async function dispatch(kind, ctx, raw) {
  let data;
  try { data = JSON.parse(raw.toString()); } catch { return; }
  const name = data.event || data.type;
  if (!name) return;
  if (name === 'ping') return safeSend(ctx.ws, envelope('pong', {}));
  const fns = handlers[kind].get(name) || handlers[kind].get('*') || [];
  for (const fn of fns) {
    try {
      await fn(ctx, data.payload !== undefined ? data.payload : data, data);
    } catch (err) {
      console.error(`[ws] ${kind} handler "${name}" failed:`, err);
    }
  }
}

function attach(server) {
  wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, u.searchParams, req));
  });

  // Heartbeat: terminate sockets that stop answering pings (30s cadence).
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, 30000);
  wss.on('close', () => clearInterval(beat));
  return wss;
}

async function onConnection(ws, params, req) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const type = params.get('type') || 'web';
  const token = params.get('token') || '';

  if (type === 'bridge') {
    const auth = bridgeAuthenticator ? await bridgeAuthenticator(token, req).catch(() => null) : null;
    if (!auth) {
      safeSend(ws, envelope('error', { message: 'Invalid bridge token' }));
      return ws.close(4001, 'unauthorized');
    }
    const ctx = { kind: 'bridge', ws, ...auth };
    ws.ctx = ctx;
    const prev = bridgeClients.get(auth.bridgeId);
    if (prev && prev !== ws) { try { prev.close(4000, 'replaced'); } catch (_) {} }
    bridgeClients.set(auth.bridgeId, ws);
    safeSend(ws, envelope('connected', { bridgeId: auth.bridgeId }));
    for (const fn of lifecycle.bridgeConnect) { try { await fn(ctx); } catch (e) { console.error('[ws] bridgeConnect', e); } }
    ws.on('message', (raw) => dispatch('bridge', ctx, raw));
    ws.on('close', async () => {
      if (bridgeClients.get(auth.bridgeId) === ws) bridgeClients.delete(auth.bridgeId);
      for (const fn of lifecycle.bridgeDisconnect) { try { await fn(ctx); } catch (e) { console.error('[ws] bridgeDisconnect', e); } }
    });
    return;
  }

  // Web client
  let claims;
  try {
    claims = verifyAccess(token);
  } catch {
    // Dev bypass mirrors HTTP middleware behaviour for local work.
    const config = require('../config');
    if (config.auth.devBypass) {
      const prisma = require('../lib/prisma');
      const u = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
      if (u) claims = { sub: u.id, wid: u.workspaceId };
    }
  }
  if (!claims) {
    safeSend(ws, envelope('auth_error', { message: 'Invalid or expired token' }));
    return ws.close(4001, 'unauthorized');
  }
  const ctx = { kind: 'web', ws, userId: claims.sub, workspaceId: claims.wid };
  ws.ctx = ctx;
  if (!webClients.has(ctx.workspaceId)) webClients.set(ctx.workspaceId, new Set());
  webClients.get(ctx.workspaceId).add(ws);
  safeSend(ws, envelope('connected', { userId: ctx.userId }));
  for (const fn of lifecycle.webConnect) { try { await fn(ctx); } catch (e) { console.error('[ws] webConnect', e); } }
  ws.on('message', (raw) => dispatch('web', ctx, raw));
  ws.on('close', () => {
    const set = webClients.get(ctx.workspaceId);
    if (set) { set.delete(ws); if (!set.size) webClients.delete(ctx.workspaceId); }
  });
}

function stats() {
  let web = 0;
  for (const set of webClients.values()) web += set.size;
  return { webClients: web, bridges: bridgeClients.size };
}

module.exports = {
  attach,
  broadcast,
  sendToUser,
  sendToBridge,
  sendRawToBridge,
  isBridgeConnected,
  on,
  onBridgeConnect,
  onBridgeDisconnect,
  onWebConnect,
  setBridgeAuthenticator,
  stats,
};

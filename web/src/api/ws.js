// Realtime socket — ONE connection for the whole app (RevMatch pattern).
//
//   import { ws } from '@/api/ws';
//   useEffect(() => ws.on('message_received', (payload) => {...}), []);
//
// Envelope: { event, payload, timestamp }. The manager auto-reconnects with
// backoff, keeps a healthy socket across token refreshes, and emits a synthetic
// `resync` event after any reconnect or when the app returns to the foreground
// so data hooks can silently re-fetch (no manual sync UI anywhere).
import { getAccessToken, getApiBase, onTokenChange } from './client';

class SocketManager {
  constructor() {
    this.sock = null;
    this.listeners = new Map();
    this.attempts = 0;
    this.timer = null;
    this.closedByUs = false;
    this.connectedOnce = false;
    this.status = 'idle';
  }

  url() {
    const token = getAccessToken() || '';
    let origin;
    const BASE = getApiBase();
    if (BASE) origin = BASE.replace(/^http/, 'ws');
    else origin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    return `${origin}/ws?type=web&token=${encodeURIComponent(token)}`;
  }

  connect() {
    if (this.sock && this.sock.readyState <= 1) return;
    this.closedByUs = false;
    clearTimeout(this.timer);
    let s;
    try { s = new WebSocket(this.url()); } catch { return this.scheduleReconnect(); }
    this.sock = s;
    this.setStatus('connecting');
    s.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
      if (this.connectedOnce) this.emit('resync', { reason: 'reconnect' });
      this.connectedOnce = true;
    };
    s.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const name = data.event || data.type;
      if (name) this.emit(name, data.payload !== undefined ? data.payload : data, data);
    };
    s.onclose = (e) => {
      this.setStatus('closed');
      if (e && e.code === 4001) this.emit('auth_error', {});
      if (!this.closedByUs) this.scheduleReconnect();
    };
    s.onerror = () => { try { s.close(); } catch { /* ignore */ } };
  }

  scheduleReconnect() {
    clearTimeout(this.timer);
    const delay = Math.min(15000, 500 * 2 ** this.attempts) + Math.random() * 300;
    this.attempts += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    this.closedByUs = true;
    clearTimeout(this.timer);
    if (this.sock) { try { this.sock.close(); } catch { /* ignore */ } }
    this.sock = null;
    this.connectedOnce = false;
    this.setStatus('idle');
  }

  send(event, payload) {
    if (this.sock && this.sock.readyState === 1) {
      this.sock.send(JSON.stringify({ event, payload }));
      return true;
    }
    return false;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload, raw) {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of [...fns]) {
      try { fn(payload, raw); } catch (err) { console.error(`[ws] listener for ${event} threw`, err); }
    }
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }
}

export const ws = new SocketManager();

// Keep a healthy socket across token refreshes; only reconnect if it's down.
onTokenChange((t) => {
  if (!t) return ws.disconnect();
  if (!ws.sock || ws.sock.readyState > 1) ws.connect();
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !getAccessToken()) return;
    if (!ws.sock || ws.sock.readyState > 1) ws.connect();
    ws.emit('resync', { reason: 'foreground' });
  });
}

export default ws;

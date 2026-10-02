// The live call, app-wide. The full-screen call UI, the minimized CallPill and
// the Serena bubble all read this; realtime `call_updated` / `call_transcript`
// events stream into it whether or not the call screen is open.
//
//   callStore.start({ clientId, phone, name })   → dials (simulated, Twilio, or the device)
//   callStore.hangup() · toggleHold() · toggleMute() · toggleSpeaker() · note(text)
//
// Device mode (GET /calls/mode → 'device'): the agent's own phone places the
// call. We hand `tel:` to the system dialer, show "Calling <name> on your
// phone…" in the CallPill, and when the app comes back to the foreground open
// the log screen (outcome · duration · notes) — `state.device` tracks it, and
// localStorage keeps it across an app restart.
import { useSyncExternalStore } from 'react';
import { ws } from '../../api/ws';
import * as Calls from '../../api/calls';
import { nav } from '../../lib/nav';
import { isNative } from '../../lib/native';

const LIVE = ['ringing', 'in_progress'];

let state = {
  call: null,          // serialized call (live, or just ended until dismissed)
  lines: [],           // transcript lines { id, speaker, text, t, final, signal }
  cues: [],            // co-pilot cue cards { id, kind, title, reframe, points, lineId }
  dialing: false,
  error: null,
  screenOpen: false,   // the full-screen call overlay is mounted
  muted: false,
  speaker: false,
  mode: null,          // 'simulated' | 'twilio' | 'device' (per workspace, from /calls/mode)
  pending: null,       // { clientId, phone, name } while dialing
  device: null,        // { call, tel, name, at, phase: 'calling'|'back', left, hidden, awaySec }
};
const DEVICE_KEY = 'km_device_call';
const DEVICE_RESTORE_MS = 90 * 60e3;
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; emit(); };

function upsertLine(line) {
  set((s) => {
    const i = s.lines.findIndex((l) => l.id === line.id);
    const lines = i >= 0 ? s.lines.map((l, k) => (k === i ? { ...l, ...line } : l)) : [...s.lines, line];
    return { lines };
  });
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  loadMode();
  armReturnWatch();
  ws.on('call_updated', (c) => {
    if (!c || !c.id || c.deleted) return;
    const cur = state.call;
    if (cur && cur.id === c.id) {
      set({ call: { ...cur, ...c, transcript: undefined } });
      return;
    }
    // A call started elsewhere (another tab/device) → adopt it.
    if (!cur && LIVE.includes(c.status) && c.direction === 'outbound') {
      set({ call: c, lines: [], cues: [] });
    }
  });
  ws.on('call_transcript', (p) => {
    if (!p || !state.call || p.callId !== state.call.id || !p.line) return;
    upsertLine(p.line);
    if (p.cue) set((s) => ({ cues: s.cues.some((c) => c.kind === p.cue.kind) ? s.cues : [...s.cues, p.cue] }));
  });
  ws.on('resync', async () => {
    loadMode();
    if (!state.call) return;
    try {
      const { call } = await Calls.getCall(state.call.id);
      if (call) set({ call, lines: mergeLines(state.lines, call.transcript || []) });
    } catch { /* ignore */ }
  });
}

function mergeLines(local, server) {
  const byId = new Map(local.map((l) => [l.id, l]));
  for (const l of server) byId.set(l.id, { ...byId.get(l.id), ...l, final: true });
  return [...byId.values()].sort((a, b) => (a.t || 0) - (b.t || 0));
}

async function restore() {
  wire();
  restoreDevice();
  if (state.call) return state.call;
  try {
    const { call } = await Calls.getActiveCall();
    if (call && LIVE.includes(call.status)) set({ call, lines: call.transcript || [], cues: [] });
    return call;
  } catch { return null; }
}

let modeLoading = null;
function loadMode() {
  if (modeLoading) return modeLoading;
  modeLoading = Calls.getCallMode()
    .then((r) => { if (r && r.mode) set({ mode: r.mode }); return r && r.mode; })
    .catch(() => null)
    .finally(() => { setTimeout(() => { modeLoading = null; }, 30000); });
  return modeLoading;
}

async function start({ clientId, phone, name } = {}) {
  wire();
  if (state.call && LIVE.includes(state.call.status)) return state.call; // one call at a time
  set({ dialing: true, error: null, pending: { clientId, phone, name }, lines: [], cues: [], muted: false, speaker: false, call: null });
  try {
    const { call, mode, tel, message } = await Calls.dial({ clientId, phone });
    if (mode === 'device' && !call) throw new Error(message || `No phone number for ${name || 'them'}`);
    if (mode === 'device') {
      set({ dialing: false, pending: null, mode });
      beginDevice(call, tel, name);
      return call;
    }
    set({ call, mode, dialing: false, lines: call.transcript || [], pending: null });
    return call;
  } catch (err) {
    set({ dialing: false, error: err.message || 'Couldn’t place the call', pending: null });
    throw err;
  }
}

// ── device mode: the agent's own phone places the call ───────────────────
function saveDevice(d) {
  try {
    if (d) localStorage.setItem(DEVICE_KEY, JSON.stringify({ id: d.call.id, name: d.name, clientId: d.call.clientId || null, tel: d.tel, at: d.at }));
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* ignore */ }
}

function openDialer(tel) {
  if (!tel) return;
  try { window.location.href = `tel:${tel}`; } catch { /* no dialer here — the pill offers Log */ }
}

function beginDevice(call, tel, name) {
  const prev = state.device;
  if (prev && prev.call && prev.call.id !== call.id) Calls.hangup(prev.call.id).catch(() => {});
  const display = name || (call.client && call.client.name) || null;
  const d = { call, tel, name: display, at: Date.now(), phase: 'calling', left: false, hidden: false, awaySec: null };
  set({ device: d });
  saveDevice(d);
  openDialer(tel);
}

function patchDevice(patch) { if (state.device) set((s) => ({ device: { ...s.device, ...patch } })); }

// Back from the Phone app → open the log screen (once per call).
function cameBack() {
  const d = state.device;
  if (!d || d.phase !== 'calling' || !d.left) return;
  const away = (Date.now() - d.at) / 1000;
  if (!d.hidden && away < 4) return; // a dialer prompt that was cancelled right away
  openDeviceLog({ awaySec: Math.round(away) });
}

function openDeviceLog({ awaySec } = {}) {
  const d = state.device;
  if (!d) return;
  patchDevice({ phase: 'back', awaySec: awaySec ?? d.awaySec ?? Math.round((Date.now() - d.at) / 1000) });
  if (!nav.getState().overlays.some((o) => o.type === 'call')) nav.open('call', { callId: d.call.id });
}

let returnWatch = false;
function armReturnWatch() {
  if (returnWatch || typeof window === 'undefined') return;
  returnWatch = true;
  const leave = (hidden) => {
    const d = state.device;
    if (!d || d.phase !== 'calling') return;
    patchDevice({ left: true, hidden: d.hidden || !!hidden });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave(true);
    else setTimeout(cameBack, 250);
  });
  window.addEventListener('blur', () => leave(false));
  window.addEventListener('focus', () => setTimeout(cameBack, 250));
  window.addEventListener('pageshow', () => setTimeout(cameBack, 250));
  if (isNative()) {
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => { if (!isActive) leave(true); else setTimeout(cameBack, 250); });
    }).catch(() => {});
  }
}

// The app was killed while the agent was on the call: pick the log back up.
let deviceRestored = false;
async function restoreDevice() {
  if (deviceRestored || state.device) return;
  deviceRestored = true;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch { saved = null; }
  if (!saved || !saved.id) return;
  if (!saved.at || Date.now() - saved.at > DEVICE_RESTORE_MS) { saveDevice(null); return; }
  try {
    const { call } = await Calls.getCall(saved.id);
    if (!call || call.mode !== 'device' || call.status !== 'dialed' || call.outcome) { saveDevice(null); return; }
    set({ device: { call, tel: saved.tel, name: saved.name || (call.client && call.client.name) || null, at: saved.at, phase: 'calling', left: true, hidden: true, awaySec: null } });
    openDeviceLog({ awaySec: Math.round((Date.now() - saved.at) / 1000) });
  } catch { saveDevice(null); }
}

// Save the outcome. Returns the logged call; when there are notes it becomes
// state.call so the recap (summary + one-at-a-time follow-ups) can show it.
async function logDevice({ outcome, durationSec, notes }) {
  const d = state.device;
  if (!d) throw new Error('Nothing to log');
  const { call } = await Calls.logDeviceCall(d.call.id, { outcome, durationSec, notes });
  saveDevice(null);
  set({ device: null, ...(notes && notes.trim() ? { call: { ...call, transcript: undefined }, lines: [], cues: [] } : {}) });
  return call;
}

// "Not now": it stays 'dialed' with no outcome.
function dismissDevice() {
  const d = state.device;
  if (!d) return;
  saveDevice(null);
  set({ device: null });
  Calls.hangup(d.call.id).catch(() => {});
}

async function hangup() {
  const c = state.call;
  if (!c) return;
  // Optimistic: leave the in-call screen immediately.
  set({ call: { ...c, status: c.answeredAt ? 'completed' : 'cancelled', endedAt: new Date().toISOString(), recapStatus: c.answeredAt ? 'pending' : null } });
  try {
    const { call } = await Calls.hangup(c.id);
    set((s) => ({ call: { ...s.call, ...call, transcript: undefined }, lines: mergeLines(s.lines.filter((l) => l.final !== false), call.transcript || []) }));
  } catch { /* the server closes stale calls on its own */ }
}

async function toggleHold() {
  const c = state.call;
  if (!c) return;
  const held = !c.held;
  set({ call: { ...c, held } });
  try { await Calls.setHold(c.id, held); } catch { set((s) => ({ call: { ...s.call, held: !held } })); }
}

function toggleMute() { set((s) => ({ muted: !s.muted })); }
function toggleSpeaker() { set((s) => ({ speaker: !s.speaker })); }

async function note(text) {
  const c = state.call;
  if (!c) return;
  const t = c.answeredAt ? Math.max(0, Math.round((Date.now() - new Date(c.answeredAt).getTime()) / 1000)) : 0;
  upsertLine({ id: `local_note_${Date.now()}`, speaker: 'note', text: text || 'Marked', t, final: true });
  try { await Calls.addCallNote(c.id, { t, text }); } catch { /* local echo stays */ }
}

function dismiss() {
  if (state.call && LIVE.includes(state.call.status)) return;
  set({ call: null, lines: [], cues: [], error: null });
}

function patchCall(patch) { if (state.call) set((s) => ({ call: { ...s.call, ...patch } })); }
function setScreenOpen(open) { set({ screenOpen: open }); }
function dismissCue(id) { set((s) => ({ cues: s.cues.map((c) => (c.id === id ? { ...c, dismissed: true } : c)) })); }

export const callStore = {
  getState: () => state,
  subscribe: (fn) => { listeners.add(fn); wire(); return () => listeners.delete(fn); },
  restore, start, hangup, toggleHold, toggleMute, toggleSpeaker, note, dismiss, patchCall, setScreenOpen, dismissCue,
  loadMode, openDeviceLog, logDevice, dismissDevice,
  isLive: (c = state.call) => !!c && LIVE.includes(c.status),
};

export function useCallState() {
  return useSyncExternalStore(callStore.subscribe, callStore.getState, callStore.getState);
}

export default callStore;

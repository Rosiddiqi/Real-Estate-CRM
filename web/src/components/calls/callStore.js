// The live call, app-wide. The full-screen call UI, the minimized CallPill and
// the Serena bubble all read this; realtime `call_updated` / `call_transcript`
// events stream into it whether or not the call screen is open.
//
//   callStore.start({ clientId, phone, name })   → dials (simulated or Twilio)
//   callStore.hangup() · toggleHold() · toggleMute() · toggleSpeaker() · note(text)
import { useSyncExternalStore } from 'react';
import { ws } from '../../api/ws';
import * as Calls from '../../api/calls';

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
  mode: null,          // 'simulated' | 'twilio'
  pending: null,       // { clientId, phone, name } while dialing
};
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
  if (state.call) return state.call;
  try {
    const { call } = await Calls.getActiveCall();
    if (call && LIVE.includes(call.status)) set({ call, lines: call.transcript || [], cues: [] });
    return call;
  } catch { return null; }
}

async function start({ clientId, phone, name } = {}) {
  wire();
  if (state.call && LIVE.includes(state.call.status)) return state.call; // one call at a time
  set({ dialing: true, error: null, pending: { clientId, phone, name }, lines: [], cues: [], muted: false, speaker: false, call: null });
  try {
    const { call, mode } = await Calls.dial({ clientId, phone });
    set({ call, mode, dialing: false, lines: call.transcript || [], pending: null });
    return call;
  } catch (err) {
    set({ dialing: false, error: err.message || 'Couldn’t place the call', pending: null });
    throw err;
  }
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
  isLive: (c = state.call) => !!c && LIVE.includes(c.status),
};

export function useCallState() {
  return useSyncExternalStore(callStore.subscribe, callStore.getState, callStore.getState);
}

export default callStore;

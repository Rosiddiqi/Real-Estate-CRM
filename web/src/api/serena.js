// Serena API. Turns stream over fetch (POST + text/event-stream) against the
// absolute API origin so they work in the browser, the PWA and the iOS app.
import { api, getAccessToken, getApiBase, refreshSession } from './client';

export const fetchThread = () => api.get('/serena/thread');
export const fetchUnread = () => api.get('/serena/unread');
export const markRead = () => api.post('/serena/read', {});
export const undoCard = (id) => api.post(`/serena/actions/${encodeURIComponent(id)}/undo`, {});
export const decideProposal = (id, payload) => api.post(`/serena/proposals/${encodeURIComponent(id)}`, payload);
export const resetThread = () => api.post('/serena/thread/reset', {});
export const aiStatus = () => api.get('/ai/status');

// Parse an SSE byte stream into { event, data } frames.
async function* sseFrames(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue; // comments / keepalives
      let parsed = null;
      try { parsed = JSON.parse(data.join('\n')); } catch { parsed = data.join('\n'); }
      yield { event, data: parsed };
    }
  }
}

// openTurn({ text, context, onEvent, signal }) → resolves when the stream ends.
// Throws { status, message } for HTTP errors (e.g. 409 busy).
export async function openTurn({ text, context, onEvent, signal }) {
  const send = () => fetch(`${getApiBase()}/api/serena/turn`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify({ text, context }),
  });
  let res = await send();
  if (res.status === 401) {
    await refreshSession();
    res = await send();
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j && j.error) message = j.error; } catch { /* not json */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  for await (const frame of sseFrames(res.body)) {
    try { onEvent?.(frame.event, frame.data); } catch (err) { console.error('[serena] handler failed', err); }
  }
}

// "Which thread is on screen" registry — lets the inbox list treat a text that
// lands in the open thread as already read (no unread flash), and lets the
// thread mark itself read on arrival. Several views can show the same thread
// (split pane + overlay), so it is ref-counted.
const open = new Map(); // conversationId -> count
const listeners = new Set();

export function setThreadOpen(id, isOpen) {
  if (!id) return;
  const n = (open.get(id) || 0) + (isOpen ? 1 : -1);
  if (n > 0) open.set(id, n); else open.delete(id);
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

export const isThreadOpen = (id) => !!id && open.has(id) && document.visibilityState === 'visible';

export function onActiveThreadsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

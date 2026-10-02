// useTodoBoard — the To-Do list's single data path: GET /battle-plan/todo
// (open tasks · Serena suggestions · done today · AI moves for today AND
// tomorrow, merged into one standing list). Every mutation is optimistic with
// rollback + toast, and realtime (plan_updated / task_updated) or a reconnect
// silently refetches.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTodoBoard, planItemAction, sendMoveFeedback } from '../../api/battlePlan';
import { createTask, updateTask } from '../../api/tasks';
import { useResync, useSocket } from '../../hooks/useSocket';
import { toast } from '../ui/toast';
import { haptic } from '../../lib/native';

const EMPTY = { tasks: [], suggested: [], done: [], moves: [] };

export default function useTodoBoard({ enabled = true } = {}) {
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [flash, setFlash] = useState({});          // id → 'added' | 'trained'
  const dataRef = useRef(EMPTY);
  dataRef.current = data;
  const inflight = useRef(0);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await getTodoBoard();
      if (inflight.current > 0) return; // a mutation is mid-air; its own refetch will land
      setData({ tasks: r.tasks || [], suggested: r.suggested || [], done: r.done || [], moves: r.moves || [] });
      setStatus('ready');
    } catch {
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 450);
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const onFocus = () => soon();
    window.addEventListener('focus', onFocus);
    window.addEventListener('km:todos', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('km:todos', onFocus); clearTimeout(timer.current); };
  }, [enabled, load, soon]);
  useSocket(['plan_updated', 'task_updated'], () => { if (enabled) soon(); });
  useResync(() => { if (enabled) load(); });

  // Run an optimistic mutation: apply → request → refetch; rollback on failure.
  const mutate = useCallback(async (apply, request, { error = 'Couldn’t save that — try again.', rethrow = false } = {}) => {
    const before = dataRef.current;
    setData((d) => apply(d));
    inflight.current += 1;
    try {
      const out = await request();
      return out;
    } catch (err) {
      setData(before);
      toast.error(error);
      if (rethrow) throw err;
      return null;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) soon();
    }
  }, [soon]);

  const flashFor = useCallback((id, kind, ms = 1600) => {
    setFlash((f) => ({ ...f, [id]: kind }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[id]; return n; }), ms);
  }, []);

  // ── YOUR LIST ──
  const add = useCallback(async (title) => {
    const tmp = { id: `tmp-${Date.now()}`, title, status: 'pending', createdAt: new Date().toISOString(), priority: 0, pendingSave: true };
    await mutate(
      (d) => ({ ...d, tasks: [tmp, ...d.tasks] }),
      async () => {
        const { task } = await createTask({ title });
        setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === tmp.id ? task : t)) }));
        haptic('light');
        return task;
      },
      { error: 'Couldn’t add that to-do.', rethrow: true },
    );
  }, [mutate]);

  const complete = useCallback((task) => {
    haptic('success');
    return mutate(
      (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== task.id), done: [{ ...task, status: 'done', completedAt: new Date().toISOString() }, ...d.done] }),
      () => updateTask(task.id, { status: 'done' }),
    );
  }, [mutate]);

  const reopen = useCallback((task) => mutate(
    (d) => ({ ...d, done: d.done.filter((t) => t.id !== task.id), tasks: [{ ...task, status: 'pending', completedAt: null }, ...d.tasks] }),
    () => updateTask(task.id, { status: 'pending' }),
  ), [mutate]);

  const remove = useCallback(async (task) => {
    const out = await mutate(
      (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== task.id) }),
      () => updateTask(task.id, { status: 'cancelled' }),
    );
    if (out) {
      toast('To-do removed', { action: { label: 'Undo', onClick: () => mutate((d) => ({ ...d, tasks: [task, ...d.tasks] }), () => updateTask(task.id, { status: 'pending' })) } });
    }
  }, [mutate]);

  // ── SERENA SUGGESTS: captured suggestions ──
  const approveSuggested = useCallback((s) => {
    sendMoveFeedback({ kind: 'todo_suggestion', moveId: undefined, isCorrect: true, feedback: `Approved captured suggestion "${s.title}"` }).catch(() => {});
    haptic('light');
    return mutate(
      (d) => ({ ...d, suggested: d.suggested.filter((x) => x.id !== s.id), tasks: [{ ...s, status: 'pending' }, ...d.tasks] }),
      () => updateTask(s.id, { status: 'pending' }),
    );
  }, [mutate]);

  const dismissSuggested = useCallback((s) => {
    sendMoveFeedback({ kind: 'todo_suggestion', isCorrect: false, feedback: `Dismissed captured suggestion "${s.title}" — off target` }).catch(() => {});
    return mutate(
      (d) => ({ ...d, suggested: d.suggested.filter((x) => x.id !== s.id) }),
      () => updateTask(s.id, { status: 'dismissed' }),
    );
  }, [mutate]);

  // ── SERENA SUGGESTS: planner moves ──
  const dropMove = (id) => (d) => ({ ...d, moves: d.moves.filter((m) => m.id !== id) });

  const addMove = useCallback(async (m) => {
    flashFor(m.id, 'added');
    haptic('light');
    sendMoveFeedback({ moveId: m.id, isCorrect: true, feedback: `Added to to-dos: "${m.title}"${m.clientName ? ` · contact: ${m.clientName}` : ''} · type: ${m.src}` }).catch(() => {});
    const tmp = { id: `tmp-${m.id}`, title: m.title, clientId: m.clientId, client: m.clientId ? { id: m.clientId, name: m.clientName } : null, status: 'pending', createdAt: new Date().toISOString(), priority: 0, ev: { dealValue: m.dealValue, rating: m.stars || 0, whale: m.whale, dealStage: m.dealStage, propertyPriority: m.propertyPriority }, pendingSave: true };
    setTimeout(() => {
      mutate(
        (d) => ({ ...dropMove(m.id)(d), tasks: [tmp, ...d.tasks] }),
        async () => {
          const { task } = await createTask({ title: m.title, clientId: m.clientId || null, fromMoveId: m.id, kind: m.channel, dealId: m.dealId || null, listingId: m.listingId || null });
          setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === tmp.id ? task : t)) }));
          return task;
        },
        { error: 'Couldn’t add that suggestion.' },
      );
    }, 900);
  }, [flashFor, mutate]);

  const trainGood = useCallback((m) => {
    flashFor(m.id, 'trained');
    haptic('success');
    sendMoveFeedback({ moveId: m.id, isCorrect: true }).catch(() => toast.error('Couldn’t send that to the AI.'));
  }, [flashFor]);

  const trainBad = useCallback(({ move, reasons, note, mute }) => mutate(
    dropMove(move.id),
    async () => {
      await sendMoveFeedback({ moveId: move.id, isCorrect: false, reasons, note, mute });
      toast(mute ? `Got it — ${move.firstName || 'they'}’ll stay off your plan for 30 days.` : 'Got it — the AI will learn from that.');
    },
    { error: 'Couldn’t send that to the AI.' },
  ), [mutate]);

  const moveDone = useCallback(async (m, label = 'Marked done') => {
    const out = await mutate(dropMove(m.id), () => planItemAction(m.id, 'done'));
    if (out) {
      toast(label, { action: { label: 'Undo', onClick: () => mutate((d) => ({ ...d, moves: [m, ...d.moves] }), () => planItemAction(m.id, 'reopen')) } });
    }
  }, [mutate]);

  const moveRetime = useCallback((m, startMin, durationMin) => mutate(
    (d) => ({ ...d, moves: d.moves.map((x) => (x.id === m.id ? { ...x, startMin, durationMin } : x)) }),
    () => planItemAction(m.id, 'retime', { startMin, durationMin }),
  ), [mutate]);

  return {
    ...data, status, flash, reload: load,
    add, complete, reopen, remove, approveSuggested, dismissSuggested,
    addMove, trainGood, trainBad, moveDone, moveRetime, dropMoveLocal: (id) => setData(dropMove(id)),
  };
}

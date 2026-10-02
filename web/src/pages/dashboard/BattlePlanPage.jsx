// Battle Plan — page 0 of Home. Port of RevMatch's live "Minimal Rail
// Planner" (BattlePlanRail): burn-away quote hero, fixed chrome (＋ Event ·
// PLAN/STATS dots · ＋ Work schedule, day picker, To-Do chip), a 5 AM–10 PM
// rail that opens centered on a fixed gold NOW line and keeps creeping under
// it, KIND-colored appointment tiles that pulse, side-by-side lanes for
// overlaps, the work-hours bracket, MISSED / ROLLED OVER / PAST groups, pinch
// zoom, and the reactive 7 PM flip to tomorrow.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react';
import Icon from '../../components/ui/Icon';
import Sheet from '../../components/ui/Sheet';
import { toast } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { useAuth } from '../../hooks/useAuth';
import { useResync, useSocket } from '../../hooks/useSocket';
import { getBattlePlan, planItemAction } from '../../api/battlePlan';
import { getAppointments, getWorkSchedule, setScheduleOverride } from '../../api/appointments';
import QuoteHero from '../../components/battleplan/QuoteHero';
import PageDots from '../../components/battleplan/PageDots';
import MonthCalendarSheet from '../../components/battleplan/MonthCalendar';
import TileDetailSheet from '../../components/battleplan/TileDetailSheet';
import TodoPanel from '../../components/battleplan/TodoPanel';
import useTodoBoard from '../../components/battleplan/useTodoBoard';
import { itemColor, apptColor, alpha, KIND_COLOR } from '../../components/calendar/appointmentTypes';
import { fmtMin, durLabel, dateKey, keyToDate, shiftKey, dateLine, resolveWindow, compactHours, hourIn, minuteOfDay, zonedDate, setAgentTz } from '../../components/battleplan/time';
import useAgentTz from '../../components/battleplan/useAgentTz';

const PX = 4.5;
const PX_MIN = 1.2;
const PX_MAX = 9;
const ZOOM_KEY = 'km_planner_zoom';
const LINE_GAP = 24;
const BASE_PAD = 110;          // clears the floating tab bar
const DAY_START = 5 * 60;      // 5:00 AM
const DAY_END = 22 * 60;       // 10:00 PM — the day ends here
const PAST_GRACE = 15;

function readZoom() {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(v)) return Math.min(PX_MAX, Math.max(PX_MIN, v));
  } catch { /* ignore */ }
  return PX;
}

// Greedy interval colouring: tiles that overlap in time sit side by side.
function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => (a.start - b.start) || ((b.dur || 0) - (a.dur || 0)));
  const endOf = (it) => it.start + Math.max(it.dur || 0, 1);
  let cluster = []; let clusterEnd = -Infinity;
  const assign = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => it.start >= end);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      it._lane = lane; laneEnds[lane] = endOf(it);
    }
    for (const it of cluster) it._laneCount = laneEnds.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) assign();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, endOf(it));
  }
  assign();
  return sorted;
}

function useBattlePlan(date) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const req = useRef(0);
  const timer = useRef(null);
  const load = useCallback(async (silent) => {
    const id = ++req.current;
    if (!silent) setState({ data: null, loading: true, error: null });
    try {
      const data = await getBattlePlan(date);
      if (data && data.timeZone) setAgentTz(data.timeZone);
      if (id === req.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (id === req.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [date]);
  useEffect(() => { load(false); }, [load]);
  useSocket(['plan_updated', 'appointment_updated'], () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(true), 350);
  });
  useResync(() => load(true));
  useEffect(() => () => clearTimeout(timer.current), []);
  return { ...state, reload: () => load(true) };
}

function Spine({ color, beat, glow = true }) {
  return (
    <>
      <div className={`bp-spine ${beat ? 'bp-beat-accent' : ''}`} style={{ background: color, boxShadow: glow ? `0 0 8px ${alpha(color, 50)}` : 'none' }} />
      <div className="bp-wash" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${color}, transparent 70%)` }} />
    </>
  );
}

export default function BattlePlanPage({ page, onSelectPage, active }) {
  const { user } = useAuth();
  const tz = useAgentTz();

  // ── clock + the reactive 7 PM flip ─────────────────────────────────────
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    const bump = () => setNowTick(Date.now());
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    return () => { clearInterval(id); window.removeEventListener('focus', bump); document.removeEventListener('visibilitychange', bump); };
  }, []);
  const todayK = useMemo(() => dateKey(new Date(nowTick)), [nowTick, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const [override, setOverride] = useState(null);
  const autoKey = useMemo(() => {
    const now = new Date(nowTick);
    return hourIn(now) >= 19 ? shiftKey(dateKey(now), 1) : dateKey(now);
  }, [nowTick, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedKey = override || autoKey;
  const isToday = selectedKey === todayK;
  const selDate = useMemo(() => keyToDate(selectedKey), [selectedKey]);
  const NOW = useMemo(() => minuteOfDay(new Date(nowTick)), [nowTick, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading, reload } = useBattlePlan(selectedKey);
  const todo = useTodoBoard();

  // ── schedule + calendar dots (month sheet) ─────────────────────────────
  const [schedule, setSchedule] = useState(null);
  const loadSchedule = useCallback(() => { getWorkSchedule().then((r) => setSchedule(r.schedule)).catch(() => {}); }, []);
  useEffect(() => { loadSchedule(); }, [loadSchedule]);
  const [dots, setDots] = useState(() => new Map());
  const loadDots = useCallback(async () => {
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 13, 1);
      const r = await getAppointments({ from: from.toISOString(), to: to.toISOString(), limit: 1000 });
      const m = new Map();
      for (const a of r.appointments || []) {
        if (a.status === 'cancelled') continue;
        const k = dateKey(new Date(a.startAt));
        const list = m.get(k) || [];
        const col = apptColor(a.type);
        if (!list.includes(col)) list.push(col);
        m.set(k, list);
      }
      setDots(m);
    } catch { /* dots are decoration — keep the previous set */ }
  }, []);
  useEffect(() => { loadDots(); }, [loadDots]);
  const dotTimer = useRef(null);
  useSocket(['appointment_updated', 'plan_updated'], (p) => {
    clearTimeout(dotTimer.current);
    dotTimer.current = setTimeout(() => { loadDots(); if (p && p.reason === 'work_schedule') loadSchedule(); }, 600);
  });
  const marks = useCallback((key) => {
    const w = resolveWindow(schedule, key);
    if (!w) return null;
    return w.off ? { off: true } : { off: false, hours: compactHours(w) };
  }, [schedule]);

  // ── items → rail tiles / missed / past groups ──────────────────────────
  const { tiles, missed, pastRoutine, pastOther } = useMemo(() => {
    const out = { tiles: [], missed: [], pastRoutine: [], pastOther: [] };
    for (const it of (data && data.items) || []) {
      if (it.startMin == null) continue;
      if (it.kind === 'appt' && it.status === 'cancelled') continue;
      const e = { ...it, start: it.startMin, dur: Math.max(5, it.durationMin || 30) };
      const isPast = isToday && NOW - (e.start + e.dur) > PAST_GRACE;
      if (!isPast) { out.tiles.push(e); continue; }
      if (e.kind === 'appt') {
        if (['completed', 'no_show'].includes(e.status)) out.pastOther.push(e);
        else out.missed.push(e);
      } else if (e.kind === 'personal') out.pastRoutine.push(e);
      else out.pastOther.push(e);
    }
    return out;
  }, [data, isToday, NOW]);
  const rolled = useMemo(() => (todo.tasks || []).filter((t) => t.rolledOver), [todo.tasks]);
  const todoCount = useMemo(() => {
    const people = new Set();
    let loose = 0;
    for (const s of [...(todo.suggested || []), ...(todo.moves || [])]) { if (s.clientId) people.add(s.clientId); else loose += 1; }
    return (todo.tasks || []).length + people.size + loose;
  }, [todo.tasks, todo.suggested, todo.moves]);
  const todoHot = useMemo(() => (todo.tasks || []).some((t) => t.rolledOver || t.overdue || t.priority >= 1), [todo.tasks]);

  // ── routine collapse (persisted) ───────────────────────────────────────
  const [routineCollapsed, setRoutineCollapsed] = useState(() => { try { return localStorage.getItem('km_routineCollapsed') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('km_routineCollapsed', routineCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [routineCollapsed]);
  const [rolledOpen, setRolledOpen] = useState(false);

  // ── sheets ─────────────────────────────────────────────────────────────
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const openTile = useCallback((e) => {
    if (e.kind === 'appt' && e.appointmentId) { nav.openAppointment(e.appointmentId); return; }
    setDetail(e);
  }, []);

  // ── quote burn (pull-distance driven) ──────────────────────────────────
  const [quoteProgress, setQuoteProgress] = useState(0);
  const quoteRef = useRef(0);
  const setQ = useCallback((v) => { const np = Math.max(0, Math.min(1, v)); quoteRef.current = np; setQuoteProgress(np); }, []);
  const toggleQuote = useCallback(() => setQ(quoteRef.current > 0.5 ? 0 : 1), [setQ]);

  // ── scroll / NOW machinery ─────────────────────────────────────────────
  const scrollRef = useRef(null);
  const nowRef = useRef(null);
  const lineHostRef = useRef(null);
  const chromeRef = useRef(null);
  const railRef = useRef(null);
  const programmaticUntil = useRef(0);
  const userScrolledRef = useRef(false);
  const [lineVisible, setLineVisible] = useState(true);
  const [centered, setCentered] = useState(false);
  const [px, setPx] = useState(readZoom);
  const pxRef = useRef(px);
  const zoomScrollRef = useRef(null);
  const TOTAL_H = (DAY_END - DAY_START) * px;

  const [chromeH, setChromeH] = useState(150);
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) return undefined;
    const measure = () => setChromeH(el.offsetHeight || 150);
    measure();
    let ro; try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* noop */ }
    window.addEventListener('resize', measure);
    return () => { try { ro && ro.disconnect(); } catch { /* noop */ } window.removeEventListener('resize', measure); };
  }, []);
  const [viewH, setViewH] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setViewH(el.clientHeight || 0);
    measure();
    let ro; try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* noop */ }
    window.addEventListener('resize', measure);
    return () => { try { ro && ro.disconnect(); } catch { /* noop */ } window.removeEventListener('resize', measure); };
  }, []);

  // Empty runway BELOW 10 PM so the follow can carry NOW to the last tick.
  const nowRunway = useMemo(() => {
    if (!isToday || !viewH) return 0;
    const clamped = Math.min(Math.max(NOW, DAY_START), DAY_END);
    const railBelowNow = (DAY_END - clamped) * px;
    return Math.max(0, Math.round(viewH - (chromeH + LINE_GAP) - railBelowNow - BASE_PAD));
  }, [isToday, viewH, chromeH, NOW, px]);

  const alignNow = useCallback((smooth) => {
    const wrap = scrollRef.current; const el = nowRef.current; const line = lineHostRef.current;
    if (!el || !wrap || !line) return false;
    const delta = el.getBoundingClientRect().top - line.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) {
      const target = Math.max(0, wrap.scrollTop + delta);
      programmaticUntil.current = Date.now() + (smooth ? 800 : 500);
      try { if (smooth) wrap.scrollTo({ top: target, behavior: 'smooth' }); else wrap.scrollTop = target; } catch { wrap.scrollTop = target; }
    }
    return true;
  }, []);
  const snapToNow = useCallback((smooth = true) => {
    userScrolledRef.current = false;
    if (alignNow(smooth)) setTimeout(() => setLineVisible(true), smooth ? 450 : 60);
    else setLineVisible(true);
  }, [alignNow]);
  const onScroll = useCallback(() => {
    if (Date.now() < programmaticUntil.current) return;
    setLineVisible(false);
    userScrolledRef.current = true;
  }, []);

  // Open already centered on NOW (pre-paint, not gated on data).
  useLayoutEffect(() => {
    if (isToday && !userScrolledRef.current) snapToNow(false);
    setCentered(true);
  }, [loading, isToday, chromeH, snapToNow]);
  // Keep following the clock unless the agent took the wheel.
  useEffect(() => {
    if (!isToday || userScrolledRef.current) return;
    alignNow(false);
  }, [NOW, nowRunway, isToday, alignNow]);
  // Warm resume re-centers only if they hadn't scrolled away.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (!isToday || userScrolledRef.current) return;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!userScrolledRef.current) snapToNow(false); }));
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => { window.removeEventListener('focus', onResume); document.removeEventListener('visibilitychange', onResume); };
  }, [isToday, snapToNow]);
  // Returning to the Plan page re-centers too (if following).
  useEffect(() => { if (active && isToday && !userScrolledRef.current) requestAnimationFrame(() => snapToNow(false)); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another day: land on its working hours (or first tile).
  useLayoutEffect(() => {
    if (isToday) return;
    const wrap = scrollRef.current;
    if (!wrap || loading) return;
    const first = tiles.length ? Math.min(...tiles.map((t) => t.start)) : null;
    const anchor = Math.max(DAY_START, Math.min(first ?? Infinity, (data && data.window && data.window.startMin) ?? 9 * 60) - 30);
    programmaticUntil.current = Date.now() + 400;
    const railTop = railRef.current ? railRef.current.offsetTop : 0;
    wrap.scrollTop = Math.max(0, railTop + (anchor - DAY_START) * px - chromeH - 8);
    userScrolledRef.current = false;
  }, [selectedKey, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quote pull (touch at top) + trackpad mirror + ctrl/⌘-wheel zoom.
  useEffect(() => {
    const wrap = scrollRef.current; if (!wrap) return undefined;
    const SENS = 170;
    let touchY = 0;
    const onTS = (e) => { touchY = e.touches[0].clientY; };
    const onTM = (e) => {
      if (e.touches.length > 1) return;
      const y = e.touches[0].clientY;
      const dy = touchY - y;
      const prog = quoteRef.current;
      const atTop = wrap.scrollTop <= 0;
      if (atTop && dy < 0 && prog > 0) { e.preventDefault(); touchY = y; setQ(prog + dy / SENS); return; }
      if (atTop && dy > 0 && prog < 1) { e.preventDefault(); touchY = y; setQ(prog + dy / SENS); wrap.scrollTop = 0; return; }
      touchY = y;
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rail = railRef.current;
        const minute = rail ? (e.clientY - rail.getBoundingClientRect().top) / pxRef.current : null;
        const next = Math.min(PX_MAX, Math.max(PX_MIN, pxRef.current * Math.exp(-e.deltaY * 0.01)));
        zoomScrollRef.current = { minute, focalY: e.clientY };
        if (Math.abs(next - pxRef.current) >= 0.01) {
          pxRef.current = next; setPx(next);
          try { localStorage.setItem(ZOOM_KEY, String(Math.round(next * 100) / 100)); } catch { /* ignore */ }
        }
        return;
      }
      const prog = quoteRef.current;
      const atTop = wrap.scrollTop <= 0;
      if (e.deltaY > 0 && prog < 1 && atTop) { e.preventDefault(); setQ(prog + e.deltaY / SENS); } else if (e.deltaY < 0 && prog > 0 && atTop) { e.preventDefault(); setQ(prog + e.deltaY / SENS); }
    };
    wrap.addEventListener('touchstart', onTS, { passive: true });
    wrap.addEventListener('touchmove', onTM, { passive: false });
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => { wrap.removeEventListener('touchstart', onTS); wrap.removeEventListener('touchmove', onTM); wrap.removeEventListener('wheel', onWheel); };
  }, [setQ]);

  // Two-finger pinch on the rail changes px-per-minute (persisted).
  useEffect(() => {
    const wrap = scrollRef.current; if (!wrap) return undefined;
    let raf = 0; let pin = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midY = (t) => (t[0].clientY + t[1].clientY) / 2;
    const minuteAt = (clientY, atPx) => { const rail = railRef.current; return rail ? (clientY - rail.getBoundingClientRect().top) / atPx : null; };
    const freeze = (on) => { wrap.style.overflowY = on ? 'hidden' : 'auto'; };
    const onStart = (e) => {
      if (e.touches.length !== 2) return;
      const d = dist(e.touches); if (d < 10) return;
      pin = { dist: d, px: pxRef.current, minute: minuteAt(midY(e.touches), pxRef.current) };
      freeze(true);
    };
    const onMove = (e) => {
      if (!pin || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const next = Math.min(PX_MAX, Math.max(PX_MIN, pin.px * (dist(e.touches) / pin.dist)));
      zoomScrollRef.current = { minute: pin.minute, focalY: midY(e.touches) };
      if (Math.abs(next - pxRef.current) < 0.01) return;
      pxRef.current = next;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setPx(pxRef.current); });
    };
    const onEnd = (e) => {
      if (!pin || e.touches.length >= 2) return;
      pin = null; freeze(false);
      try { localStorage.setItem(ZOOM_KEY, String(Math.round(pxRef.current * 100) / 100)); } catch { /* ignore */ }
    };
    wrap.addEventListener('touchstart', onStart, { passive: true });
    wrap.addEventListener('touchmove', onMove, { passive: false });
    wrap.addEventListener('touchend', onEnd, { passive: true });
    wrap.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      wrap.removeEventListener('touchstart', onStart); wrap.removeEventListener('touchmove', onMove);
      wrap.removeEventListener('touchend', onEnd); wrap.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  useLayoutEffect(() => {
    const wrap = scrollRef.current; const rail = railRef.current; const z = zoomScrollRef.current;
    if (!wrap || !rail || !z) return;
    zoomScrollRef.current = null;
    programmaticUntil.current = Date.now() + 250;
    if (isToday && !userScrolledRef.current) { alignNow(false); return; }
    if (z.minute == null) return;
    wrap.scrollTop = Math.max(0, wrap.scrollTop + (rail.getBoundingClientRect().top + z.minute * px) - z.focalY);
  }, [px, isToday, alignNow]);

  // ── actions ────────────────────────────────────────────────────────────
  const shiftDay = (delta) => setOverride(shiftKey(selectedKey, delta));
  const goToday = () => setOverride(todayK);
  const newEvent = () => {
    // Next half hour today (agent's zone), else 10 AM on the viewed day.
    const startMin = isToday ? Math.min(23 * 60 + 30, Math.ceil((minuteOfDay(new Date()) + 1) / 30) * 30) : 600;
    nav.newAppointment({ startAt: zonedDate(selectedKey, startMin).toISOString() });
  };
  const completeBlock = async (item) => {
    try { await planItemAction(item.moveId || item.id, 'done'); reload(); } catch { toast.error('Couldn’t mark that done.'); throw new Error('failed'); }
  };
  const retimeBlock = async (item, startMin, durationMin) => {
    try { await planItemAction(item.moveId || item.id, 'retime', { startMin, durationMin }); toast.success(`Moved to ${fmtMin(startMin)}`); reload(); } catch { toast.error('Couldn’t move that block.'); }
  };
  const workToday = async () => {
    const wk = schedule && schedule.weekly && schedule.weekly[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][selDate.getDay()]];
    try {
      await setScheduleOverride(selectedKey, { start: (wk && wk.start) || '09:00', end: (wk && wk.end) || '18:00', off: false, bonus: true });
      toast.success('Working today — your plan is back on.');
      loadSchedule();
    } catch { toast.error('Couldn’t update your schedule.'); }
  };

  const hasPastRoutine = pastRoutine.length > 0;
  const window_ = data && data.window;
  const nowY = (NOW - DAY_START) * px;
  const titleDay = isToday ? 'Today' : selDate.toLocaleDateString('en-US', { weekday: 'long' });
  const isTomorrow = selectedKey === shiftKey(todayK, 1);

  return (
    <div className="bp-root">
      <QuoteHero progress={quoteProgress} onTap={toggleQuote} affirmation={user && user.preferences && user.preferences.affirmation} />

      <div className="bp-planner" style={{ opacity: centered ? 1 : 0 }}>
        <div
          ref={scrollRef}
          className="bp-scroller"
          onScroll={onScroll}
          style={{ paddingTop: chromeH, paddingBottom: `calc(${BASE_PAD}px + var(--safe-bottom))` }}
        >
          {/* header */}
          <div style={{ padding: '12px 20px 10px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--blue)' }}>{dateLine(selDate)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, letterSpacing: -0.8, lineHeight: 1.1, color: 'var(--bp-t1)' }}>{titleDay}</div>
              {isTomorrow && !override ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, color: 'var(--bp-now)' }}>AFTER 7 PM · TOMORROW’S PLAN</span> : null}
            </div>
            {data && data.isPlanDay && data.summary && !data.offDay ? (
              <button type="button" onClick={() => setTodoOpen(true)} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 8, textAlign: 'left' }}>
                <Icon name="sparkle" size={13} color="var(--violet)" stroke={2} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--bp-t2)' }}>{data.summary}</span>
              </button>
            ) : null}
            {data && data.isPlanDay && !data.offDay && (data.warnings || []).length ? (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.warnings.slice(0, 3).map((w) => (
                  <div key={w} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, lineHeight: 1.35, color: 'var(--bp-t3)' }}>
                    <Icon name="alert" size={12} color="var(--bp-amber)" stroke={2.2} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* 01 BATTLE PLAN ─── n ON THE RAIL [Routine ▾|✎] */}
          <div className="bp-sechead" style={{ padding: '2px 20px 10px' }}>
            <span className="bp-sechead-num">01</span>
            <span className="bp-sechead-label">Battle Plan</span>
            <span className="bp-sechead-line" />
            <span className="bp-sechead-trail">{tiles.length + missed.length} on the rail</span>
            <span className="bp-routine-pill">
              <button
                type="button"
                onClick={hasPastRoutine ? () => setRoutineCollapsed((c) => !c) : undefined}
                disabled={!hasPastRoutine}
                aria-expanded={!routineCollapsed}
                style={{ opacity: hasPastRoutine ? 1 : 0.45 }}
              >
                Routine
                <Icon name="chevronDown" size={10} stroke={2.6} style={{ transform: routineCollapsed ? 'none' : 'rotate(180deg)', transition: 'transform 200ms' }} />
              </button>
              <button type="button" onClick={() => nav.openWorkSchedule()} aria-label="Edit your routine and work schedule">
                <Icon name="edit" size={11} stroke={2} />
              </button>
            </span>
          </div>

          {/* off day */}
          {data && data.offDay ? (
            <div style={{ padding: '0 14px 12px' }}>
              <div className="bp-tile" style={{ padding: '12px 14px 12px 17px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Spine color="var(--bp-t3)" glow={false} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>You’re off {isToday ? 'today' : 'this day'}</div>
                  <div style={{ fontSize: 12, color: 'var(--bp-t2)', marginTop: 2 }}>Outreach is paused. Your content block stays in case you come in.</div>
                </div>
                <button type="button" className="td-btn" onClick={workToday} style={{ background: 'var(--blue)', color: '#04121F', fontWeight: 700 }}>I’m working</button>
              </div>
            </div>
          ) : null}

          {/* MISSED */}
          {isToday && missed.length ? (
            <div style={{ padding: '0 14px 12px' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.4, color: 'var(--bp-amber)', marginBottom: 7 }}>MISSED · {missed.length}</div>
              {missed.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="km-press"
                  onClick={() => openTile(e)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 11px', marginBottom: 6, borderRadius: 10, background: 'rgba(255,159,10,0.10)', border: '1px solid rgba(255,159,10,0.28)' }}
                >
                  <Icon name="alert" size={15} color="var(--bp-amber)" stroke={2.2} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="km-truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--bp-t1)' }}>
                      {e.whale ? <Icon name="crown" size={11} color="var(--amber)" style={{ marginRight: 4, verticalAlign: '-1px' }} /> : null}{e.title}
                    </div>
                    <div className="bp-num" style={{ fontSize: 10, color: 'rgba(255,159,10,0.9)', marginTop: 1 }}>{fmtMin(e.start)} · tap to reschedule or complete</div>
                  </div>
                  <Icon name="chevronRight" size={13} color="var(--bp-amber)" />
                </button>
              ))}
            </div>
          ) : null}

          {/* ROLLED OVER — undone to-dos carried forward (14-day lookback) */}
          {isToday && rolled.length ? (
            <div style={{ padding: '0 14px 12px' }}>
              <button
                type="button"
                className="km-press"
                onClick={() => setRolledOpen((o) => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 11px', borderRadius: 10, background: 'rgba(255,159,10,0.10)', border: '1px solid rgba(255,159,10,0.28)' }}
              >
                <Icon name="arrowDown" size={15} color="var(--bp-amber)" stroke={2.2} />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.4, color: 'var(--bp-amber)' }}>ROLLED OVER · {rolled.length}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--bp-t2)', marginTop: 1 }}>Unfinished to-dos carried into today — tap to {rolledOpen ? 'hide' : 'review'}</div>
                </div>
                <Icon name="chevronDown" size={12} color="var(--bp-t3)" stroke={2.4} style={{ transform: rolledOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
              </button>
              {rolledOpen ? rolled.map((t) => (
                <div key={t.id} className="bp-tile km-row-in" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px 9px 14px', marginTop: 6 }}>
                  <button type="button" className="td-circle" onClick={() => todo.complete(t)} aria-label="Mark done" style={{ width: 20, height: 20, border: '1.5px solid var(--bp-amber)' }} />
                  <button type="button" onClick={() => setTodoOpen(true)} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div className="km-truncate" style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                    <div className="bp-num" style={{ fontSize: 10, color: 'var(--bp-t3)', marginTop: 1 }}>Rolled over · from {keyToDate(t.dueKey).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  </button>
                </div>
              )) : null}
            </div>
          ) : null}

          {/* PAST / elapsed */}
          {(pastOther.length > 0 || (hasPastRoutine && !routineCollapsed)) ? (
            <div style={{ padding: '0 14px 12px' }}>
              {[...pastOther, ...(routineCollapsed ? [] : pastRoutine)].sort((a, b) => a.start - b.start).map((e) => (
                <button key={e.id} type="button" onClick={() => openTile(e)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '6px 0', opacity: 0.45, borderBottom: '1px dashed var(--bp-hair)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: itemColor(e), flexShrink: 0 }} />
                  <span className="bp-num" style={{ fontSize: 10, color: 'var(--bp-t3)', width: 56, flexShrink: 0 }}>{fmtMin(e.start)}</span>
                  <span className="km-truncate" style={{ fontSize: 12, color: 'var(--bp-t2)', flex: 1 }}>{e.title}</span>
                  {e.status === 'completed' || e.status === 'done' ? <Icon name="check" size={12} color="var(--bp-done)" stroke={2.6} /> : null}
                </button>
              ))}
            </div>
          ) : null}
          {hasPastRoutine && routineCollapsed ? (
            <div style={{ padding: '0 14px 12px' }}>
              <button type="button" onClick={() => setRoutineCollapsed(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 0', borderBottom: '1px dashed var(--bp-hair)', textAlign: 'left' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: KIND_COLOR.personal }} />
                <span style={{ fontSize: 10, color: 'var(--bp-t3)', flex: 1 }}>{pastRoutine.length} earlier routine {pastRoutine.length === 1 ? 'block' : 'blocks'} · tap to show</span>
                <Icon name="chevronDown" size={11} color="var(--bp-t3)" stroke={2.4} />
              </button>
            </div>
          ) : null}

          {/* the rail */}
          <div style={{ padding: '0 14px 4px 4px' }}>
            <div ref={railRef} style={{ position: 'relative', height: TOTAL_H }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 50, width: 1, background: 'var(--bp-hair)' }} />
              {window_ && window_.startMin != null ? (() => {
                const top = Math.max(0, (window_.startMin - DAY_START) * px);
                const h = Math.max(0, (Math.min(window_.endMin, DAY_END) - Math.max(window_.startMin, DAY_START)) * px);
                const cap = { position: 'absolute', left: 36, width: 8, height: 2, background: 'var(--blue)', borderRadius: 1, pointerEvents: 'none' };
                return (
                  <>
                    <div aria-label="Working hours" style={{ position: 'absolute', left: 36, top, height: h, width: 2, background: 'var(--blue)', borderRadius: 1, pointerEvents: 'none', boxShadow: '0 0 6px var(--glow)' }} />
                    <div style={{ ...cap, top }} />
                    <div style={{ ...cap, top: top + h - 2 }} />
                  </>
                );
              })() : null}
              {(() => {
                const ticks = [];
                for (let h = DAY_START; h <= DAY_END; h += 60) {
                  const y = (h - DAY_START) * px;
                  const hh = Math.floor(h / 60); const a = hh >= 12 ? 'PM' : 'AM'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
                  const inWork = window_ && h >= window_.startMin && h <= window_.endMin;
                  ticks.push(
                    <Fragment key={h}>
                      <div style={{ position: 'absolute', top: y - 8, left: 0, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, paddingRight: 2 }}>
                        <span className="bp-num" style={{ fontSize: 10, fontWeight: 600, color: inWork ? 'var(--bp-t1)' : 'var(--bp-t2)' }}>{h12}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--bp-t3)' }}>{a}</span>
                      </div>
                      <div style={{ position: 'absolute', top: y, left: 50, right: 0, height: 1, background: 'var(--bp-hour)' }} />
                      {h + 30 <= DAY_END && px >= 2 ? <div style={{ position: 'absolute', top: y + 30 * px, left: 50, right: 0, height: 1, background: 'var(--bp-half)' }} /> : null}
                    </Fragment>,
                  );
                }
                return ticks;
              })()}

              {isToday ? <div ref={nowRef} style={{ position: 'absolute', top: nowY, left: 0, right: 0, height: 0 }} /> : null}

              {layoutLanes(tiles).map((e) => {
                const y = (e.start - DAY_START) * px;
                const c = itemColor(e);
                const laneCount = e._laneCount || 1;
                const laneStyle = laneCount > 1
                  ? { left: `calc(64px + (100% - 64px) * ${e._lane || 0} / ${laneCount})`, width: `calc((100% - 64px) / ${laneCount} - 4px)` }
                  : { left: 64, right: 0 };
                const h = Math.max(px >= 3 ? 20 : 16, e.dur * px);
                const tight = h < 30;
                // Side-by-side lanes are narrow: the title keeps the first
                // line and the time drops to its own line (when it fits).
                const narrow = laneCount > 1;
                const timeRow = narrow && h >= 36;
                const showSub = !!e.sub && h >= (timeRow ? 60 : 46);
                const beat = e.kind === 'appt' && !['completed', 'no_show'].includes(e.status);
                const done = e.status === 'completed' || e.status === 'done';
                return (
                  <Fragment key={e.id}>
                    <div style={{ position: 'absolute', top: y - 4, left: 46, width: 8, height: 8, borderRadius: 4, background: c, boxShadow: `0 0 8px ${alpha(c, 50)}`, zIndex: 1 }} />
                    <div
                      data-bp-item={e.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTile(e)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') openTile(e); }}
                      className={`bp-tile bp-rail-tile ${beat ? 'bp-beat' : ''} ${done ? 'bp-rail-tile--done' : ''}`}
                      style={{ top: y, ...laneStyle, height: h, justifyContent: tight ? 'center' : 'flex-start', padding: tight ? '0 12px 0 17px' : '6px 12px 6px 17px', '--beat': c }}
                    >
                      <Spine color={c} beat={beat} />
                      {/* Sticky head: a block that's already running keeps its
                          title readable just under the NOW line instead of
                          hiding it behind the chrome. */}
                      <div className="bp-tile-head" style={{ top: LINE_GAP + 10 /* sticky insets from the scroller's padding (= chrome) */ }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          {beat ? <span className="bp-beat-dot" style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block' }} /> : null}
                          {done ? <Icon name="check" size={12} color="var(--bp-done)" stroke={2.6} /> : null}
                          <span className="km-truncate" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--bp-t1)' }}>
                            {e.whale ? <Icon name="crown" size={11} color="var(--amber)" style={{ marginRight: 4, verticalAlign: '-1px' }} /> : null}{e.title}
                          </span>
                          {!narrow ? (
                            <span className="bp-num" style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: c, whiteSpace: 'nowrap' }}>
                              {fmtMin(e.start)} · {durLabel(e.dur)}
                            </span>
                          ) : null}
                        </div>
                        {timeRow ? (
                          <div className="bp-num km-truncate" style={{ fontSize: 10, fontWeight: 600, color: c, marginTop: 1 }}>{fmtMin(e.start)} · {durLabel(e.dur)}</div>
                        ) : null}
                        {showSub ? <div className="km-truncate" style={{ fontSize: 11, color: 'var(--bp-t2)', marginTop: 2 }}>{e.sub}</div> : null}
                      </div>
                    </div>
                  </Fragment>
                );
              })}

              {!loading && tiles.length === 0 && missed.length === 0 && pastOther.length === 0 && pastRoutine.length === 0 ? (
                <div style={{
                  position: 'absolute', left: 50, right: 0, textAlign: 'center', color: 'var(--bp-t3)',
                  top: isToday ? Math.min(TOTAL_H - 40, Math.max(0, nowY) + 56) : Math.max(0, (((window_ && window_.startMin) || 9 * 60) - DAY_START) * px + 40),
                  fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
                }}
                >Nothing on the rail. Quiet day.</div>
              ) : null}
            </div>
          </div>
          {nowRunway > 0 ? <div aria-hidden style={{ height: nowRunway }} /> : null}
        </div>

        {/* fixed chrome */}
        <div ref={chromeRef} className="bp-chrome">
          <div style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' }}>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
                <button type="button" className="bp-quick bp-quick--event" onClick={newEvent}><Icon name="plus" size={11} stroke={2.8} /> Event</button>
              </div>
              <PageDots page={page} onSelectPage={onSelectPage} />
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="bp-quick bp-quick--sched" onClick={() => nav.openWorkSchedule()}><Icon name="plus" size={11} stroke={2.8} /> <span className="bp-q-long">Work schedule</span><span className="bp-q-short">Schedule</span></button>
              </div>
            </div>
            <div style={{ margin: '10px 14px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="bp-daypicker" style={{ flex: 1, minWidth: 0 }}>
                  <button type="button" className="bp-arrow" onClick={() => shiftDay(-1)} aria-label="Previous day"><Icon name="chevronLeft" size={15} stroke={2.2} /></button>
                  <button type="button" onClick={() => setCalendarOpen(true)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '3px 4px' }} aria-label="Pick a day">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="calendar" size={12} color="var(--blue)" stroke={1.9} />
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'var(--blue)', textTransform: 'uppercase' }}>{titleDay}</span>
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: 'var(--bp-t2)', textTransform: 'uppercase' }}>{selDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </button>
                  <button type="button" className="bp-arrow" onClick={() => shiftDay(1)} aria-label="Next day"><Icon name="chevronRight" size={15} stroke={2.2} /></button>
                </div>
                <button type="button" className={`bp-todo-chip ${todoHot ? 'bp-todo-chip--hot' : ''}`} onClick={() => setTodoOpen(true)} aria-label={`To-do list, ${todoCount} items`}>
                  <Icon name="checklist" size={14} stroke={2.1} />
                  To-Do
                  <span className="bp-todo-count">{todoCount}</span>
                </button>
              </div>
              {!isToday ? (
                <button
                  type="button"
                  className="km-press"
                  onClick={goToday}
                  style={{ marginTop: 6, width: '100%', padding: '6px 0', borderRadius: 10, background: 'linear-gradient(135deg, var(--blue), var(--deep))', color: '#fff', fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', boxShadow: '0 6px 14px -8px var(--glow)' }}
                >↺ Back to today</button>
              ) : null}
            </div>
          </div>
        </div>

        {/* fixed gold NOW line */}
        {isToday ? (
          <div ref={lineHostRef} style={{ position: 'absolute', top: chromeH + LINE_GAP, left: 0, right: 0, height: 0, zIndex: 30, pointerEvents: 'none' }}>
            <div style={{ opacity: lineVisible ? 1 : 0, transition: 'opacity 360ms ease' }}>
              <div style={{ position: 'absolute', left: 60, right: 64, top: -1, height: 2, borderRadius: 1, background: 'linear-gradient(90deg, var(--bp-now), rgba(212,169,74,0))', boxShadow: '0 0 14px rgba(212,169,74,0.6)' }} />
              <div className="bp-now-pill">{fmtMin(NOW)}</div>
            </div>
            <button type="button" className="bp-now-btn" onClick={() => snapToNow(true)} aria-label="Scroll to now">
              <Icon name="undo" size={11} stroke={2.5} /> Now
            </button>
          </div>
        ) : null}
      </div>

      <MonthCalendarSheet
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        selectedKey={selectedKey}
        onSelect={(k) => { setOverride(k); setCalendarOpen(false); }}
        dots={dots}
        marks={marks}
      />

      <Sheet open={todoOpen} onClose={() => setTodoOpen(false)} title="To-Do" subtitle={todoCount ? `${todoCount} open · today + tomorrow` : 'Today + tomorrow'} left={false} right={{ label: 'Done', onClick: () => setTodoOpen(false) }} padded={false} maxHeight="88%">
        {({ close }) => <TodoPanel onNavigate={close} style={{ paddingBottom: 20 }} />}
      </Sheet>

      <TileDetailSheet
        open={!!detail}
        item={detail}
        onClose={() => setDetail(null)}
        onComplete={detail && detail.planner ? completeBlock : null}
        onRetime={detail && detail.planner ? retimeBlock : null}
        others={tiles}
        onCall={(it) => nav.call({ clientId: it.clientId, phone: it.phone, name: it.clientName })}
        onText={(it) => nav.openThread({ clientId: it.clientId })}
        onOpenClient={(id) => nav.openClient(id)}
      />
    </div>
  );
}

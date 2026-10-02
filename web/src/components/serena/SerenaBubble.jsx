// SerenaBubble — the 44px liquid-glass orb that floats over every screen
// (RevMatch SerenaBubble). Drag it anywhere (it rests where dropped, clamped
// inside the safe area and above the tab bar; position persists as a fraction
// of the screen); a flick glides with momentum. Tap → Serena chat. A violet
// count badge lights when a reply landed while the popup was closed; the halo
// spins while a detached turn is still working. Steps aside while a sheet,
// Serena's popup or the full-screen call is up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nav, useNav } from '../../lib/nav';
import SerenaAvatar from './SerenaAvatar';
import { serena, useSerena } from './serenaStore';
import { useCallState } from '../calls/callStore';
import '../../styles/serena.css';
import { useAssistant } from '../../hooks/useAssistant';

const SIZE = 44;
const EDGE = 8;
const TABBAR_ZONE = 76;      // floating tab bar (≈64) + its 4px lift + air
const DEFAULT_LIFT = 118;    // first-run rest: lower-right, clear of FABs
const POS_KEY = 'km_serena_pos';
const TAP_DIST = 10;
const TAP_MS = 350;
const FLICK_SPEED = 600;     // px/s
const PROJECT_MS = 200;

let insetsCache = null;
function safeInsets() {
  if (insetsCache) return insetsCache;
  try {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    insetsCache = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    document.body.removeChild(p);
  } catch { insetsCache = { top: 0, right: 0, bottom: 0, left: 0 }; }
  return insetsCache;
}

function area() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const i = safeInsets();
  const minX = i.left + EDGE;
  const minY = i.top + EDGE + 44; // clear the header controls row
  const maxX = Math.max(minX, w - i.right - SIZE - EDGE);
  const maxY = Math.max(minY, h - i.bottom - SIZE - EDGE - TABBAR_ZONE);
  return { minX, minY, maxX, maxY };
}
const clamp = (x, y) => { const a = area(); return { x: Math.max(a.minX, Math.min(a.maxX, x)), y: Math.max(a.minY, Math.min(a.maxY, y)) }; };

function readPos() {
  const a = area();
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (v && typeof v.xf === 'number' && typeof v.yf === 'number') {
      return clamp(a.minX + v.xf * (a.maxX - a.minX), a.minY + v.yf * (a.maxY - a.minY));
    }
  } catch { /* ignore */ }
  return clamp(a.maxX, a.maxY - DEFAULT_LIFT);
}
function writePos(x, y) {
  const a = area();
  try { localStorage.setItem(POS_KEY, JSON.stringify({ xf: (x - a.minX) / Math.max(1, a.maxX - a.minX), yf: (y - a.minY) / Math.max(1, a.maxY - a.minY) })); } catch { /* ignore */ }
}

function prefersReduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export default function SerenaBubble() {
  const { name: assistant } = useAssistant();
  const s = useSerena();
  const { overlays } = useNav();
  const call = useCallState();
  const [pos, setPos] = useState(() => (typeof window === 'undefined' ? { x: 0, y: 0 } : readPos()));
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [pop, setPop] = useState(false);
  const start = useRef(null);
  const moved = useRef(false);
  const samples = useRef([]);
  const lastPulse = useRef(s.pulse);

  const popupOpen = overlays.some((o) => o.type === 'serena');
  const callScreen = overlays.some((o) => o.type === 'call') || call.screenOpen;

  // First paint: learn the unread count; keep it fresh on focus.
  useEffect(() => { serena.refreshUnread(); }, []);
  useEffect(() => { serena.setOpen(popupOpen); }, [popupOpen]);

  // A reply landed while closed → a little pop.
  useEffect(() => {
    if (s.pulse === lastPulse.current) return undefined;
    lastPulse.current = s.pulse;
    setPop(true);
    const t = setTimeout(() => setPop(false), 700);
    return () => clearTimeout(t);
  }, [s.pulse]);

  useEffect(() => {
    const onResize = () => { insetsCache = null; if (!start.current) setPos(readPos()); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && e.isPrimary === false) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const now = performance.now();
    start.current = { x: e.clientX, y: e.clientY, ox: e.clientX - pos.x, oy: e.clientY - pos.y, t: now };
    samples.current = [{ x: e.clientX, y: e.clientY, t: now }];
    moved.current = false;
    setPressed(true);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e) => {
    const st = start.current;
    if (!st) return;
    const now = performance.now();
    const dist = Math.hypot(e.clientX - st.x, e.clientY - st.y);
    if (!moved.current && dist > TAP_DIST) { moved.current = true; setDragging(true); }
    if (!moved.current) return;
    setPos(clamp(e.clientX - st.ox, e.clientY - st.oy));
    samples.current.push({ x: e.clientX, y: e.clientY, t: now });
    while (samples.current.length > 2 && samples.current[0].t < now - 100) samples.current.shift();
  }, []);

  const finish = useCallback((e) => {
    const st = start.current;
    start.current = null;
    setPressed(false);
    if (!st) return;
    if (!moved.current) {
      setDragging(false);
      if (performance.now() - st.t < TAP_MS * 3) nav.openSerena('chat');
      return;
    }
    const sm = samples.current;
    const a = sm[0];
    const b = sm[sm.length - 1] || { x: e.clientX, y: e.clientY, t: performance.now() };
    const dt = Math.max(1, b.t - a.t);
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy) * 1000;
    const rx = e.clientX - st.ox;
    const ry = e.clientY - st.oy;
    if (speed > FLICK_SPEED && !prefersReduced()) {
      const landed = clamp(rx + vx * PROJECT_MS, ry + vy * PROJECT_MS);
      setFlying(true);
      setPos(landed);
      setTimeout(() => { setFlying(false); setDragging(false); writePos(landed.x, landed.y); }, 420);
    } else {
      const landed = clamp(rx, ry);
      setPos(landed);
      setDragging(false);
      writePos(landed.x, landed.y);
    }
  }, []);

  if (popupOpen || callScreen) return null;

  const scale = pressed && !dragging ? 0.92 : pop ? 1.12 : 1;
  return createPortal(
    <div
      role="button"
      tabIndex={0}
      aria-label={s.unread ? `Open ${assistant} — ${s.unread} new` : `Open ${assistant}`}
      data-serena-bubble=""
      className={`km-srn-bubble ${dragging ? 'is-dragging' : ''} ${flying ? 'is-flying' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav.openSerena('chat'); } }}
      style={{ left: pos.x, top: pos.y, transform: `scale(${scale})` }}
    >
      <SerenaAvatar size={SIZE} thinking={s.typing} />
      {s.unread > 0 ? <span className="km-srn-badge">{s.unread > 9 ? '9+' : s.unread}</span> : null}
    </div>,
    document.body,
  );
}

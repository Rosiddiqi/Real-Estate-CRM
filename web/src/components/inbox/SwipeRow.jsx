// SwipeRow — drag a row sideways to reveal two actions per side (RevMatch
// inbox-v2 port on Pointer Events). Dead-zone 10px decides the axis (ties go
// to vertical, so scrolling the list never opens a row); release past 52px
// snaps open to 2 × 82px; a tap on an open row closes it. One row open at a
// time; the list closes it on scroll. Moves are applied straight to the DOM
// (CSS vars), so dragging never re-renders React.
//
//   <SwipeRow left={[{ id, label, icon, color, onClick }, …]} right={[…]}>
//     <ConversationRow … />
//   </SwipeRow>
import { useCallback, useEffect, useRef } from 'react';
import { haptic } from '../../lib/native';

const ACT_W = 82;
const THRESH = 52;
const DEAD = 10;
const LONG_PRESS_MS = 480;

let closeOpen = null;
export function closeOpenSwipeRow() {
  if (closeOpen) { const fn = closeOpen; closeOpen = null; fn(); }
}

export default function SwipeRow({ children, left = [], right = [], height = 82, onLongPress, className = '', selected = false }) {
  const rootRef = useRef(null);
  const g = useRef({ start: null, axis: null, moved: false, committed: 0, x: 0, crossed: false, lpTimer: null, longFired: false });
  const maxL = left.length * ACT_W;
  const maxR = right.length * ACT_W;

  const apply = useCallback((x, animate) => {
    const el = rootRef.current;
    if (!el) return;
    g.current.x = x;
    el.classList.toggle('km-swipe--anim', !!animate);
    el.style.setProperty('--dx', `${x}px`);
    el.style.setProperty('--dxl', String(Math.max(0, x)));
    el.style.setProperty('--dxr', String(Math.max(0, -x)));
  }, []);

  const close = useCallback(() => {
    g.current.committed = 0;
    apply(0, true);
    if (closeOpen === close) closeOpen = null; // eslint-disable-line no-use-before-define
  }, [apply]);

  useEffect(() => () => { if (closeOpen === close) closeOpen = null; clearTimeout(g.current.lpTimer); }, [close]);

  const snap = (x) => {
    const s = g.current;
    let to = 0;
    if (x > THRESH && maxL) to = maxL;
    else if (x < -THRESH && maxR) to = -maxR;
    s.committed = to;
    apply(to, true);
    if (to !== 0) {
      if (closeOpen && closeOpen !== close) closeOpen();
      closeOpen = close;
    } else if (closeOpen === close) closeOpen = null;
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = g.current;
    s.start = { x: e.clientX, y: e.clientY, id: e.pointerId, base: s.committed };
    s.axis = null;
    s.moved = false;
    s.crossed = Math.abs(s.committed) > THRESH;
    s.longFired = false;
    clearTimeout(s.lpTimer);
    if (onLongPress && e.pointerType !== 'mouse' && !s.committed) {
      s.lpTimer = setTimeout(() => {
        if (!s.start || s.axis) return;
        s.longFired = true;
        haptic('medium');
        onLongPress();
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e) => {
    const s = g.current;
    if (!s.start || e.pointerId !== s.start.id) return;
    const mx = e.clientX - s.start.x;
    const my = e.clientY - s.start.y;
    if (!s.axis) {
      if (Math.abs(mx) < DEAD && Math.abs(my) < DEAD) return;
      clearTimeout(s.lpTimer);
      s.axis = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
      if (s.axis === 'h') {
        if (closeOpen && closeOpen !== close) closeOpen();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    }
    if (s.axis !== 'h') return;
    s.moved = true;
    let x = s.start.base + mx;
    const hi = maxL ? maxL : 0;
    const lo = maxR ? -maxR : 0;
    // Rubber-band past the actions (and on a side with no actions).
    if (x > hi) x = hi + (x - hi) * 0.25;
    if (x < lo) x = lo + (x - lo) * 0.25;
    const past = Math.abs(x) > THRESH;
    if (past !== s.crossed) { s.crossed = past; if (past) haptic('selection'); }
    apply(x, false);
  };

  const end = (e) => {
    const s = g.current;
    clearTimeout(s.lpTimer);
    if (!s.start || (e && e.pointerId !== s.start.id)) return;
    const wasH = s.axis === 'h';
    s.start = null;
    if (wasH) snap(s.x);
  };

  // Swallow the click that ends a drag, or the tap that closes an open row.
  const onClickCapture = (e) => {
    const s = g.current;
    if (s.moved || s.longFired || s.committed !== 0) {
      e.preventDefault();
      e.stopPropagation();
      if (s.committed !== 0 && !s.moved) close();
      s.moved = false;
      s.longFired = false;
    }
  };

  const fire = (a) => (e) => {
    e.stopPropagation();
    close();
    a.onClick && a.onClick();
  };

  return (
    <div
      ref={rootRef}
      className={`km-swipe ${selected ? 'km-swipe--selected' : ''} ${className}`}
      style={{ height, '--dx': '0px', '--dxl': 0, '--dxr': 0, '--actw': ACT_W }}
    >
      {left.length ? (
        <div className="km-swipe-acts km-swipe-acts--left">
          {left.map((a, i) => (
            <button key={a.id} type="button" className="km-swipe-act" style={{ background: a.color, color: a.ink, '--i': i }} onClick={fire(a)} tabIndex={-1}>
              <span className="km-swipe-act-in" style={{ '--t': i === 0 ? 14 : ACT_W - 4 }}>
                {a.icon}
                <span>{a.label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {right.length ? (
        <div className="km-swipe-acts km-swipe-acts--right">
          {right.map((a, i) => (
            <button key={a.id} type="button" className="km-swipe-act" style={{ background: a.color, color: a.ink }} onClick={fire(a)} tabIndex={-1}>
              <span className="km-swipe-act-in km-swipe-act-in--r" style={{ '--t': i === right.length - 1 ? 14 : ACT_W - 4 }}>
                {a.icon}
                <span>{a.label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="km-swipe-fg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        // Lifting the finger after a long-press must never "tap" whatever just
        // opened under it (the actions sheet): kill the synthesized click.
        onTouchEnd={(e) => { if (g.current.longFired && e.cancelable) e.preventDefault(); }}
        onClickCapture={onClickCapture}
        onContextMenu={onLongPress ? (e) => {
          e.preventDefault();
          const s = g.current;
          clearTimeout(s.lpTimer);
          if (s.longFired || s.moved) return;
          s.longFired = true;
          onLongPress();
        } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

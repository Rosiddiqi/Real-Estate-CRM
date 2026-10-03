// Swipe-left-to-remove (iOS Reminders style). Touch listeners are attached
// manually with { passive:false } so the horizontal drag can preventDefault
// and the list doesn't scroll under the finger; a vertical drag is left alone.
// Past ~90px on release the card animates out and onRemove fires. Pointer
// (mouse) drags work the same way on desktop.
import { useEffect, useRef } from 'react';

export default function SwipeToRemove({ onRemove, children, label = 'REMOVE', radius = 13 }) {
  const cardRef = useRef(null);
  const st = useRef({ x: 0, y: 0, dir: null, dx: 0, active: false });
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const setX = (x, animate) => {
      card.style.transition = animate ? 'transform 180ms ease' : 'none';
      card.style.transform = x ? `translateX(${x}px)` : '';
    };
    const start = (cx, cy) => { st.current = { x: cx, y: cy, dir: null, dx: 0, active: true }; };
    const move = (cx, cy, e) => {
      const s = st.current;
      if (!s.active) return;
      const ddx = cx - s.x; const ddy = cy - s.y;
      if (s.dir === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) s.dir = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (s.dir === 'h') {
        if (e && e.cancelable) e.preventDefault();
        s.dx = Math.min(0, ddx);
        setX(s.dx, false);
      }
    };
    const end = () => {
      const s = st.current;
      if (!s.active) return;
      s.active = false;
      if (s.dir === 'h' && s.dx < -90) {
        setX(-(card.offsetWidth || 400), true);
        setTimeout(() => removeRef.current && removeRef.current(), 170);
      } else if (s.dir === 'h') setX(0, true);
      // swallow the click that follows a horizontal drag
      if (s.dir === 'h') {
        const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        card.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => card.removeEventListener('click', stop, { capture: true }), 50);
      }
      s.dir = null;
    };
    const ts = (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); };
    const tm = (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); };
    const pd = (e) => { if (e.pointerType === 'mouse' && e.button === 0) start(e.clientX, e.clientY); };
    const pm = (e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY, null); };
    const pu = (e) => { if (e.pointerType === 'mouse') end(); };
    card.addEventListener('touchstart', ts, { passive: true });
    card.addEventListener('touchmove', tm, { passive: false });
    card.addEventListener('touchend', end, { passive: true });
    card.addEventListener('touchcancel', end, { passive: true });
    card.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      card.removeEventListener('touchstart', ts);
      card.removeEventListener('touchmove', tm);
      card.removeEventListener('touchend', end);
      card.removeEventListener('touchcancel', end);
      card.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
    };
  }, []);

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: radius }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255, 107, 94, 0.16)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16, pointerEvents: 'none' }}>
        <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 1.2, color: '#FF453A' }}>{label}</span>
      </div>
      <div ref={cardRef} style={{ position: 'relative', willChange: 'transform', touchAction: 'pan-y' }}>
        {children}
      </div>
    </div>
  );
}

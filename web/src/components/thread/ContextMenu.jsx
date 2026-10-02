// Anchored long-press menu (RevMatch "msgctx"): a pixel clone of the held
// bubble renders at its exact screen rect over a blurred backdrop, the tapback
// bar springs out above it and the action card unfolds below, both hugging the
// bubble's side. If the cluster would leave the screen, the whole layer glides
// into view two frames later and glides home on dismiss.
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ anchor, dismissing, heldNodeRef, layerRef, onBackdrop, tapbacks, menu }) {
  const cloneRef = useRef(null);
  const tapRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    const node = heldNodeRef.current;
    if (node) node.style.visibility = 'hidden';
    const layer = layerRef.current;
    const clone = cloneRef.current;
    if (layer && clone) {
      const vh = window.innerHeight;
      let sat = 0;
      try { sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--km-sat')) || 0; } catch { /* ignore */ }
      const safeTop = Math.max(sat + 8, 24);
      const safeBottom = 28;
      const gap = 12;
      const tapH = tapRef.current ? tapRef.current.offsetHeight + gap : 0;
      const menuH = menuRef.current ? menuRef.current.offsetHeight + gap : 0;
      const maxCloneH = Math.max(120, vh - safeTop - safeBottom - tapH - menuH);
      let cloneH = clone.offsetHeight;
      if (cloneH > maxCloneH) {
        clone.style.maxHeight = `${maxCloneH}px`;
        clone.classList.add('km-ctx-clone--scroll');
        cloneH = maxCloneH;
      }
      const top = anchor.rect.top;
      let shift = 0;
      const overBottom = (top + cloneH + menuH) - (vh - safeBottom);
      if (overBottom > 0) shift = -overBottom;
      if (top - tapH + shift < safeTop) shift = safeTop - (top - tapH);
      if (shift !== 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (layerRef.current) layerRef.current.style.transform = `translate3d(0, ${Math.round(shift)}px, 0)`;
        }));
      }
    }
    return () => {
      if (node) node.style.visibility = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`km-ctx-root ${dismissing ? 'km-ctx-root--out' : ''}`}>
      <div className="km-ctx-backdrop" onClick={onBackdrop} onContextMenu={(e) => { e.preventDefault(); onBackdrop(e); }} />
      <div className="km-ctx-layer" ref={layerRef}>
        <div
          className={`km-ctx-anchor km-ctx-anchor--${anchor.side}`}
          style={{ top: anchor.rect.top, left: anchor.rect.left, width: anchor.rect.width }}
        >
          {tapbacks ? <div className="km-ctx-taps" ref={tapRef}>{tapbacks}</div> : null}
          {/* Static markup cloned from our own rendered bubble (no user HTML). */}
          <div className="km-ctx-clone" ref={cloneRef} dangerouslySetInnerHTML={{ __html: anchor.html }} />
          {menu ? <div className="km-ctx-menu" ref={menuRef}>{menu}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

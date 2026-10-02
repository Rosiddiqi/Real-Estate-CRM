import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';
import { registerPushSurface, unregisterPushSurface, beginPushRelease } from '../lib/pushStack';

// usePushPanel (ported from RevMatch) — one hook that gives a page-like overlay (thread,
// contact card, settings, listings…) the full navigation-stack
// treatment:
//   • ENTER: slides in from the right (km-push-in) over a dim scrim
//     while the surface underneath dips 24% left (pushStack classes).
//   • BACK BUTTON: requestClose() pops it back to the right in sync
//     with the scrim fade + the under-surface riding back to rest.
//   • EDGE SWIPE: interactive peel via useEdgeSwipeBack — the panel,
//     its portaled chrome (companions), the scrim and the under-dip
//     all track the finger; commit unmounts with NO second animation.
//
// Usage:
//   const { panelRef, closing, requestClose } = usePushPanel(onClose, {
//     companions: ['.composer', '.thread-footer-tint'],  // body-portaled chrome
//     syncComposer: true,  // ride those companions on enter/exit too
//     pinned: ['[data-peel-pin]'],  // in-panel chrome that holds still on a swipe-back
//   });
//   <div ref={panelRef} style={{ position:'fixed', inset:0, zIndex:… }}>
//
// The hook manages the km-push-panel classes IMPERATIVELY (classList),
// never through React className — a re-render rewriting className would
// restart the entrance animation. Keep the panel's own className static.
//
// `closing` is exposed for surfaces that gate other UI on it; the exit
// class + delayed unmount are handled here.

const ENTER_MS = 400;   // matches --km-t-page
const EXIT_MS = 300;    // matches --km-t-page-out

function prefersReduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function usePushPanel(onClose, opts = {}) {
  const { companions, pinned, syncComposer = false } = opts;
  // Stay-mounted components (take an `open` prop and return null
  // themselves) MUST pass opts.open:
  // the panel element only exists while open, so the lifecycle keys on
  // it. Mount/unmount surfaces omit it.
  const isOpen = opts.open !== false;
  const panelRef = useRef(null);
  const scrimRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const syncRef = useRef(syncComposer);
  syncRef.current = syncComposer;
  const timerRef = useRef(null);

  // Reopen resets a stale closing state — otherwise a stay-mounted
  // surface would come back stuck on its exit frame.
  useEffect(() => {
    if (isOpen) {
      clearTimeout(timerRef.current);
      setClosing(false);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const el = panelRef.current;
    if (!el) return undefined;

    registerPushSurface(el);
    el.classList.add('km-push-panel');

    // Scrim lives just under the panel in its own parent, matching its
    // z-index, so it dims exactly what the panel covers.
    const scrim = document.createElement('div');
    scrim.className = 'km-push-scrim';
    try {
      const z = getComputedStyle(el).zIndex;
      if (z && z !== 'auto') scrim.style.zIndex = z;
    } catch { /* noop */ }
    el.parentNode?.insertBefore(scrim, el);
    scrimRef.current = scrim;
    // Class change one frame after insertion so the opacity transition runs.
    const raf = requestAnimationFrame(() => scrim.classList.add('km-push-scrim--on'));

    // Drop the entrance class once it finishes — a live CSS animation
    // would override the swipe gesture's inline drag transform.
    const onEnd = (ev) => {
      if (ev.target === el && ev.animationName === 'km-push-in') {
        el.classList.remove('km-push-panel');
      }
    };
    el.addEventListener('animationend', onEnd);
    const enterFallback = setTimeout(() => el.classList.remove('km-push-panel'), ENTER_MS + 150);

    // Ride the body-portaled composer/footer-tint through the entrance.
    let cmpTimer = null;
    if (syncRef.current) {
      document.body.classList.add('km-cmp-in');
      cmpTimer = setTimeout(() => document.body.classList.remove('km-cmp-in'), ENTER_MS + 120);
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(enterFallback);
      clearTimeout(cmpTimer);
      clearTimeout(timerRef.current);
      el.removeEventListener('animationend', onEnd);
      el.classList.remove('km-push-panel', 'km-push-panel--closing');
      unregisterPushSurface(el);
      scrim.remove();
      scrimRef.current = null;
      document.body.classList.remove('km-cmp-in', 'km-cmp-out');
    };
  }, [isOpen]);

  const requestClose = useCallback(() => {
    if (prefersReduced()) { closeRef.current?.(); return; }
    setClosing((was) => {
      if (was) return was;
      const el = panelRef.current;
      if (el) {
        el.classList.remove('km-push-panel');
        el.classList.add('km-push-panel--closing');
        beginPushRelease(el); // under-surface rides back in sync
      }
      scrimRef.current?.classList.remove('km-push-scrim--on');
      if (syncRef.current) {
        document.body.classList.remove('km-cmp-in');
        document.body.classList.add('km-cmp-out');
      }
      timerRef.current = setTimeout(() => { closeRef.current?.(); }, EXIT_MS);
      return true;
    });
  }, []);

  // Interactive peel. The gesture's commit calls the RAW onClose — the
  // panel is already off-screen under the finger; replaying an exit
  // animation is exactly the double-close flash this replaces.
  const gestureBack = useCallback(() => {
    const el = panelRef.current;
    if (el) beginPushRelease(el);
    closeRef.current?.();
  }, []);
  useEdgeSwipeBack(isOpen && !closing ? gestureBack : null, { panelRef, scrimRef, companions, pinned });

  return { panelRef, closing, requestClose };
}

export default usePushPanel;

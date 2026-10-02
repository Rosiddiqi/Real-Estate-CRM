import { useEffect, useRef } from 'react';
import { surfaceUnder } from '../lib/pushStack';

// Topmost-wins handler stack. Most recently mounted swipe-back instance is the
// one that handles the gesture. Without this, multiple useEdgeSwipeBack calls
// (e.g. AppShell-level back-to-previous-tab + an overlay's onClose) would all
// fire on the same touch and produce a double action.
const handlerStack = [];

// Tuning constants. Generous edge zone so a natural thumb reach lands.
// iOS native back-swipe accepts touches starting up to ~40px in.
const EDGE_ZONE = 40;
// Slow-drag commit point (fraction of screen width)…
const COMMIT_PCT = 0.35;
// …and the projected-position commit: a flick commits when the finger's
// position + ~220ms of coasting at release velocity would cross this.
// This is what makes a quick short flick go back (the iMessage feel)
// instead of snapping the page back in your hand.
const PROJECT_MS = 220;
const PROJECT_PCT = 0.38;
const MIN_COMMIT_PX = 24;      // never commit on a jitter
const FLICK_BACK_V = -0.25;    // moving left this fast at release = cancel
const SCRIM_MAX = 0.42;        // matches .km-push-scrim--on
const DIP_PCT = 0.24;          // matches .km-push-dip--on
const PANEL_SHADOW = '-18px 0 42px rgba(0,0,0,0.5)';

// True while a back-gesture is mid-flight. Surfaces with their OWN parallel
// swipe triggers consult
// this to avoid double-firing a close while the engine owns the touch.
let gestureActive = false;
export function isEdgeSwipeActive() { return gestureActive; }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function prefersReduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Edge swipe-back gesture hook — interactive iOS-style back navigation.
 *
 * Usage:
 *   useEdgeSwipeBack(onBack)                 — body-slide mode (AppShell tab pop)
 *   useEdgeSwipeBack(ref, onBack)            — peel mode: drags that element
 *   useEdgeSwipeBack(onBack, opts)           — peel mode via opts:
 *     opts.panelRef    ref to the overlay root to peel off
 *     opts.scrimRef    ref holding a .km-push-scrim element (usePushPanel
 *                      provides one); without it the engine makes its own
 *     opts.companions  array of CSS selectors for body-portaled chrome that
 *                      must ride the peel (e.g. '.composer'); the LAST match
 *                      of each selector is used (topmost mounted instance)
 *     opts.pinned      array of CSS selectors for chrome INSIDE the panel
 *                      that must NOT ride the peel (the thread's header
 *                      buttons): it holds still on screen
 *                      while the page slides out from under it, and each
 *                      of its buttons goes "poof" (puffs up, blurs, fades)
 *                      the instant the finger lets go.
 *                      The panel unmounts once both the slide and the poof
 *                      are done. A cancelled swipe leaves it exactly where
 *                      it was.
 *
 * Peel mode slides the panel off the surface beneath it (resolved from the
 * pushStack registry): the under-page un-dims and rides its parallax back to
 * rest under the finger. Commit is velocity-projected; the release animation
 * duration is matched to finger speed so the hand-off is seamless.
 *
 * On commit, `onBack` must actually CLOSE the surface (raw unmount — the
 * panel is already off-screen; do not replay an exit animation).
 * Pass null/undefined `onBack` to disable. Topmost mounted instance wins.
 */
export function useEdgeSwipeBack(refOrCallback, maybeCallbackOrOpts, maybeOpts) {
  // Normalize the three call shapes.
  let onBack, opts, legacyRef = null;
  if (typeof refOrCallback === 'function' || refOrCallback == null) {
    onBack = refOrCallback || null;
    opts = maybeCallbackOrOpts || {};
  } else {
    legacyRef = refOrCallback;
    onBack = maybeCallbackOrOpts || null;
    opts = maybeOpts || {};
  }

  // Callbacks/options are read through refs at touch-time so unstable
  // identities can't re-register the handler (and change stack order)
  // mid-session — only enable/disable re-runs the effect.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const legacyRefRef = useRef(legacyRef);
  legacyRefRef.current = legacyRef;

  const enabled = !!onBack;

  useEffect(() => {
    if (!enabled) return undefined;

    const instance = {};
    handlerStack.push(instance);
    const isActive = () => handlerStack[handlerStack.length - 1] === instance;

    // ── Per-gesture state ────────────────────────────────────────────
    let tracking = false;
    let locked = false;
    let dead = false;        // vertical scroll won — ignore rest of touch
    let startX = 0, startY = 0;
    let dx = 0;
    let w = 0;
    let samples = [];        // [{t, x}] pruned to a 120ms window
    let rafId = null;
    let settleTimer = null;

    // Resolved at gesture-lock time.
    let panel = null, under = null, scrim = null, ownScrim = false;
    let companions = [];
    let pinned = [];
    let bodyMode = false;
    let reduced = false;

    const allMovers = () => (panel ? [panel, ...companions] : []);

    const resolveTargets = () => {
      panel = optsRef.current.panelRef?.current
        || legacyRefRef.current?.current
        || null;
      bodyMode = !panel;
      if (bodyMode) { panel = document.body; return; }

      // Under-surface: the page the user lands on. Skip the parallax if
      // the panel LIVES INSIDE it (translating the under would drag the
      // panel along and break the peel).
      under = surfaceUnder(panel);
      if (under && (under === panel || under.contains(panel))) under = null;

      scrim = optsRef.current.scrimRef?.current || null;
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.className = 'km-push-scrim';
        scrim.style.transition = 'none';
        scrim.style.opacity = String(SCRIM_MAX);
        const z = getComputedStyle(panel).zIndex;
        if (z && z !== 'auto') scrim.style.zIndex = z;
        panel.parentNode?.insertBefore(scrim, panel);
        ownScrim = true;
      }

      pinned = [];
      for (const sel of optsRef.current.pinned || []) {
        try { pinned.push(...panel.querySelectorAll(sel)); } catch { /* bad selector — skip */ }
      }
      const sels = optsRef.current.companions || [];
      companions = [];
      for (const sel of sels) {
        try {
          const all = document.querySelectorAll(sel);
          // Last match = the topmost mounted instance of that chrome.
          const el = all[all.length - 1];
          if (el && el !== panel && !panel.contains(el)) companions.push(el);
        } catch { /* bad selector — skip */ }
      }
    };

    const styleForDrag = () => {
      for (const el of allMovers()) {
        el.style.willChange = 'transform';
        el.style.transition = 'none';
        // Kill any in-flight CSS entrance animation — animations beat
        // inline styles, so the drag transform would be ignored.
        el.style.animation = 'none';
      }
      for (const el of pinned) {
        el.style.willChange = 'transform, opacity';
        el.style.transition = 'none';
      }
      // Pinned chrome sits OUTSIDE the panel's box once the panel slides
      // right. A panel that clips (the thread's .km-thread is overflow:
      // hidden) would crop it at its moving left edge, so the page coming
      // back looked like it was covering the buttons. Unclip for the gesture.
      if (pinned.length && !bodyMode) panel.style.overflow = 'visible';
      if (!bodyMode) {
        panel.style.boxShadow = PANEL_SHADOW;
        if (scrim) scrim.style.transition = 'none';
        if (under) {
          under.style.transition = 'none';
          under.style.willChange = 'transform';
        }
      }
    };

    const applyFrame = () => {
      rafId = null;
      const p = clamp(dx / w, 0, 1);
      const x = Math.max(0, dx);
      for (const el of allMovers()) el.style.transform = `translate3d(${x}px, 0, 0)`;
      // Counter-shift pinned chrome by the same amount: net zero on screen.
      for (const el of pinned) el.style.transform = `translate3d(${-x}px, 0, 0)`;
      if (!bodyMode) {
        if (scrim) scrim.style.opacity = String(SCRIM_MAX * (1 - p));
        if (under) under.style.transform = `translate3d(${-DIP_PCT * w * (1 - p)}px, 0, 0)`;
      }
    };

    const scheduleFrame = () => {
      if (rafId == null) rafId = requestAnimationFrame(applyFrame);
    };

    // "Poof": every button in the pinned chrome puffs up, blurs and fades
    // like a puff of smoke. It starts the moment a swipe commits (see
    // commitBack), and the panel only unmounts once it's done. Web
    // Animations, not transitions: a bubbling transitionend would trip the
    // panel's own commit listener.
    const POOF_MS = 260;
    let poofs = [];
    let poofEndsAt = 0;
    const poofPinned = () => {
      poofEndsAt = performance.now() + POOF_MS;
      const dur = POOF_MS;
      const delay = 0;
      for (const host of pinned) {
        const items = host.querySelectorAll('button');
        const targets = items.length ? items : [host];
        for (const el of targets) {
          try {
            poofs.push(el.animate([
              { transform: 'scale(1)', filter: 'blur(0px)', opacity: 1 },
              { transform: 'scale(1.18)', filter: 'blur(2px)', opacity: 0.8, offset: 0.4 },
              { transform: 'scale(1.45)', filter: 'blur(10px)', opacity: 0 },
            ], { duration: dur, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }));
          } catch { el.style.opacity = '0'; } // no Web Animations → just vanish
        }
      }
    };
    const clearInline = (el) => {
      if (!el) return;
      el.style.transform = '';
      el.style.transition = '';
      el.style.willChange = '';
      el.style.animation = '';
    };

    // Full teardown of everything the gesture touched. Hook-owned scrims
    // get their inline overrides cleared so class styling resumes control;
    // engine-owned scrims are removed outright.
    const releaseAll = () => {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      clearTimeout(settleTimer);
      for (const el of allMovers()) clearInline(el);
      if (pinned.length && !bodyMode && panel) panel.style.overflow = '';
      for (const a of poofs) { try { a.cancel(); } catch { /* noop */ } }
      poofs = [];
      for (const el of pinned) {
        clearInline(el);
        el.style.opacity = '';
        el.style.pointerEvents = '';
        for (const b of el.querySelectorAll('button')) b.style.opacity = '';
      }
      pinned = [];
      if (!bodyMode && panel) panel.style.boxShadow = '';
      if (under) { clearInline(under); under = null; }
      if (scrim) {
        if (ownScrim) scrim.remove();
        else { scrim.style.opacity = ''; scrim.style.transition = ''; }
        scrim = null; ownScrim = false;
      }
      panel = null;
      companions = [];
      gestureActive = false;
    };

    const velocity = () => {
      if (samples.length < 2) return 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (dt < 8) return 0;
      return (last.x - first.x) / dt; // px per ms
    };

    // Run the navigation exactly once, after the slide-off finishes.
    // Body mode: swap the page WHILE parked off-screen, then clear the
    // transform after the new page paints so old content never flashes
    // back at x=0. Peel mode: the overlay unmounts on onBack; clear the
    // under/scrim styling a couple frames later, after React has removed
    // the panel and pushStack has recomputed the dip classes.
    const makeRunBack = () => {
      let ran = false;
      return () => {
        if (ran) return;
        ran = true;
        const finish = () => {
          try { onBackRef.current?.(); } catch (e) { console.error('[edge-swipe] onBack threw:', e); }
          requestAnimationFrame(() => requestAnimationFrame(releaseAll));
        };
        // Page has landed. If the header's poof (started on release) is
        // still clearing, let it finish before the panel unmounts.
        const left = pinned.length ? Math.max(0, poofEndsAt - performance.now()) : 0;
        if (left > 0) settleTimer = setTimeout(finish, left);
        else finish();
      };
    };

    const commitBack = () => {
      const v = Math.max(velocity(), 0);
      const remaining = Math.max(w - dx, 0);
      // Match the hand-off: fast flick = fast exit. 1.1px/ms floor keeps a
      // slow release from crawling.
      const ms = clamp(remaining / Math.max(v, 1.1), 130, 320);
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }

      const curve = `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      for (const el of allMovers()) el.style.transition = curve;
      // Pinned chrome counter-slides on the SAME curve + duration, so it
      // stays put for the whole exit. Its buttons then go "poof" (below).
      for (const el of pinned) el.style.transition = curve;
      if (scrim) scrim.style.transition = `opacity ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      if (under) under.style.transition = curve;
      // Force the start positions to flush before the end-state writes,
      // or the browser can batch both and skip the animation entirely.
      void panel.offsetWidth;
      const off = bodyMode ? '100%' : `${w + 48}px`; // +48 clears the edge shadow
      for (const el of allMovers()) el.style.transform = `translate3d(${off}, 0, 0)`;
      for (const el of pinned) el.style.transform = `translate3d(-${w + 48}px, 0, 0)`;
      // Buttons poof right away, while the page slides out under them.
      // Not tappable in the meantime — the page is leaving.
      for (const el of pinned) el.style.pointerEvents = 'none';
      if (pinned.length) poofPinned();
      if (scrim) scrim.style.opacity = '0';
      if (under) under.style.transform = 'translate3d(0, 0, 0)';

      const runBack = makeRunBack();
      panel.addEventListener('transitionend', runBack, { once: true });
      settleTimer = setTimeout(runBack, ms + 90); // fallback if transitionend never fires
    };

    const cancelBack = () => {
      const ms = clamp(dx / 1.5, 140, 280);
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      const curve = `transform ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      for (const el of allMovers()) el.style.transition = curve;
      for (const el of pinned) el.style.transition = curve;
      if (scrim) scrim.style.transition = `opacity ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      if (under) under.style.transition = curve;
      void panel.offsetWidth;
      for (const el of allMovers()) el.style.transform = 'translate3d(0, 0, 0)';
      for (const el of pinned) el.style.transform = 'translate3d(0, 0, 0)';
      if (scrim) scrim.style.opacity = String(SCRIM_MAX);
      if (under) under.style.transform = `translate3d(${-DIP_PCT * w}px, 0, 0)`;
      settleTimer = setTimeout(releaseAll, ms + 40);
    };

    const onTouchStart = (e) => {
      if (!isActive() || gestureActive) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE) return;
      tracking = true;
      locked = false;
      dead = false;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      w = window.innerWidth;
      samples = [{ t: e.timeStamp, x: t.clientX }];
    };

    const onTouchMove = (e) => {
      if (!tracking || dead || !isActive()) return;
      const t = e.touches[0];
      dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!locked) {
        if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical scroll wins — give up this touch.
          tracking = false;
          dead = true;
          return;
        }
        locked = true;
        gestureActive = true;
        reduced = prefersReduced();
        // Dismiss the keyboard the instant the gesture engages (iMessage
        // parity) — it drops in parallel with the page slide.
        const ae = document.activeElement;
        if (ae && typeof ae.blur === 'function'
            && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
          ae.blur();
        }
        if (!reduced) {
          resolveTargets();
          styleForDrag();
        }
      }

      samples.push({ t: e.timeStamp, x: t.clientX });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 120) samples.shift();

      if (reduced) return; // numeric tracking only — no visual drag
      scheduleFrame();
    };

    const onTouchEnd = () => {
      if (!tracking || dead) return;
      tracking = false;
      if (!locked) return;

      const v = velocity();
      const projected = dx + v * PROJECT_MS;
      const commit = dx > MIN_COMMIT_PX
        && v > FLICK_BACK_V
        && (dx > w * COMMIT_PCT || projected > w * PROJECT_PCT);

      if (reduced) {
        gestureActive = false;
        if (commit) onBackRef.current?.();
        return;
      }
      if (commit) commitBack();
      else cancelBack();
    };

    document.body.addEventListener('touchstart', onTouchStart, { passive: true });
    document.body.addEventListener('touchmove', onTouchMove, { passive: true });
    document.body.addEventListener('touchend', onTouchEnd, { passive: true });
    document.body.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      const idx = handlerStack.indexOf(instance);
      if (idx >= 0) handlerStack.splice(idx, 1);
      document.body.removeEventListener('touchstart', onTouchStart);
      document.body.removeEventListener('touchmove', onTouchMove);
      document.body.removeEventListener('touchend', onTouchEnd);
      document.body.removeEventListener('touchcancel', onTouchEnd);
      releaseAll();
    };
  }, [enabled]);
}

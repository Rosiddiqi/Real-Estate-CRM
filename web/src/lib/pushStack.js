// pushStack — registry of mounted push panels (page-like overlays:
// thread, contact card, settings, inventory…). It answers "what
// surface sits underneath this panel?" for the two halves of the
// navigation-stack illusion:
//   1. usePushPanel dips the under-surface (parallax + return ride)
//      while a panel covers it — the iOS layered-stack look.
//   2. useEdgeSwipeBack peels the top panel off that same under-
//      surface during the interactive back gesture.
// The bottom of the stack is always the app shell's main content
// area (.km-shell-main — tagged in AppShell.jsx).
//
// Dip classes (styles/animations.css): `km-push-dip` carries the
// transform transition, `km-push-dip--on` holds the -24% offset.
// recomputeDips() is the single writer of those classes so stacked
// / out-of-order unmounts can't strand a surface offset.

const stack = [];        // panels, bottom → top, in mount order
const releasing = new Set(); // panels that began an animated close

const DIP_CLEANUP_MS = 500; // > --km-t-page so the return ride finishes

function shellMain() {
  try { return document.querySelector('.km-shell-main'); } catch { return null; }
}

export function surfaceUnder(el) {
  const idx = stack.indexOf(el);
  if (idx > 0) return stack[idx - 1];
  return shellMain();
}

// The set of surfaces that SHOULD be dipped right now: everything
// directly underneath a mounted, not-yet-releasing panel.
function desiredDipped() {
  const want = new Set();
  for (const panel of stack) {
    if (releasing.has(panel)) continue;
    const under = surfaceUnder(panel);
    // A panel rendered INSIDE its under-surface's DOM tree (e.g.
    // a detail view inside the contact card) must not dip it — the transform
    // would drag the panel itself along.
    if (under == null || under === panel || under.contains(panel)) continue;
    // NEVER dip a surface that is itself mid-close (releasing, or carrying
    // the exit animation class). A closing panel that is still registered
    // used to be picked as a newly entering panel's under-surface and got
    // translated -24% while exiting — and when a registration race put a
    // HIGHER-z panel "under" a lower-z one, the dip stamped a permanent
    // -24% freeze onto the covering surface (the stuck contact card over
    // Allocation Requests, 2026-08-01). A closing surface is leaving the
    // stack; it must only ever ride its own exit.
    if (releasing.has(under) || under.classList?.contains('km-push-panel--closing')) continue;
    // GEOMETRIC GUARD: never dip an "under" surface that actually renders ON
    // TOP of the panel (higher z-index). That only happens on a registration
    // inversion — e.g. a stale child card co-mounting with its stay-mounted
    // host registers child-first, putting a z250 card "under" a z240 panel in
    // stack order. Dipping the visually-covering surface is what produced the
    // permanent -24% freeze; a surface that covers its panel is never a
    // parallax under-layer, so skip it.
    try {
      const uz = parseInt(getComputedStyle(under).zIndex, 10);
      const pz = parseInt(getComputedStyle(panel).zIndex, 10);
      if (Number.isFinite(uz) && Number.isFinite(pz) && uz > pz) continue;
    } catch { /* ignore — dip as normal */ }
    want.add(under);
  }
  return want;
}

const dipped = new Set();
const removeTimers = new Map();

function recomputeDips() {
  const want = desiredDipped();
  // Dip newcomers. Base + state class land in one style pass — the
  // under element already exists in the DOM, so the transition runs.
  for (const el of want) {
    if (dipped.has(el)) continue;
    const t = removeTimers.get(el);
    if (t) { clearTimeout(t); removeTimers.delete(el); }
    el.classList.add('km-push-dip', 'km-push-dip--on');
    dipped.add(el);
  }
  // Release the rest: drop the offset now (animates back on the
  // class transition), drop the transition base after it settles.
  for (const el of [...dipped]) {
    if (want.has(el)) continue;
    dipped.delete(el);
    el.classList.remove('km-push-dip--on');
    const t = setTimeout(() => {
      removeTimers.delete(el);
      if (!dipped.has(el)) el.classList.remove('km-push-dip');
    }, DIP_CLEANUP_MS);
    removeTimers.set(el, t);
  }
}

export function registerPushSurface(el) {
  if (!el || stack.includes(el)) return;
  stack.push(el);
  recomputeDips();
}

export function unregisterPushSurface(el) {
  const idx = stack.indexOf(el);
  if (idx >= 0) stack.splice(idx, 1);
  releasing.delete(el);
  recomputeDips();
}

// Called the moment a panel STARTS an animated close (button pop or
// gesture commit) so its under-surface rides back to rest in sync
// with the exit, instead of waiting for the unmount.
export function beginPushRelease(el) {
  if (!el || !stack.includes(el)) return;
  releasing.add(el);
  recomputeDips();
}

// A cancelled gesture re-covers the under-surface — re-dip it.
export function cancelPushRelease(el) {
  if (!el || !releasing.has(el)) return;
  releasing.delete(el);
  recomputeDips();
}

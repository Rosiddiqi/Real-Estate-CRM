// Desktop "phone frame": on wide screens the page hosts the app in a centered,
// iPhone-sized iframe, so every screen renders exactly as it does on the phone
// (media queries, gestures, sheets and the tab bar all see a phone viewport).
// No app code loads on the host page. Never used in the native app.
//
// Opt out: Settings → Appearance → Full width (localStorage km-full-width=1),
// or ?frame=0 in the URL.
const FULL_KEY = 'km-full-width';
const MIN_WIDE = 760;   // narrower windows (and all phones) render the app directly
const W = 430;          // iPhone Pro Max logical width
const H = 932;

const isNativeShell = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
};

export function shouldFrame() {
  if (typeof window === 'undefined') return false;
  if (window.self !== window.top) return false;          // already inside the frame
  if (isNativeShell()) return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('frame') === '0') return false;
  if (q.get('frame') === '1') return true;
  try { if (localStorage.getItem(FULL_KEY) === '1') return false; } catch { /* ignore */ }
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return !coarse && window.innerWidth >= MIN_WIDE;
}

export function setFullWidth(on) {
  try {
    if (on) localStorage.setItem(FULL_KEY, '1');
    else localStorage.removeItem(FULL_KEY);
  } catch { /* ignore */ }
  const target = window.top || window;
  target.location.href = target.location.pathname + target.location.hash;
}

export function mountDesktopFrame() {
  const root = document.getElementById('root');
  document.documentElement.classList.add('km-host');
  const style = document.createElement('style');
  style.textContent = `
    html.km-host, html.km-host body { height: 100%; margin: 0; background: #06080C; overflow: hidden; }
    .kmf-stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(900px 600px at 50% 38%, rgba(var(--accent-rgb), 0.10), rgba(6,8,12,0) 70%), #06080C;
      font: 500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif; color: rgba(255,255,255,0.34); }
    .kmf-device { position: relative; width: ${W}px; height: min(${H}px, calc(100vh - 84px)); margin-bottom: 26px; border-radius: 46px; padding: 9px;
      background: linear-gradient(160deg, #1b2230, #0b0f16 45%, #121822); box-shadow: 0 0 0 1px rgba(255,255,255,0.10), 0 40px 120px -30px rgba(var(--accent-rgb), 0.35), 0 30px 80px rgba(0,0,0,0.6); }
    .kmf-screen { width: 100%; height: 100%; border: 0; border-radius: 38px; background: #06080C; display: block; overflow: hidden; }
    .kmf-foot { position: fixed; bottom: 16px; left: 0; right: 0; display: flex; justify-content: center; gap: 14px; letter-spacing: 0.02em; }
    .kmf-foot button { all: unset; cursor: pointer; color: rgba(255,255,255,0.46); }
    .kmf-foot button:hover { color: #4DA2FF; }
    @media (max-height: 700px) { .kmf-device { border-radius: 30px; padding: 6px; } .kmf-screen { border-radius: 25px; } }
  `;
  document.head.appendChild(style);

  const src = `${window.location.pathname}${window.location.search ? `${window.location.search}&` : '?'}framed=1${window.location.hash}`;
  root.innerHTML = `
    <div class="kmf-stage">
      <div class="kmf-device"><iframe class="kmf-screen" title="KeyMatch" allow="clipboard-read; clipboard-write; microphone; camera; geolocation" src="${src}"></iframe></div>
      <div class="kmf-foot"><span>KeyMatch · iPhone view</span><button type="button" data-full>Use full width</button></div>
    </div>`;
  root.querySelector('[data-full]').addEventListener('click', () => setFullWidth(true));

  // Keep the address bar and the frame's route in step (deep links, refresh).
  const frame = root.querySelector('iframe');
  let last = '';
  const pull = () => {
    try {
      const inner = frame.contentWindow.location;
      if (inner.hash !== last) {
        last = inner.hash;
        history.replaceState(null, '', window.location.pathname + inner.hash);
      }
      const t = frame.contentDocument && frame.contentDocument.title;
      if (t && document.title !== t) document.title = t;
    } catch { /* cross-origin never happens here */ }
  };
  setInterval(pull, 400);
  window.addEventListener('hashchange', () => {
    try { if (frame.contentWindow.location.hash !== window.location.hash) frame.contentWindow.location.hash = window.location.hash; } catch { /* ignore */ }
  });
}

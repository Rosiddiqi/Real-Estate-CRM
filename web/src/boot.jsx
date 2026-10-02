import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './hooks/useShellEffects';
import { hydrateNativeStorage, initNative, hideSplash } from './lib/native';

// The real app boot (main.jsx decides whether this page hosts the app itself
// or a phone-width frame around it on wide desktop screens).
export function boot() {
if (window.self !== window.top) document.documentElement.classList.add('km-framed');
// Apply theme + accent before first paint (no flash).
applyTheme();

// A stale code-split chunk after a deploy → reload once per session.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('km-preload-reloaded') === '1') return;
    sessionStorage.setItem('km-preload-reloaded', '1');
    e.preventDefault();
    window.location.reload();
  } catch { /* ignore */ }
});

(async () => {
  // Native: restore the durable session before anything reads storage.
  await hydrateNativeStorage();
  applyTheme();
  initNative();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  setTimeout(hideSplash, 350);
})();
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './hooks/useShellEffects';

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

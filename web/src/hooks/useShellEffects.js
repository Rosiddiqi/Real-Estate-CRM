// Shell-level effects mounted once by AppShell.
//  • useKeyboardInset — publishes the on-screen keyboard height as
//    --keyboard-height so sheets/composers rise in lockstep (visualViewport).
//  • useTheme — applies dark/light from preferences.
import { useEffect } from 'react';
import { isNative, syncNativeTheme } from '../lib/native';

export function useKeyboardInset() {
  useEffect(() => {
    if (isNative()) return undefined; // native keyboard events drive it (lib/native.js)
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const h = kb > 80 ? Math.round(kb) : 0; // ignore toolbar jitter
        document.documentElement.style.setProperty('--keyboard-height', `${h}px`);
        document.body.classList.toggle('km-kb-open', h > 0);
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}

const THEME_KEY = 'km-theme';
const LEGACY_ACCENT_KEY = 'km-accent'; // retired: the highlight is always Volt
const THEME_BG = { dark: '#0D0D0D', light: '#F2F2F2' };

export function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

// Light or dark is the only appearance choice. Every color — including the
// one highlight, neon green-yellow — comes from the theme blocks in
// tokens.css, so nothing is written inline.
export function applyTheme(theme = getStoredTheme()) {
  const root = document.documentElement;
  const mode = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', mode);
  ['--hl', '--hl-rgb', '--hl-soft', '--hl-line', '--hl-ink', '--on-hl', '--lg-accent'].forEach((k) => root.style.removeProperty(k));
  try { localStorage.removeItem(LEGACY_ACCENT_KEY); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BG[mode]);
  document.body.style.background = THEME_BG[mode];
  syncNativeTheme(mode);
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

export function useTheme(preferences) {
  useEffect(() => {
    // Server preferences win when present (sync across devices).
    if (preferences?.theme) { try { localStorage.setItem(THEME_KEY, preferences.theme); } catch { /* ignore */ } }
    applyTheme();
  }, [preferences?.theme]);
}

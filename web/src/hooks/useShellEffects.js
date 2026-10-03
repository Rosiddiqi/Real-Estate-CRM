// Shell-level effects mounted once by AppShell.
//  • useKeyboardInset — publishes the on-screen keyboard height as
//    --keyboard-height so sheets/composers rise in lockstep (visualViewport).
//  • useTheme — applies dark/light + accent palette from preferences.
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
const ACCENT_KEY = 'km-accent';

// Highlight palettes. The app is monochrome (white emphasis on a near-black
// floor); the highlight is the one color, used for live / active / AI /
// progress moments. Each highlight has a per-theme ink for any small text
// that must sit on a light surface, and the color text takes on top of it.
export const ACCENTS = {
  volt: {
    label: 'Volt', swatch: '#D4FF3F',
    dark: { hl: '#D4FF3F', rgb: '212, 255, 63', ink: '#D4FF3F', on: '#0D0D0D' },
    light: { hl: '#D4FF3F', rgb: '212, 255, 63', ink: '#4E6B00', on: '#0D0D0D' },
  },
  amber: {
    label: 'Amber', swatch: '#FFB440',
    dark: { hl: '#FFB440', rgb: '255, 180, 64', ink: '#FFB440', on: '#0D0D0D' },
    light: { hl: '#FFB440', rgb: '255, 180, 64', ink: '#A35F00', on: '#0D0D0D' },
  },
  mist: {
    label: 'Mist', swatch: '#E8E8E8',
    dark: { hl: '#FFFFFF', rgb: '255, 255, 255', ink: '#FFFFFF', on: '#0D0D0D' },
    light: { hl: '#0D0D0D', rgb: '13, 13, 13', ink: '#0D0D0D', on: '#FFFFFF' },
  },
};
export const DEFAULT_ACCENT = 'volt';
const THEME_BG = { dark: '#0D0D0D', light: '#F2F2F2' };

export function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
export function getStoredAccent() {
  try {
    const a = localStorage.getItem(ACCENT_KEY);
    return ACCENTS[a] ? a : DEFAULT_ACCENT; // older palettes (electric, gallery, riviera) fall back to Volt
  } catch { return DEFAULT_ACCENT; }
}

export function applyTheme(theme = getStoredTheme(), accent = getStoredAccent()) {
  const root = document.documentElement;
  const mode = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', mode);
  // Only the highlight is written inline; every other color comes from the
  // theme blocks in tokens.css, so light and dark values both apply.
  const h = (ACCENTS[accent] || ACCENTS[DEFAULT_ACCENT])[mode];
  root.style.setProperty('--hl', h.hl);
  root.style.setProperty('--hl-rgb', h.rgb);
  root.style.setProperty('--hl-soft', `rgba(${h.rgb}, ${mode === 'light' ? 0.22 : 0.14})`);
  root.style.setProperty('--hl-line', `rgba(${h.rgb}, 0.38)`);
  root.style.setProperty('--hl-ink', h.ink);
  root.style.setProperty('--on-hl', h.on);
  root.style.setProperty('--lg-accent', h.hl);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BG[mode]);
  document.body.style.background = THEME_BG[mode];
  syncNativeTheme(mode);
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme, getStoredAccent());
}

export function setAccent(accent) {
  try { localStorage.setItem(ACCENT_KEY, accent); } catch { /* ignore */ }
  applyTheme(getStoredTheme(), accent);
}

export function useTheme(preferences) {
  useEffect(() => {
    // Server preferences win when present (sync across devices).
    if (preferences?.theme) { try { localStorage.setItem(THEME_KEY, preferences.theme); } catch { /* ignore */ } }
    if (preferences?.accent) { try { localStorage.setItem(ACCENT_KEY, preferences.accent); } catch { /* ignore */ } }
    applyTheme();
  }, [preferences?.theme, preferences?.accent]);
}

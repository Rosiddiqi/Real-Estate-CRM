// Shell-level effects mounted once by AppShell.
//  • useKeyboardInset — publishes the on-screen keyboard height as
//    --keyboard-height so sheets/composers rise in lockstep (visualViewport).
//  • useTheme — applies dark/light + accent palette from preferences.
import { useEffect } from 'react';

export function useKeyboardInset() {
  useEffect(() => {
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

// Accent palettes (one electric accent + near-black floor + liquid glass).
// "electric" is RevMatch's iMessage blue; the other two are the luxury-real-
// estate options from the design spec. iMessage blue / SMS green bubbles never
// change — they're channel signals, not brand.
export const ACCENTS = {
  electric: { label: 'Electric', blue: '#2E8BFF', bright: '#4DA2FF', deep: '#1567E0', glow: 'rgba(46,139,255,0.45)', tint: 'rgba(46,139,255,0.12)', tintHi: 'rgba(46,139,255,0.22)' },
  gallery: { label: 'Gallery', blue: '#3D5CFF', bright: '#6B83FF', deep: '#2A3FD6', glow: 'rgba(61,92,255,0.45)', tint: 'rgba(61,92,255,0.13)', tintHi: 'rgba(61,92,255,0.24)' },
  riviera: { label: 'Riviera', blue: '#19C2D6', bright: '#4FD8E8', deep: '#0E8FA0', glow: 'rgba(25,194,214,0.40)', tint: 'rgba(25,194,214,0.12)', tintHi: 'rgba(25,194,214,0.22)' },
};

export function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
export function getStoredAccent() {
  try { return localStorage.getItem(ACCENT_KEY) || 'electric'; } catch { return 'electric'; }
}

export function applyTheme(theme = getStoredTheme(), accent = getStoredAccent()) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  const a = ACCENTS[accent] || ACCENTS.electric;
  root.style.setProperty('--blue', a.blue);
  root.style.setProperty('--bright', a.bright);
  root.style.setProperty('--deep', a.deep);
  root.style.setProperty('--glow', a.glow);
  root.style.setProperty('--tint', a.tint);
  root.style.setProperty('--tintHi', a.tintHi);
  root.style.setProperty('--lg-accent', a.bright);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F2F2F7' : '#06080C');
  document.body.style.background = theme === 'light' ? '#F2F2F7' : '#06080C';
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

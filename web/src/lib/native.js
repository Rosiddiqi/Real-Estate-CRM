// Native (Capacitor iOS) integration — a no-op in the browser/PWA.
//
//   initNative()        status bar, splash, keyboard height, foreground resync
//   hydrateNativeStorage()  restore durable tokens (Preferences → localStorage) before first render
//   haptic('light'|'medium'|'heavy'|'success'|'warning'|'error'|'selection')
//   isNative()
import { Capacitor } from '@capacitor/core';

export const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

// Keys that must survive iOS purging WKWebView storage (session + server).
const DURABLE_KEYS = ['km_rt', 'km_at', 'km_api_base', 'km-theme', 'km-accent', 'km-active-tab'];

export async function hydrateNativeStorage() {
  if (!isNative()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    for (const k of DURABLE_KEYS) {
      let have = null;
      try { have = localStorage.getItem(k); } catch { /* ignore */ }
      if (have != null) continue;
      const { value } = await Preferences.get({ key: k });
      if (value != null) { try { localStorage.setItem(k, value); } catch { /* ignore */ } }
    }
    // Mirror future writes of durable keys into Preferences.
    const orig = Storage.prototype.setItem;
    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function setItem(k, v) {
      orig.call(this, k, v);
      if (this === window.localStorage && DURABLE_KEYS.includes(k)) Preferences.set({ key: k, value: String(v) }).catch(() => {});
    };
    Storage.prototype.removeItem = function removeItem(k) {
      origRemove.call(this, k);
      if (this === window.localStorage && DURABLE_KEYS.includes(k)) Preferences.remove({ key: k }).catch(() => {});
    };
  } catch (err) {
    console.warn('[native] storage hydrate failed', err);
  }
}

export async function initNative() {
  if (!isNative()) return;
  document.documentElement.classList.add('km-native');
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  } catch { /* plugin missing */ }

  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    const set = (h) => {
      document.documentElement.style.setProperty('--keyboard-height', `${Math.round(h)}px`);
      document.body.classList.toggle('km-kb-open', h > 0);
    };
    Keyboard.addListener('keyboardWillShow', (info) => set(info?.keyboardHeight || 0));
    Keyboard.addListener('keyboardWillHide', () => set(0));
    Keyboard.setAccessoryBarVisible?.({ isVisible: false }).catch(() => {});
  } catch { /* plugin missing */ }

  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) return;
      const { ws } = await import('../api/ws');
      if (!ws.sock || ws.sock.readyState > 1) ws.connect();
      ws.emit('resync', { reason: 'foreground' });
      window.dispatchEvent(new CustomEvent('km:badges'));
    });
  } catch { /* plugin missing */ }
}

// Status bar + keyboard follow the in-app theme (light text on dark, and
// vice versa). Called by applyTheme(); a no-op on the web.
export async function syncNativeTheme(theme) {
  if (!isNative()) return;
  const dark = theme !== 'light';
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch { /* plugin missing */ }
  try {
    const { Keyboard, KeyboardStyle } = await import('@capacitor/keyboard');
    await Keyboard.setStyle({ style: dark ? KeyboardStyle.Dark : KeyboardStyle.Light });
  } catch { /* plugin missing */ }
}

export async function hideSplash() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch { /* ignore */ }
}

let hapticsMod = null;
export async function haptic(kind = 'light') {
  if (!isNative()) return;
  try {
    if (!hapticsMod) hapticsMod = await import('@capacitor/haptics');
    const { Haptics, ImpactStyle, NotificationType } = hapticsMod;
    if (kind === 'selection') return Haptics.selectionChanged();
    if (kind === 'success' || kind === 'warning' || kind === 'error') {
      return Haptics.notification({ type: { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[kind] });
    }
    return Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind] || ImpactStyle.Light });
  } catch { /* ignore */ }
}

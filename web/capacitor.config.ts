import type { CapacitorConfig } from '@capacitor/cli';

// KeyMatch iOS shell (Capacitor 8, Swift Package Manager).
//
// Bundled mode, exactly like RevMatch: the app runs its OWN bundled web assets
// (no `server.url`), which keeps it reliably native (session persistence,
// keyboard, status bar). The app reaches the backend through the absolute
// VITE_API_URL baked in at build time — see scripts/ios/deploy-testflight.sh.
// Do NOT add a `server.url` here except temporarily for live-reload dev.
const config: CapacitorConfig = {
  appId: 'com.revmatchai.keymatch',
  appName: 'KeyMatch',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0D0D0D',
    // Inner containers scroll; the WebView itself never rubber-bands.
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    Keyboard: {
      // 'none' + our visualViewport-driven --keyboard-height keeps fixed
      // chrome (composer, sheets) riding the keyboard instead of the whole
      // WebView shrinking under it.
      resize: 'none',
      resizeOnFullScreen: true,
      style: 'dark',
    },
    StatusBar: {
      style: 'dark',
      overlaysWebView: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0D0D0D',
      showSpinner: false,
      launchFadeOutDuration: 250,
    },
  },
};

export default config;

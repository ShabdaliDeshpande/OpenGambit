import type { CapacitorConfig } from '@capacitor/cli';

// The phone apps: the built web app (dist/) inside an Android APK or an iOS app.
// See "Android app" and "iPhone and iPad app" in README.md.
const config: CapacitorConfig = {
  appId: 'com.opengambit.app',
  appName: 'OpenGambit',
  webDir: 'dist',
  android: {
    // transparent until the page paints, so the window's light or dark background shows instead of a white flash
    backgroundColor: '#00000000',
    // the pages are served from https://localhost and only talk to https servers
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    // the page keeps clear of the notch and home indicator itself (env(safe-area-inset-*))
    contentInset: 'never',
    // an iPad shows the phone layout rules too, not a desktop-class page
    preferredContentMode: 'mobile',
  },
  plugins: {
    SystemBars: {
      // Android: draw edge to edge; the page keeps clear of the bars with the --safe-area-inset-* values
      insetsHandling: 'css',
      // index.html asks for viewport-fit=cover, so start that way and skip a layout jump
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;

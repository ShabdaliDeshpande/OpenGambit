import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the built web app (dist/) inside an APK. See "Android app" in README.md.
const config: CapacitorConfig = {
  appId: 'com.opengambit.app',
  appName: 'OpenGambit',
  webDir: 'dist',
  // transparent until the page paints, so the window's light or dark background shows instead of a white flash
  backgroundColor: '#00000000',
  android: {
    // the pages are served from https://localhost and only talk to https servers
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // draw edge to edge; the page keeps clear of the bars with the --safe-area-inset-* values
      insetsHandling: 'css',
      // index.html asks for viewport-fit=cover, so start that way and skip a layout jump
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;

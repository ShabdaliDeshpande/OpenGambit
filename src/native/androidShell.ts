// What the Android app does differently from the website: the system back
// button, and status / navigation bar icons that match the app's theme.

import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { isNativeApp } from '../net/server';

/** Pop-ups that close with Escape (the promotion picker, the notifications list). */
const ESCAPE_CLOSES = '.promotion-overlay, .bell-panel';

/**
 * Handles Android's back button, most specific first: close an open dialog or
 * pop-up, go back to the previous screen, go back to the Play tab, and
 * finally send the app to the background (which keeps a running game alive,
 * unlike closing it).
 */
export function handleBackButton(canGoBack: boolean, onHomeTab: boolean, goHome: () => void) {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (dialog) {
    dialog.close();
    return;
  }
  if (document.querySelector(ESCAPE_CLOSES)) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }
  if (canGoBack) {
    window.history.back();
    return;
  }
  if (!onHomeTab) {
    goHome();
    return;
  }
  void App.minimizeApp();
}

/** Listens for the back button in the app; returns the unsubscribe function. */
export function listenForBackButton(state: () => { onHomeTab: boolean; goHome: () => void }): () => void {
  if (!isNativeApp) return () => undefined;
  const handle = App.addListener('backButton', ({ canGoBack }) => {
    const { onHomeTab, goHome } = state();
    handleBackButton(canGoBack, onHomeTab, goHome);
  });
  return () => void handle.then(h => h.remove());
}

/** Light icons on the dark theme, dark icons on the light one. */
export function matchSystemBars(theme: 'light' | 'dark') {
  if (!isNativeApp) return;
  void SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
}

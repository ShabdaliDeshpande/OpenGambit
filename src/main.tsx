import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isNativeApp } from './net/server';
import './styles.css';

// the Android app has its own styles (safe areas, no tap flashes) and its files are already on the phone
if (isNativeApp) document.documentElement.classList.add('native-app');

// installable app and offline play, in production builds only (it would cache stale files during development)
if (import.meta.env.PROD && !isNativeApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

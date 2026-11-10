// Where the account API and the game server live.
//
// On the website they're on the same address as the page, so every path is
// used as it is and the session is an HttpOnly cookie. The phone apps run
// their pages from inside the app (https://localhost on Android,
// capacitor://localhost on iOS), so they talk to a server whose address is
// set at build time (VITE_SERVER_URL) or typed in by the player, and they
// sign in with a session token sent in a header instead of a cookie.

import { Capacitor } from '@capacitor/core';

/** True inside the Android or iOS app. */
export const isNativeApp: boolean = Capacitor.isNativePlatform();

const SERVER_KEY = 'opengambit:server';
const SESSION_KEY = 'opengambit:session';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the setting lasts until the app is closed
  }
}

/**
 * Turns what the player typed into a server origin ("https://host[:port]"),
 * or null if it isn't one. A bare host name gets https://.
 */
export function normaliseServer(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // the app's own pages are https, which can only talk to https servers
  if (url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.origin;
}

const BUILT_IN = normaliseServer(String(import.meta.env.VITE_SERVER_URL ?? ''));

let memoryServer: string | null | undefined;
let memorySession: string | null | undefined;

/** The server the app was built for, if any. */
export const builtInServer = (): string | null => BUILT_IN;

/** '' on the website (same address as the page); in the app the chosen server, or null when none is set. */
export function serverBase(): string | null {
  if (!isNativeApp) return '';
  if (memoryServer === undefined) memoryServer = normaliseServer(read(SERVER_KEY) ?? '') ?? BUILT_IN;
  return memoryServer;
}

/** Whether the online features have a server to talk to. */
export const hasServer = (): boolean => serverBase() !== null;

const listeners = new Set<() => void>();

/** Calls `listener` whenever the server or the signed-in session changes. */
export function onServerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets the app's server (null goes back to the built-in one). A new server means a new sign-in. */
export function setServer(origin: string | null) {
  const next = origin ?? BUILT_IN;
  if (next === serverBase()) return;
  memoryServer = next;
  write(SERVER_KEY, origin);
  setSessionToken(null, false);
  for (const l of [...listeners]) l();
}

/** The session token the app signed in with (always null on the website, which uses a cookie). */
export function sessionToken(): string | null {
  if (!isNativeApp) return null;
  if (memorySession === undefined) memorySession = read(SESSION_KEY);
  return memorySession;
}

export function setSessionToken(token: string | null, notify = true) {
  if (!isNativeApp) return;
  memorySession = token;
  write(SESSION_KEY, token);
  if (notify) for (const l of [...listeners]) l();
}

/** The full address of an API path such as /api/me, or null when the app has no server. */
export function apiUrl(path: string): string | null {
  const base = serverBase();
  return base === null ? null : base + path;
}

/** Request headers that identify the signed-in player to the server. */
export function authHeaders(): Record<string, string> {
  const token = sessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** The game server's WebSocket address, or null when the app has no server. */
export function socketUrl(path: string): string | null {
  const base = serverBase();
  if (base === null) return null;
  if (base === '') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
  return base.replace(/^http/, 'ws') + path;
}

/**
 * WebSocket subprotocols: in the app the session token travels as one,
 * since a WebSocket can't carry an Authorization header. The server answers
 * with the first one, "opengambit".
 */
export function socketProtocols(): string[] | undefined {
  if (!isNativeApp) return undefined;
  const token = sessionToken();
  return token ? ['opengambit', `bearer.${token}`] : ['opengambit'];
}

export const NO_SERVER = 'Set the server address under Play online first.';

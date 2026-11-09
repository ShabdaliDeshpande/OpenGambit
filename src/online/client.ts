import { onServerChange, socketProtocols, socketUrl } from '../net/server';
import {
  WS_PATH,
  type ClientMessage,
  type GameSnapshot,
  type LobbySnapshot,
  type ServerMessage,
  type TourSnapshot,
  type TourSummary,
} from './protocol';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface ReceivedGame {
  snap: GameSnapshot;
  /** performance.now() when the snapshot arrived, to run the clock locally. */
  at: number;
}

export interface ReceivedTour {
  snap: TourSnapshot;
  at: number;
}

export interface OnlineState {
  status: ConnectionStatus;
  me: { id: string; name: string; registered: boolean } | null;
  lobby: LobbySnapshot | null;
  games: Record<string, ReceivedGame>;
  /** Latest error from the server, with a counter so repeats still show. */
  error: { message: string; game?: string; tour?: string; n: number } | null;
  /** A game that just started for this player (or is still running after a reconnect). */
  started: { game: string; n: number } | null;
  /** Tournament list, with when it arrived (its times are relative). */
  tours: { list: TourSummary[]; at: number } | null;
  tourPages: Record<string, ReceivedTour>;
  /** A tournament this player just created. */
  created: { id: string; n: number } | null;
}

// Per tab (sessionStorage): each tab is its own guest, and a reload keeps the game.
const TOKEN_KEY = 'chess-app:online-token';

function loadToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string | null) {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable: the player is new on every visit
  }
}

/**
 * One WebSocket to the game server, shared by the whole app. It reconnects
 * with backoff and, once welcomed again, re-subscribes to the lobby and the
 * games being watched, so a dropped connection resumes by itself.
 */
export class OnlineClient {
  private ws: WebSocket | null = null;
  private state: OnlineState = {
    status: 'connecting',
    me: null,
    lobby: null,
    games: {},
    error: null,
    started: null,
    tours: null,
    tourPages: {},
    created: null,
  };
  private wantTours = false;
  private readonly watchingTours = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private wantLobby = false;
  private readonly watching = new Set<string>();
  private retryMs = 500;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;

  constructor() {
    this.open();
    window.addEventListener('pagehide', () => this.send({ t: 'bye' }));
    // back from the background (a phone's screen turned on again): don't wait out the backoff
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.state.status === 'offline') this.reconnect();
    });
    // another server (in the app): a new guest there, and nothing from the old one carries over
    onServerChange(() => {
      saveToken(null);
      this.set({ lobby: null, games: {}, error: null, started: null, tours: null, tourPages: {}, created: null });
      this.reconnect();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  /** Sends if welcomed; returns false when offline. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.state.me) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  setLobby(on: boolean) {
    this.wantLobby = on;
    this.send({ t: 'lobby', on });
  }

  watch(game: string) {
    if (this.watching.has(game)) return;
    this.watching.add(game);
    this.send({ t: 'watch', game });
  }

  unwatch(game: string) {
    if (!this.watching.delete(game)) return;
    this.send({ t: 'leave', game });
  }

  setTourList(on: boolean) {
    this.wantTours = on;
    this.send({ t: 'tours', on });
  }

  watchTour(id: string) {
    if (this.watchingTours.has(id)) return;
    this.watchingTours.add(id);
    this.send({ t: 'watchTour', id });
  }

  unwatchTour(id: string) {
    if (!this.watchingTours.delete(id)) return;
    this.send({ t: 'leaveTour', id });
  }

  /** Opens a fresh connection, e.g. after signing in or out, so the server sees the new session. */
  reconnect() {
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.retryMs = 500;
    this.open();
  }

  /** Whether there's a server to connect to (the app may not have one set yet). */
  get hasServer(): boolean {
    return socketUrl(WS_PATH) !== null;
  }

  private set(patch: Partial<OnlineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private open() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const url = socketUrl(WS_PATH);
    if (url === null) {
      this.set({ status: 'offline', me: null });
      return;
    }
    const ws = new WebSocket(url, socketProtocols());
    this.ws = ws;
    this.set({ status: 'connecting' });
    ws.onopen = () => {
      const token = loadToken();
      ws.send(JSON.stringify({ t: 'hello', ...(token ? { token } : {}) } satisfies ClientMessage));
    };
    ws.onmessage = ev => this.receive(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set({ status: 'offline', me: null });
      this.retryTimer = setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5_000);
    };
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'ping':
        this.ws?.send(JSON.stringify({ t: 'pong', s: msg.s } satisfies ClientMessage));
        return;
      case 'welcome':
        // accounts are recognised by their cookie; only guests keep a token
        if (msg.token) saveToken(msg.token);
        this.retryMs = 500;
        this.set({ status: 'online', me: { id: msg.id, name: msg.name, registered: msg.registered } });
        if (this.wantLobby) this.send({ t: 'lobby', on: true });
        for (const game of this.watching) this.send({ t: 'watch', game });
        if (this.wantTours) this.send({ t: 'tours', on: true });
        for (const id of this.watchingTours) this.send({ t: 'watchTour', id });
        return;
      case 'tours':
        this.set({ tours: { list: msg.tours, at: performance.now() } });
        return;
      case 'tour':
        this.set({ tourPages: { ...this.state.tourPages, [msg.tour.id]: { snap: msg.tour, at: performance.now() } } });
        return;
      case 'tourCreated':
        this.set({ created: { id: msg.id, n: ++this.counter } });
        return;
      case 'lobby':
        this.set({ lobby: msg.lobby });
        return;
      case 'started':
        this.set({ started: { game: msg.game, n: ++this.counter } });
        return;
      case 'game':
        this.set({ games: { ...this.state.games, [msg.game.id]: { snap: msg.game, at: performance.now() } } });
        return;
      case 'error':
        this.set({ error: { message: msg.message, ...(msg.game ? { game: msg.game } : {}), ...(msg.tour ? { tour: msg.tour } : {}), n: ++this.counter } });
        return;
    }
  }
}

let shared: OnlineClient | null = null;

/** The app-wide client, created on first use. */
export function onlineClient(): OnlineClient {
  shared ??= new OnlineClient();
  return shared;
}

/** Reconnects online play if it has been started (no-op otherwise). */
export function reconnectOnline(): void {
  shared?.reconnect();
}

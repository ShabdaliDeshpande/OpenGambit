import type { ServerMessage } from '../src/online/protocol.ts';
import type { Ratings, User } from './store.ts';

/** A signed-in user's details, as known when their connection opened. */
export interface Account {
  user: User;
  ratings: Ratings;
}

/**
 * Someone who can play: an anonymous guest identified by a secret token kept
 * in the browser tab, or a signed-in account (the same player in every tab).
 */
export interface Player {
  /** Public id, shown to others: the user id for accounts. */
  id: string;
  /** Secret used by a guest to reconnect as the same player; empty for accounts. */
  token: string;
  name: string;
  account: Account | null;
  conns: Set<Conn>;
  /** When the player's last connection closed. */
  lastSeen: number;
}

/** One open WebSocket. A player can have several (tabs, reconnects). */
export interface Conn {
  id: number;
  player: Player | null;
  /** The account behind this connection's session cookie, if any. */
  account: Account | null;
  send: (msg: ServerMessage) => void;
  close: () => void;
  lobby: boolean;
  /** Game ids this connection is watching or playing. */
  rooms: Set<string>;
  /** Estimated one-way lag in ms, from ping round trips. */
  lagMs: number;
  lastPong: number;
  tokens: number;
  tokensAt: number;
}

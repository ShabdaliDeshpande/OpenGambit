import type { ServerMessage } from '../src/online/protocol.ts';

/** An anonymous player, identified by a secret token kept in the browser. */
export interface Player {
  /** Public id, shown to others. */
  id: string;
  /** Secret, used to reconnect as the same player. */
  token: string;
  name: string;
  conns: Set<Conn>;
  /** When the player's last connection closed. */
  lastSeen: number;
}

/** One open WebSocket. A player can have several (tabs, reconnects). */
export interface Conn {
  id: number;
  player: Player | null;
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

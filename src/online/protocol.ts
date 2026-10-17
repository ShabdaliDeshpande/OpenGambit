// Messages exchanged over the /ws WebSocket. Shared by the browser and the
// Node server, so this file must not import anything at runtime.
import type { Color } from 'chess.js';
import type { GameResult } from '../chess/gameEnd.ts';

export const WS_PATH = '/ws';

export type SeekColor = Color | 'random';

export interface SeekInfo {
  id: string;
  /** Public id of the player who created it. */
  owner: string;
  name: string;
  tc: string;
  color: SeekColor;
  createdAt: number;
}

export interface GameSummary {
  id: string;
  tc: string;
  white: string;
  black: string;
}

export interface LobbySnapshot {
  seeks: SeekInfo[];
  games: GameSummary[];
  online: number;
}

export interface SeatInfo {
  id: string;
  name: string;
  online: boolean;
}

export type GameStatus = 'playing' | 'finished' | 'aborted';

export interface GameSnapshot {
  id: string;
  tc: string;
  white: SeatInfo;
  black: SeatInfo;
  /** The viewer's colour, or null for spectators. */
  you: Color | null;
  moves: string[];
  status: GameStatus;
  result: GameResult | null;
  /** Remaining time in ms when the message was sent. */
  clock: { w: number; b: number; running: Color | null };
  /** Ms left to play the first move before the game is aborted, or null. */
  firstMoveMs: number | null;
  canAbort: boolean;
  drawOffer: Color | null;
  /** Whether the viewer may offer a draw now (rate limited). */
  canOfferDraw: boolean;
  /** The opponent has been away: ms until a claim is allowed (0 = now). Only sent to players. */
  opponentGone: number | null;
  spectators: number;
}

export type DrawAction = 'offer' | 'accept' | 'decline';

export type ClientMessage =
  | { t: 'hello'; token?: string }
  | { t: 'pong'; s: number }
  | { t: 'lobby'; on: boolean }
  | { t: 'seek'; tc: string; color: SeekColor }
  | { t: 'cancelSeek'; id: string }
  | { t: 'acceptSeek'; id: string }
  | { t: 'watch'; game: string }
  | { t: 'leave'; game: string }
  | { t: 'move'; game: string; uci: string; ply: number }
  | { t: 'resign'; game: string }
  | { t: 'abort'; game: string }
  | { t: 'draw'; game: string; action: DrawAction }
  | { t: 'claim'; game: string; outcome: 'win' | 'draw' }
  | { t: 'bye' };

export type ServerMessage =
  | { t: 'welcome'; token: string; id: string; name: string }
  | { t: 'ping'; s: number }
  | { t: 'lobby'; lobby: LobbySnapshot }
  | { t: 'started'; game: string }
  | { t: 'game'; game: GameSnapshot }
  | { t: 'error'; message: string; game?: string };

// Messages exchanged over the /ws WebSocket. Shared by the browser and the
// Node server, so this file must not import anything at runtime.
import type { Color } from 'chess.js';
import type { GameResult } from '../chess/gameEnd.ts';

export const WS_PATH = '/ws';

export type SeekColor = Color | 'random';

/** A rating as shown next to a name: rounded, with "?" while provisional. */
export interface ShownRating {
  rating: number;
  provisional: boolean;
}

export interface SeekInfo {
  id: string;
  /** Public id of the player who created it. */
  owner: string;
  name: string;
  /** Owner has an account (their name links to a profile). */
  registered: boolean;
  /** The owner's rating in this time control's category; null for guests. */
  rating: ShownRating | null;
  tc: string;
  color: SeekColor;
  rated: boolean;
  createdAt: number;
}

export interface GameSummary {
  id: string;
  tc: string;
  rated: boolean;
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
  registered: boolean;
  /** Rating in this game's category when the game started; null for guests. */
  rating: ShownRating | null;
  /** Rating change from this game, once a rated game has been scored. */
  diff: number | null;
}

export type GameStatus = 'playing' | 'finished' | 'aborted';

export interface GameSnapshot {
  id: string;
  tc: string;
  rated: boolean;
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
  /** The tournament this game belongs to, if any. */
  tournament: { id: string; name: string } | null;
  /** Who went berserk (halved their clock) in this tournament game. */
  berserk: { w: boolean; b: boolean };
  canBerserk: boolean;
  drawOffer: Color | null;
  /** Whether the viewer may offer a draw now (rate limited). */
  canOfferDraw: boolean;
  /** The opponent has been away: ms until a claim is allowed (0 = now). Only sent to players. */
  opponentGone: number | null;
  spectators: number;
}

export type DrawAction = 'offer' | 'accept' | 'decline';

export type TourKind = 'arena' | 'swiss';
export type TourStatus = 'created' | 'started' | 'finished';

/** A tournament in the list. Times are ms from when the message was sent. */
export interface TourSummary {
  id: string;
  kind: TourKind;
  name: string;
  tc: string;
  rated: boolean;
  status: TourStatus;
  cancelled: boolean;
  createdBy: string;
  players: number;
  msToStart: number | null;
  /** Arena: time left. */
  msToEnd: number | null;
  /** Swiss: rounds started so far, and the total. */
  round: number | null;
  nbRounds: number | null;
  winner: string | null;
}

export interface ArenaSheetItem {
  result: 'win' | 'draw' | 'loss' | 'void';
  points: number;
  fire: boolean;
  berserk: boolean;
}

export interface SwissSheetItem {
  round: number;
  outcome: 'win' | 'draw' | 'loss' | 'bye' | 'absent';
  opponent: string | null;
  color: Color | null;
}

export interface TourStanding {
  rank: number;
  id: string;
  name: string;
  rating: number;
  /** Arena points, or Swiss points (halves allowed). */
  score: number;
  /** Arena: on a winning streak (next win counts double). */
  fire: boolean;
  withdrawn: boolean;
  /** The game they're playing now. */
  playing: string | null;
  /** Swiss: Sonneborn–Berger. Arena: performance rating. */
  tieBreak: number | null;
  arena?: ArenaSheetItem[];
  swiss?: SwissSheetItem[];
}

export interface TourSnapshot extends TourSummary {
  berserk: boolean;
  streaks: boolean;
  durationMin: number | null;
  roundIntervalSec: number | null;
  /** Swiss: ms until the next round starts, when waiting between rounds. */
  msToNextRound: number | null;
  standings: TourStanding[];
  /** Games being played right now. */
  games: { id: string; white: string; black: string }[];
  you: { joined: boolean; withdrawn: boolean; playing: string | null } | null;
  canJoin: boolean;
}

export interface CreateTour {
  kind: TourKind;
  name: string;
  tc: string;
  rated: boolean;
  startInMin: number;
  /** Arena only. */
  durationMin: number;
  berserk: boolean;
  /** Swiss only. */
  nbRounds: number;
  roundIntervalSec: number;
}

export const TOUR_OPTIONS = {
  startInMin: [1, 2, 5, 10, 15, 30, 60],
  durationMin: [10, 20, 30, 45, 60, 90, 120],
  nbRounds: [3, 4, 5, 6, 7, 8, 9, 11, 13, 15],
  roundIntervalSec: [10, 30, 60, 120, 300],
} as const;

export type ClientMessage =
  | { t: 'hello'; token?: string }
  | { t: 'pong'; s: number }
  | { t: 'lobby'; on: boolean }
  | { t: 'seek'; tc: string; color: SeekColor; rated: boolean }
  | { t: 'cancelSeek'; id: string }
  | { t: 'acceptSeek'; id: string }
  | { t: 'watch'; game: string }
  | { t: 'leave'; game: string }
  | { t: 'move'; game: string; uci: string; ply: number }
  | { t: 'resign'; game: string }
  | { t: 'abort'; game: string }
  | { t: 'draw'; game: string; action: DrawAction }
  | { t: 'claim'; game: string; outcome: 'win' | 'draw' }
  | { t: 'berserk'; game: string }
  | { t: 'bye' }
  | { t: 'tours'; on: boolean }
  | { t: 'watchTour'; id: string }
  | { t: 'leaveTour'; id: string }
  | { t: 'createTour'; tour: CreateTour }
  | { t: 'joinTour'; id: string }
  | { t: 'withdrawTour'; id: string };

export type ServerMessage =
  /** `token` is set for guests (kept by the tab to reconnect); accounts are recognised by their session cookie. */
  | { t: 'welcome'; token: string | null; id: string; name: string; registered: boolean }
  | { t: 'ping'; s: number }
  | { t: 'lobby'; lobby: LobbySnapshot }
  | { t: 'started'; game: string }
  | { t: 'game'; game: GameSnapshot }
  | { t: 'error'; message: string; game?: string; tour?: string }
  | { t: 'tours'; tours: TourSummary[] }
  | { t: 'tour'; tour: TourSnapshot }
  | { t: 'tourCreated'; id: string };

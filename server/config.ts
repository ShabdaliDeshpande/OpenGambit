import { speedOf, type Speed, type TimeControl } from '../src/chess/clock.ts';

export { speedOf, type Speed };

export interface ServerConfig {
  now: () => number;
  random: () => number;
  /** How often the server pings each connection to measure lag. */
  pingMs: number;
  /** A connection that hasn't answered a ping for this long is closed. */
  staleMs: number;
  /** Time to play the first move (White's, then Black's) before the game is aborted. */
  firstMoveMs: (tc: TimeControl) => number;
  /** How long a disconnected player may stay away before the opponent can claim. */
  disconnectMs: (tc: TimeControl) => number;
  /** The same, when the player closed the page on purpose. */
  byeMs: number;
  /** Finished games stay viewable for this long. */
  finishedTtlMs: number;
  /** Lag compensation: never more than this per move… */
  maxLagCompMs: number;
  /** …and limited by a quota that refills a little with every move. */
  lagQuotaStartMs: number;
  lagQuotaGainMs: number;
  lagQuotaMaxMs: number;
  /** A player may offer a draw again only after this many plies. */
  drawOfferGapPlies: number;
  maxSeeksPerPlayer: number;
  /** A guest with no connection and no running game is forgotten after this long. */
  playerTtlMs: number;
  /** Message rate limit per connection: burst size and refill per second. */
  rateBurst: number;
  ratePerSecond: number;
}

const FIRST_MOVE_S: Record<Speed, number> = { bullet: 20, blitz: 25, rapid: 30, classical: 30 };
const DISCONNECT_FACTOR: Record<Speed, number> = { bullet: 1, blitz: 2, rapid: 4, classical: 10 };

export const DEFAULT_CONFIG: ServerConfig = {
  now: () => Date.now(),
  random: Math.random,
  pingMs: 3_000,
  staleMs: 20_000,
  firstMoveMs: tc => FIRST_MOVE_S[speedOf(tc)] * 1000,
  disconnectMs: tc => 30_000 * DISCONNECT_FACTOR[speedOf(tc)],
  byeMs: 10_000,
  finishedTtlMs: 15 * 60_000,
  maxLagCompMs: 1_000,
  lagQuotaStartMs: 500,
  lagQuotaGainMs: 150,
  lagQuotaMaxMs: 1_500,
  drawOfferGapPlies: 20,
  maxSeeksPerPlayer: 3,
  playerTtlMs: 60 * 60_000,
  rateBurst: 30,
  ratePerSecond: 10,
};

export const makeConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({ ...DEFAULT_CONFIG, ...overrides });

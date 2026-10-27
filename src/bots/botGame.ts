// The rules around a game against a bot: the two modes and their assists,
// takebacks, the game in progress kept in the browser, and what a result
// counts for on the bot's card. Pure.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import type { GameResult } from '../chess/gameEnd';
import { botById } from './bots';

export type BotMode = 'challenge' | 'assisted';

export interface Assists {
  hints: boolean;
  takebacks: boolean;
  evalBar: boolean;
  threats: boolean;
  bestMove: boolean;
}

export const ASSIST_KEYS = ['hints', 'takebacks', 'evalBar', 'threats', 'bestMove'] as const satisfies readonly (keyof Assists)[];

export const ASSIST_LABEL: Record<keyof Assists, string> = {
  hints: 'Hint: the piece to move',
  takebacks: 'Takebacks',
  evalBar: 'Evaluation bar',
  threats: 'Show threats',
  bestMove: 'Best-move arrow',
};

export const NO_ASSISTS: Assists = { hints: false, takebacks: false, evalBar: false, threats: false, bestMove: false };
export const DEFAULT_ASSISTS: Assists = { hints: true, takebacks: true, evalBar: true, threats: false, bestMove: false };

/** The assists that apply: none in Challenge mode. */
export const activeAssists = (mode: BotMode, assists: Assists): Assists => (mode === 'challenge' ? NO_ASSISTS : assists);

/** Whether the assists need the engine to look at your position. */
export const needsAnalysis = (a: Assists) => a.hints || a.evalBar || a.bestMove;

/**
 * How many moves remain after a takeback: everything before your last move
 * (so the bot's reply goes too). Null when you haven't moved yet.
 */
export function takeBackTo(moves: readonly { color: Color }[], player: Color): number | null {
  for (let i = moves.length - 1; i >= 0; i--) if (moves[i]!.color === player) return i;
  return null;
}

/** What a finished Challenge game counts for on the bot's card: 2 a win, 1 a draw, null a loss. */
export function resultValue(result: GameResult, player: Color): 1 | 2 | null {
  if (result.winner === null) return 1;
  return result.winner === player ? 2 : null;
}

/** A game in progress, kept in the browser so a reload carries on with it. */
export interface SavedBotGame {
  botId: string;
  player: Color;
  mode: BotMode;
  assists: Assists;
  /** Moves from the start position, in UCI. */
  moves: string[];
}

export const SAVED_GAME_KEY = 'chess-app:bot-game';

/** A saved game read back, or null if it's damaged, unknown or already over. */
export function parseSavedGame(raw: unknown): SavedBotGame | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.botId !== 'string' || !botById(o.botId)) return null;
  if (o.player !== 'w' && o.player !== 'b') return null;
  if (o.mode !== 'challenge' && o.mode !== 'assisted') return null;
  if (!Array.isArray(o.moves) || o.moves.length > 600 || !o.moves.every(m => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) return null;
  const chess = new Chess();
  try {
    for (const m of o.moves as string[]) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
  } catch {
    return null;
  }
  if (chess.isGameOver()) return null;
  const a = o.assists && typeof o.assists === 'object' ? (o.assists as Record<string, unknown>) : {};
  const assists = Object.fromEntries(ASSIST_KEYS.map(k => [k, a[k] === true])) as unknown as Assists;
  return { botId: o.botId, player: o.player, mode: o.mode, assists, moves: o.moves as string[] };
}

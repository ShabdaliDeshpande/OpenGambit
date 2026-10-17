import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { createClock, findTimeControl, flaggedColor, pressClock, stopClock, type ClockState } from './clock';
import {
  agreementResult,
  detectBoardEnd,
  resignResult,
  timeoutResult,
  TERMINATION_LABEL,
  type GameResult,
  type ResultCode,
} from './gameEnd';

export type Mode = 'local' | 'computer';

export interface GameSetup {
  mode: Mode;
  /** Side the human plays in computer mode. Ignored in local mode. */
  humanColor: Color;
  /** Engine strength, 1–8. */
  level: number;
  /** One of TIME_CONTROLS ids, or null for an untimed game. */
  timeControlId: string | null;
}

export interface MoveRecord {
  san: string;
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
  color: Color;
  /** Position after this move. */
  fen: string;
}

export interface GameState {
  /** Increments on every new or loaded game so stale engine replies can be dropped. */
  id: number;
  setup: GameSetup;
  startFen: string;
  moves: MoveRecord[];
  /** Ply shown on the board; equals moves.length when viewing the live position. */
  viewPly: number;
  result: GameResult | null;
  clock: ClockState | null;
  drawOfferBy: Color | null;
  /** Extra PGN headers carried over from an import (Event, White, …). */
  headers: Record<string, string>;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export type GameAction =
  | { type: 'new'; setup: GameSetup; startFen?: string }
  | { type: 'replace'; state: GameState }
  | ({ type: 'move'; now: number } & MoveInput)
  | { type: 'tick'; now: number }
  | { type: 'resign'; color: Color; now: number }
  | { type: 'offerDraw'; color: Color }
  | { type: 'acceptDraw'; now: number }
  | { type: 'declineDraw' }
  | { type: 'view'; ply: number };

export const DEFAULT_SETUP: GameSetup = {
  mode: 'local',
  humanColor: 'w',
  level: 3,
  timeControlId: '5+0',
};

export function createGame(setup: GameSetup, startFen: string = DEFAULT_POSITION, id = 1): GameState {
  const tc = findTimeControl(setup.timeControlId);
  const base: GameState = {
    id,
    setup,
    startFen,
    moves: [],
    viewPly: 0,
    result: null,
    clock: tc ? createClock(tc) : null,
    drawOfferBy: null,
    headers: {},
  };
  // A position loaded from FEN may already be finished.
  const end = detectBoardEnd(new Chess(startFen));
  return end ? { ...base, result: end } : base;
}

/** Replays the game so chess.js knows the full history (needed for repetition). */
export function buildChess(state: Pick<GameState, 'startFen' | 'moves'>, ply = state.moves.length): Chess {
  const chess = new Chess(state.startFen);
  for (const m of state.moves.slice(0, ply)) chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  return chess;
}

export const fenAt = (state: GameState, ply: number): string =>
  ply <= 0 ? state.startFen : (state.moves[ply - 1]?.fen ?? state.startFen);

export const liveFen = (state: GameState): string => fenAt(state, state.moves.length);

export const isLive = (state: GameState): boolean => state.viewPly === state.moves.length;

function finish(state: GameState, result: GameResult, now: number): GameState {
  return {
    ...state,
    result,
    drawOfferBy: null,
    clock: state.clock ? stopClock(state.clock, now) : null,
  };
}

function applyMove(state: GameState, input: MoveInput, now: number): GameState {
  if (state.result) return state;
  if (state.clock) {
    const flagged = flaggedColor(state.clock, now);
    if (flagged) return finish(state, timeoutResult(buildChess(state), flagged), now);
  }
  const chess = buildChess(state);
  let move;
  try {
    move = chess.move({ from: input.from, to: input.to, promotion: input.promotion });
  } catch {
    return state; // illegal move: ignore
  }
  const record: MoveRecord = {
    san: move.san,
    from: move.from,
    to: move.to,
    color: move.color,
    fen: move.after,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
  const moves = [...state.moves, record];
  const next: GameState = {
    ...state,
    moves,
    viewPly: moves.length,
    clock: state.clock ? pressClock(state.clock, move.color, now) : null,
    // A move by the side that received an offer declines it implicitly.
    drawOfferBy: state.drawOfferBy && state.drawOfferBy !== move.color ? null : state.drawOfferBy,
  };
  const end = detectBoardEnd(chess);
  return end ? finish(next, end, now) : next;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'new':
      return createGame(action.setup, action.startFen, state.id + 1);
    case 'replace':
      return { ...action.state, id: state.id + 1 };
    case 'move':
      return applyMove(state, action, action.now);
    case 'tick': {
      if (state.result || !state.clock) return state;
      const flagged = flaggedColor(state.clock, action.now);
      return flagged ? finish(state, timeoutResult(buildChess(state), flagged), action.now) : state;
    }
    case 'resign':
      return state.result ? state : finish(state, resignResult(action.color), action.now);
    case 'offerDraw':
      return state.result || state.drawOfferBy ? state : { ...state, drawOfferBy: action.color };
    case 'acceptDraw':
      return state.result || !state.drawOfferBy ? state : finish(state, agreementResult(), action.now);
    case 'declineDraw':
      return { ...state, drawOfferBy: null };
    case 'view':
      return { ...state, viewPly: Math.max(0, Math.min(state.moves.length, action.ply)) };
  }
}

// ---------------------------------------------------------------- PGN / FEN

const pad = (n: number) => n.toString().padStart(2, '0');
const pgnDate = (d: Date) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

function playerName(setup: GameSetup, color: Color): string {
  if (setup.mode === 'local') return color === 'w' ? 'White' : 'Black';
  return color === setup.humanColor ? 'You' : `Computer (level ${setup.level})`;
}

export function exportPgn(state: GameState, date: Date = new Date()): string {
  const chess = buildChess(state);
  const tc = findTimeControl(state.setup.timeControlId);
  const headers: Record<string, string> = {
    Event: 'Casual game',
    Site: 'Local',
    Date: pgnDate(date),
    Round: '-',
    White: playerName(state.setup, 'w'),
    Black: playerName(state.setup, 'b'),
    ...state.headers,
    Result: state.result?.result ?? '*',
    TimeControl: tc ? `${tc.initialMs / 1000}+${tc.incrementMs / 1000}` : (state.headers.TimeControl ?? '-'),
  };
  if (state.result) headers.Termination = TERMINATION_LABEL[state.result.reason];
  if (state.startFen !== DEFAULT_POSITION) {
    headers.SetUp = '1';
    headers.FEN = state.startFen;
  }
  for (const [k, v] of Object.entries(headers)) chess.setHeader(k, v);
  return chess.pgn();
}

const RESULT_CODES: readonly string[] = ['1-0', '0-1', '1/2-1/2'];
const GENERATED_HEADERS = new Set(['Result', 'SetUp', 'FEN', 'Termination']);

/** Parses PGN into an untimed local game. Throws with a readable message on bad input. */
export function importPgn(text: string, setup: GameSetup): GameState {
  const chess = new Chess();
  try {
    chess.loadPgn(text.trim());
  } catch (e) {
    throw new Error(`Invalid PGN: ${e instanceof Error ? e.message : String(e)}`);
  }
  const history = chess.history({ verbose: true });
  const allHeaders = chess.getHeaders();
  const startFen = history[0]?.before ?? chess.fen();
  const moves: MoveRecord[] = history.map(m => ({
    san: m.san,
    from: m.from,
    to: m.to,
    color: m.color,
    fen: m.after,
    ...(m.promotion ? { promotion: m.promotion } : {}),
  }));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(allHeaders)) if (!GENERATED_HEADERS.has(k) && v) headers[k] = v;

  let result: GameResult | null = detectBoardEnd(chess);
  const tag = allHeaders.Result;
  if (!result && tag && RESULT_CODES.includes(tag)) {
    const code = tag as ResultCode;
    result = { result: code, winner: code === '1-0' ? 'w' : code === '0-1' ? 'b' : null, reason: 'imported' };
  }
  return {
    id: 0,
    setup: { ...setup, mode: 'local', timeControlId: null },
    startFen,
    moves,
    viewPly: moves.length,
    result,
    clock: null,
    drawOfferBy: null,
    headers,
  };
}

/** Throws with a readable message if the FEN is invalid. */
export function checkFen(fen: string): string {
  const trimmed = fen.trim();
  const v = validateFen(trimmed);
  if (!v.ok) throw new Error(`Invalid FEN: ${v.error ?? 'unknown error'}`);
  return trimmed;
}

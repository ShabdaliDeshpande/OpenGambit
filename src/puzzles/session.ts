import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import type { UciMove } from '../engine/search';
import type { Puzzle } from './types';

export type Phase =
  /** Showing the start position; the setup move is about to be played. */
  | 'setup'
  /** Waiting for the solver's move. */
  | 'playing'
  /** The solver moved correctly; the opponent's reply is about to be played. */
  | 'opponent'
  /** The solver's last move was wrong; it is shown until taken back. */
  | 'wrong'
  /** Playing out the remaining solution after "Show solution". */
  | 'revealing'
  | 'solved';

export interface PuzzleSession {
  puzzle: Puzzle;
  /** Increments for every new puzzle started; a retry keeps it, so results are recorded once per attempt. */
  attempt: number;
  solver: Color;
  /** Current position. */
  fen: string;
  /** Position before the wrong move, while phase is 'wrong'. */
  beforeWrong: string | null;
  /** Index of the next expected move in `puzzle.solution`. */
  step: number;
  phase: Phase;
  lastMove: { from: Square; to: Square } | null;
  /** True once the solver made a mistake, asked for a hint, or viewed the solution. */
  failed: boolean;
  hint: Square | null;
}

export type SessionAction =
  | { type: 'start'; puzzle: Puzzle }
  | { type: 'setupMove' }
  | { type: 'move'; move: UciMove }
  | { type: 'opponentMove' }
  | { type: 'takeBack' }
  | { type: 'hint' }
  | { type: 'reveal' }
  | { type: 'revealStep' }
  | { type: 'retry' };

const sameMove = (a: UciMove, b: UciMove) => a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

function play(fen: string, m: UciMove): { fen: string; checkmate: boolean } | null {
  const chess = new Chess(fen);
  try {
    chess.move(m);
  } catch {
    return null;
  }
  return { fen: chess.fen(), checkmate: chess.isCheckmate() };
}

export function startSession(puzzle: Puzzle, attempt = 0): PuzzleSession {
  const turn = new Chess(puzzle.fen).turn();
  return {
    puzzle,
    attempt,
    // with a setup move, the solver is the side that replies to it
    solver: puzzle.setup ? (turn === 'w' ? 'b' : 'w') : turn,
    fen: puzzle.fen,
    beforeWrong: null,
    step: 0,
    phase: puzzle.setup ? 'setup' : 'playing',
    lastMove: null,
    failed: false,
    hint: null,
  };
}

/** Plays the next solution move (used for the opponent's replies and when revealing). */
function advance(s: PuzzleSession, nextPhase: Phase): PuzzleSession {
  const m = s.puzzle.solution[s.step];
  if (!m) return { ...s, phase: 'solved' };
  const r = play(s.fen, m);
  if (!r) return s;
  const step = s.step + 1;
  return {
    ...s,
    fen: r.fen,
    step,
    lastMove: { from: m.from, to: m.to },
    hint: null,
    phase: step >= s.puzzle.solution.length ? 'solved' : nextPhase,
  };
}

export function sessionReducer(s: PuzzleSession, a: SessionAction): PuzzleSession {
  switch (a.type) {
    case 'start':
      return startSession(a.puzzle, s.attempt + 1);
    case 'retry':
      // a retry is practice: the attempt was already recorded
      return { ...startSession(s.puzzle, s.attempt), failed: true };
    case 'setupMove': {
      if (s.phase !== 'setup' || !s.puzzle.setup) return s;
      const r = play(s.fen, s.puzzle.setup);
      if (!r) return s;
      return { ...s, fen: r.fen, phase: 'playing', lastMove: { from: s.puzzle.setup.from, to: s.puzzle.setup.to } };
    }
    case 'move': {
      if (s.phase !== 'playing') return s;
      const expected = s.puzzle.solution[s.step];
      const r = play(s.fen, a.move);
      if (!expected || !r) return s;
      const isLast = s.step === s.puzzle.solution.length - 1;
      // on the final move any checkmate solves the puzzle, not only the stored one
      if (sameMove(a.move, expected) || (isLast && r.checkmate)) {
        const step = s.step + 1;
        return {
          ...s,
          fen: r.fen,
          step,
          lastMove: { from: a.move.from, to: a.move.to },
          hint: null,
          phase: step >= s.puzzle.solution.length ? 'solved' : 'opponent',
        };
      }
      return { ...s, beforeWrong: s.fen, fen: r.fen, lastMove: { from: a.move.from, to: a.move.to }, phase: 'wrong', failed: true, hint: null };
    }
    case 'opponentMove':
      return s.phase === 'opponent' ? advance(s, 'playing') : s;
    case 'takeBack':
      if (s.phase !== 'wrong' || !s.beforeWrong) return s;
      return { ...s, fen: s.beforeWrong, beforeWrong: null, phase: 'playing', lastMove: null };
    case 'hint': {
      if (s.phase !== 'playing') return s;
      const m = s.puzzle.solution[s.step];
      return m ? { ...s, hint: m.from, failed: true } : s;
    }
    case 'reveal': {
      if (s.phase === 'solved' || s.phase === 'revealing') return s;
      const base = s.phase === 'wrong' && s.beforeWrong ? { ...s, fen: s.beforeWrong, beforeWrong: null } : s;
      return { ...base, phase: 'revealing', failed: true, hint: null };
    }
    case 'revealStep':
      return s.phase === 'revealing' ? advance(s, 'revealing') : s;
  }
}

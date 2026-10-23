// Game review: judges each move from the engine's evaluation before and after
// it. Bad moves follow lila's rules (inaccuracy, mistake and blunder by the
// drop in winning chances, special cases for forced mates). The other classes
// (brilliant, great, best, excellent, good, book, miss) are this app's own,
// described in docs/lila-feature-map.md §13. Pure functions, easy to test.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import type { AnalysisLine } from '../engine/search.ts';
import { moveAccuracy, povCp, winningChances, type Score } from './accuracy.ts';

export { povCp, winningChances, type Score } from './accuracy.ts';

export type Kind = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

export const KINDS: readonly Kind[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

/** Classes that count as errors (jumps, retries, key moments). */
export const BAD_KINDS: readonly Kind[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];

export const KIND_LABEL: Record<Kind, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

/** Short marks shown next to moves. */
export const KIND_MARK: Record<Kind, string> = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '✓✓',
  good: '✓',
  book: '≡',
  inaccuracy: '?!',
  mistake: '?',
  miss: '×',
  blunder: '??',
};

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** A finished position the engine can't search: checkmate, or a draw. */
export function finalScore(fen: string): Score {
  const chess = new Chess(fen);
  return chess.isCheckmate() ? { mated: chess.turn() } : { cp: 0 };
}

/** The score of a position from the engine's best line (or the final result when there are no moves). */
export function scoreOf(line: Pick<AnalysisLine, 'cp' | 'mate'> | undefined, fen: string): Score {
  if (!line) return finalScore(fen);
  return line.mate !== null ? { mate: line.mate } : { cp: line.cp ?? 0 };
}

/** Whether `pov` has a forced mate (or has just delivered one). */
export const hasMate = (score: Score, pov: Color) =>
  ('mate' in score && (score.mate > 0) === (pov === 'w')) || ('mated' in score && score.mated !== pov);

export interface Judgement {
  kind: Kind;
  /** Drop in the mover's winning chances (0 to 2). */
  loss: number;
  /** 0–100, from the drop in win percentage (lila's accuracy curve). */
  accuracy: number;
}

/**
 * Judges a move by `mover` that turned `before` into `after` with lila's rules
 * for bad moves, and splits the rest into best, excellent and good.
 * `playedBest`: it was the engine's top choice.
 */
export function judge(before: Score, after: Score, mover: Color, playedBest: boolean): Judgement {
  const cb = winningChances(before, mover);
  const ca = winningChances(after, mover);
  const loss = Math.max(0, cb - ca);
  const accuracy = moveAccuracy(50 + 50 * cb, 50 + 50 * ca);

  // forced mates, as lila judges them
  const mateCreated = !hasMate(before, other(mover)) && hasMate(after, other(mover));
  const mateLost = hasMate(before, mover) && !hasMate(after, mover);
  let kind: Kind;
  if (mateCreated) {
    const was = povCp(before, mover);
    kind = was < -999 ? 'inaccuracy' : was < -700 ? 'mistake' : 'blunder';
  } else if (mateLost) {
    const now = 'cp' in after ? povCp(after, mover) : 0;
    kind = now > 999 ? 'inaccuracy' : now > 700 ? 'mistake' : 'blunder';
  } else if (loss >= 0.3) kind = 'blunder';
  else if (loss >= 0.2) kind = 'mistake';
  else if (loss >= 0.1) kind = 'inaccuracy';
  else if (playedBest || loss <= 0.01) kind = 'best';
  else if (loss < 0.04) kind = 'excellent';
  else kind = 'good';
  return { kind, loss, accuracy };
}

export interface MoveFacts {
  before: Score;
  after: Score;
  mover: Color;
  playedBest: boolean;
  /** The score of the engine's second choice in the position before, when it was searched. */
  second?: Score | null;
  /** The class of the opponent's previous move. */
  previous?: Kind | null;
  /** The move is opening theory (from imported master games). */
  book?: boolean;
  /** Material the move gives up by exchanges, in pawns (`materialOffered`); a function is only called when needed. */
  offered?: number | (() => number);
}

/** A move gives up at least this much (pawns) to count as a sacrifice: a piece for a pawn, or more. */
export const SACRIFICE = 2;

/**
 * The full class of a move. Checked in this order: book; lila's bad-move
 * rules, with a missed chance to punish the opponent's mistake (or a lost mate
 * while still clearly winning) called a miss; a sacrifice that the engine
 * likes is brilliant; the only move that holds is great; then best, excellent
 * and good.
 */
export function classify(f: MoveFacts): Judgement {
  const base = judge(f.before, f.after, f.mover, f.playedBest);
  if (f.book) return { ...base, kind: 'book' };
  if (base.kind === 'blunder') return base;

  const punishable = f.previous === 'mistake' || f.previous === 'blunder';
  const lostMate = hasMate(f.before, f.mover) && !hasMate(f.after, f.mover);
  if ((base.kind === 'inaccuracy' || base.kind === 'mistake') && punishable) return { ...base, kind: 'miss' };
  if (base.kind === 'inaccuracy' && lostMate) return { ...base, kind: 'miss' };

  const nearBest = f.playedBest || base.loss <= 0.02;
  if ((base.kind === 'best' || base.kind === 'excellent') && nearBest) {
    const cb = winningChances(f.before, f.mover);
    const ca = winningChances(f.after, f.mover);
    const offered = () => (typeof f.offered === 'function' ? f.offered() : (f.offered ?? 0));
    if (cb < 0.8 && ca >= 0 && offered() >= SACRIFICE) return { ...base, kind: 'brilliant' };
    if (f.playedBest && f.second && cb - winningChances(f.second, f.mover) >= 0.2) return { ...base, kind: 'great' };
  }
  return base;
}

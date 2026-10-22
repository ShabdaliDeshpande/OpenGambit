// "Retry your mistakes", after lila's Learn from your mistakes: the board goes
// back to the position before each error, and a try is accepted if it keeps
// the winning chances within 0.04 of the best (docs/lila-feature-map.md §13).

import type { Color } from 'chess.js';
import { winningChances, type Score } from './accuracy';
import type { UciLike } from './material';
import type { ReviewedMove } from './gameReview';
import { BAD_KINDS } from './review';

/** How close to the position's evaluation a try must stay to count as solved. */
export const RETRY_TOLERANCE = 0.04;

/** The errors `color` can retry, in game order (book moves are never errors). */
export const retryCandidates = (reviewed: readonly ReviewedMove[], color: Color) =>
  reviewed.filter(m => m.color === color && BAD_KINDS.includes(m.judgement.kind) && m.before.best);

const same = (a: UciLike | null | undefined, b: UciLike) => !!a && a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

export type TryVerdict = 'win' | 'fail' | 'check';

/**
 * A first look at a try: the engine's move wins at once, the game move fails
 * at once, anything else needs the engine (`check`).
 */
export function quickVerdict(fault: ReviewedMove, attempt: UciLike): TryVerdict {
  if (same(fault.before.best, attempt)) return 'win';
  if (same(fault.uci, attempt)) return 'fail';
  return 'check';
}

/** The verdict once the position after the try has been evaluated. */
export function judgeTry(fault: ReviewedMove, after: Score): 'win' | 'fail' {
  return winningChances(after, fault.color) - winningChances(fault.before.score, fault.color) > -RETRY_TOLERANCE ? 'win' : 'fail';
}

export interface RetryState {
  color: Color;
  /** Plies of the errors to retry, in order. */
  plies: number[];
  index: number;
  solved: number[];
  /** find: waiting for a move; checking: engine is judging it; win / fail: result shown; view: answer shown; done: all through. */
  status: 'find' | 'checking' | 'win' | 'fail' | 'view' | 'done';
  /** The position on the board after the player's try (or the answer). */
  tryFen: string | null;
}

export function startRetry(reviewed: readonly ReviewedMove[], color: Color): RetryState {
  const plies = retryCandidates(reviewed, color).map(m => m.ply);
  return { color, plies, index: 0, solved: [], status: plies.length ? 'find' : 'done', tryFen: null };
}

export type RetryAction =
  | { type: 'try'; fen: string; verdict: TryVerdict }
  | { type: 'checked'; verdict: 'win' | 'fail' }
  | { type: 'again' }
  | { type: 'show'; fen: string }
  | { type: 'next' };

export function retryReducer(s: RetryState, a: RetryAction): RetryState {
  const ply = s.plies[s.index];
  switch (a.type) {
    case 'try':
      if (s.status !== 'find' && s.status !== 'fail') return s;
      if (a.verdict === 'check') return { ...s, status: 'checking', tryFen: a.fen };
      return { ...s, status: a.verdict, tryFen: a.fen, solved: a.verdict === 'win' && ply !== undefined ? [...s.solved, ply] : s.solved };
    case 'checked':
      if (s.status !== 'checking') return s;
      return { ...s, status: a.verdict, solved: a.verdict === 'win' && ply !== undefined ? [...s.solved, ply] : s.solved };
    case 'again':
      return { ...s, status: 'find', tryFen: null };
    case 'show':
      return { ...s, status: 'view', tryFen: a.fen };
    case 'next': {
      const index = s.index + 1;
      return { ...s, index, status: index < s.plies.length ? 'find' : 'done', tryFen: null };
    }
  }
}

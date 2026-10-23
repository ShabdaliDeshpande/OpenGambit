// Explains a puzzle's solution move by move, with the same review and wording
// as Game Review: the positions along the solution are analysed, the solver's
// moves classified, and each one described. Pure: the evaluations come in.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import { reviewMoves, type GameMove, type PositionEval } from '../analysis/gameReview';
import { explainMove } from '../analysis/explain';
import { KIND_LABEL, type Kind } from '../analysis/review';
import type { Puzzle } from '../puzzles/types';

/** The position the solver faces, after the opponent's setup move. */
export function puzzleStart(puzzle: Puzzle): string {
  const chess = new Chess(puzzle.fen);
  if (puzzle.setup) chess.move(puzzle.setup);
  return chess.fen();
}

/** The solution as game moves, from the solver's first move. */
export function solutionMoves(puzzle: Puzzle): GameMove[] {
  const chess = new Chess(puzzleStart(puzzle));
  return puzzle.solution.map((uci, i) => {
    const fenBefore = chess.fen();
    const color = chess.turn();
    const san = chess.move(uci).san;
    return { ply: i + 1, color, fenBefore, fenAfter: chess.fen(), uci, san };
  });
}

export interface ExplainedMove {
  ply: number;
  san: string;
  kind: Kind;
  label: string;
  text: string;
}

/**
 * One explanation per solver move. `evals[i]` is the engine's view of the
 * position before solution move i; the last one is the final position.
 */
export function explainSolution(puzzle: Puzzle, evals: readonly (PositionEval | undefined)[]): ExplainedMove[] {
  const moves = solutionMoves(puzzle);
  const solver: Color | undefined = moves[0]?.color;
  return reviewMoves(moves, evals)
    .filter(m => m.color === solver)
    .map(m => ({ ply: m.ply, san: m.san, kind: m.judgement.kind, label: KIND_LABEL[m.judgement.kind], text: explainMove(m) }));
}

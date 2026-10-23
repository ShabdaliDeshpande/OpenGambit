// Endgame practice: positions you play against the engine, each with a goal,
// using the goal types of lila's practice chapters (mate, mate within N
// moves, promote, hold the draw for N moves). Each of your moves is graded
// with lila's practice thresholds on the drop in winning chances. Pure.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import { winningChances, type Score } from '../analysis/accuracy';

export type EndgameGoal =
  | { kind: 'mate'; within: number }
  | { kind: 'promote'; within: number }
  | { kind: 'hold'; moves: number };

export interface Endgame {
  id: string;
  title: string;
  /** What to do and the idea that does it. */
  task: string;
  fen: string;
  goal: EndgameGoal;
  hint: string;
}

export const ENDGAMES: readonly Endgame[] = [
  {
    id: 'kq-k',
    title: 'Queen and king against king',
    task: 'Checkmate within 10 moves. Use the queen to shrink the king’s box, then bring your own king up to help.',
    fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1',
    goal: { kind: 'mate', within: 10 },
    hint: 'Keep a knight’s move away from the king with the queen, so it’s never stalemate.',
  },
  {
    id: 'krr-k',
    title: 'Two rooks against king',
    task: 'Checkmate within 8 moves. The rooks take turns checking, pushing the king to the edge.',
    fen: '8/8/3k4/8/8/8/8/R3K2R w - - 0 1',
    goal: { kind: 'mate', within: 8 },
    hint: 'One rook cuts off a row, the other gives check on the next row.',
  },
  {
    id: 'kr-k',
    title: 'Rook and king against king',
    task: 'Checkmate within 16 moves. The rook cuts the king off; your king walks up and takes the opposition.',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    goal: { kind: 'mate', within: 16 },
    hint: 'Check only when the kings face each other.',
  },
  {
    id: 'kp-k-win',
    title: 'Promote the pawn',
    task: 'Promote the pawn within 8 moves. Your king is in front of the pawn, so it wins: escort it.',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    goal: { kind: 'promote', within: 8 },
    hint: 'Keep your king beside or in front of the pawn; push when the black king has to step aside.',
  },
  {
    id: 'k-kp-hold',
    title: 'Hold the draw',
    task: 'Black has an extra pawn. Hold the draw for 10 moves by keeping your king in front of it.',
    fen: '8/8/8/8/4k3/4p3/8/4K3 w - - 0 1',
    goal: { kind: 'hold', moves: 10 },
    hint: 'Stay on the pawn’s file; when the black king comes forward, face it (take the opposition).',
  },
];

export type Verdict = 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** lila's practice grading: the drop in your winning chances. */
export function practiceVerdict(before: Score, after: Score, you: Color): Verdict {
  const shift = winningChances(before, you) - winningChances(after, you);
  if (shift < 0.025) return 'good';
  if (shift < 0.06) return 'inaccuracy';
  if (shift < 0.14) return 'mistake';
  return 'blunder';
}

export type Outcome = 'playing' | 'won' | 'lost';

/**
 * Where a practice game stands after `yourMoves` of your moves: `fen` is the
 * position now, `score` the engine's evaluation of it (White's view).
 */
export function endgameOutcome(goal: EndgameGoal, fen: string, yourMoves: number, you: Color, promoted: boolean, score: Score | null): { outcome: Outcome; message: string | null } {
  const chess = new Chess(fen);
  const mated = chess.isCheckmate();
  const loser = chess.turn();
  const over = chess.isGameOver();
  const yourChances = score ? winningChances(score, you) : 0;
  switch (goal.kind) {
    case 'mate':
      if (mated && loser !== you) return { outcome: 'won', message: `Checkmate in ${yourMoves} move${yourMoves === 1 ? '' : 's'}!` };
      if (chess.isStalemate()) return { outcome: 'lost', message: 'Stalemate: a draw. Leave the king a square when you aren’t giving check.' };
      if (over) return { outcome: 'lost', message: 'The game ended without checkmate.' };
      if (yourMoves >= goal.within) return { outcome: 'lost', message: `No mate within ${goal.within} moves. Try again: it can be done.` };
      return { outcome: 'playing', message: null };
    case 'promote':
      if (promoted) return yourChances > 0.3 ? { outcome: 'won', message: 'Promoted!' } : { outcome: 'lost', message: 'Promoted, but the new queen is lost. Try again.' };
      if (!chess.board().some(row => row.some(p => p?.type === 'p' && p.color === you))) return { outcome: 'lost', message: 'The pawn was lost.' };
      if (over) return { outcome: 'lost', message: 'The game ended before the pawn promoted.' };
      if (yourMoves >= goal.within) return { outcome: 'lost', message: `The pawn didn’t promote within ${goal.within} moves.` };
      return { outcome: 'playing', message: null };
    case 'hold':
      if (mated && loser === you) return { outcome: 'lost', message: 'Checkmated.' };
      if (over) return { outcome: 'won', message: 'Draw: you held it.' };
      if (score && yourChances < -0.5) return { outcome: 'lost', message: 'Black is winning now: the pawn will get through.' };
      if (yourMoves >= goal.moves) return { outcome: 'won', message: `You held the position for ${goal.moves} moves.` };
      return { outcome: 'playing', message: null };
  }
}

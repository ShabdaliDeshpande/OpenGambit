// The computer's opening book: in the first moves, from the standard start,
// it plays what masters played, picking moves in proportion to how often
// they were played (each needs at least two games). Needs imported master
// games on the server; without them, or offline, the engine plays as usual.

import type { Counts } from './format';

/** Plies (half-moves) the book is used for. */
export const BOOK_PLIES = 16;

/** Levels below this play their own moves from the start, as a beginner would. */
export const BOOK_MIN_LEVEL = 3;

export interface BookCandidate extends Counts {
  uci: string;
}

export function pickBookMove(moves: readonly BookCandidate[], rng: () => number = Math.random): string | null {
  const choices = moves.map(m => ({ uci: m.uci, games: m.white + m.draws + m.black })).filter(m => m.games >= 2);
  const total = choices.reduce((s, m) => s + m.games, 0);
  if (total === 0) return null;
  let r = rng() * total;
  for (const m of choices) {
    r -= m.games;
    if (r < 0) return m.uci;
  }
  return choices[choices.length - 1]!.uci;
}

/** Whether the book applies to this game and move. */
export const bookApplies = (level: number, ply: number, standardStart: boolean) => standardStart && level >= BOOK_MIN_LEVEL && ply < BOOK_PLIES;

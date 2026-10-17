import type { UciMove } from '../engine/search';

export interface Puzzle {
  id: string;
  /** Position the puzzle starts from (before `setup`, if there is one). */
  fen: string;
  /** Opponent move played first to show how the position arose; optional. */
  setup?: UciMove;
  /** Alternating moves after the setup, starting and ending with the solver's move. */
  solution: UciMove[];
  /** Estimated difficulty on a rating-like scale. */
  rating: number;
  themes: string[];
  source: 'builtin' | 'imported';
}

import type { PieceSymbol, Square } from 'chess.js';

/** A move in UCI terms (the same shape the engine uses); kept here so the server can load puzzles without the engine. */
export interface UciMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

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

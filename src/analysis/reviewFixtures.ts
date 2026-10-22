// Helpers for review tests: a game from SAN moves, and evaluations written by hand.

import { Chess } from 'chess.js';
import type { GameMove, PositionEval } from './gameReview';
import type { UciLike } from './material';
import type { Score } from './accuracy';

export function gameOf(sans: readonly string[], start?: string): GameMove[] {
  const chess = new Chess(start);
  return sans.map((san, i) => {
    const fenBefore = chess.fen();
    const m = chess.move(san);
    return {
      ply: i + 1,
      color: m.color,
      fenBefore,
      fenAfter: chess.fen(),
      uci: { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) },
      san: m.san,
    };
  });
}

export const uci = (text: string): UciLike => ({ from: text.slice(0, 2), to: text.slice(2, 4), ...(text[4] ? { promotion: text[4] } : {}) });

/** An evaluation: score, then the engine's line in UCI (the first move is its choice). */
export function at(score: Score, line: string[] = [], second: Score | null = null): PositionEval {
  const pv = line.map(uci);
  return { score, best: pv[0] ?? null, second, pv };
}

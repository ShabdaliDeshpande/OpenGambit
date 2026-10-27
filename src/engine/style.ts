// Playing styles for the bots (Phase 16). A style adds a few terms to the
// evaluation, seen from the bot's side only, and a few bonuses when the bot
// picks its move at the root. The engine's levels and analysis use no style.
// Every term and value here was written for this project.

import { Board, KING, PAWN } from './board.ts';

export interface PlayStyle {
  /** Centipawns per point of pressure on the opponent's king (own pieces close to it). */
  kingAttack?: number;
  /** Centipawns per point of cover around the bot's own king (pawns and pieces next to it). */
  kingGuard?: number;
  /** Centipawns for every 100 of non-pawn material traded off the board. */
  trades?: number;
  /** Extra weight on the material balance, in percent. */
  greed?: number;
  /** Root bonus for a move that gives check. */
  checks?: number;
  /** Root bonus, up to this much, for a move whose tempting replies lose (see trapValue in search.ts). */
  traps?: number;
}

// material for the style terms only, by piece code
const WORTH = [0, 100, 320, 330, 500, 900, 0];

/** Whether a style changes the evaluation (root bonuses alone don't). */
export const changesEvaluation = (s: PlayStyle) => !!(s.kingAttack || s.kingGuard || s.trades || s.greed);

const distance = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));

/**
 * The style's extra evaluation in centipawns from White's point of view, for
 * a bot playing `botSide` (1 White, -1 Black). Pure; reads the board only.
 */
export function styleTerms(b: Board, botSide: number, s: PlayStyle): number {
  const sq = b.sq;
  const ownKing = b.kings[botSide]!;
  const theirKing = b.kings[-botSide]!;
  let pressure = 0;
  let cover = 0;
  let balance = 0;
  let pieces = 0;
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const at = rank * 16 + file;
      const p = sq[at]!;
      if (!p) continue;
      const type = Math.abs(p);
      const mine = (p > 0 ? 1 : -1) === botSide;
      balance += mine ? WORTH[type]! : -WORTH[type]!;
      if (type !== PAWN && type !== KING) pieces += WORTH[type]!;
      if (!mine || type === KING) continue;
      if (type !== PAWN && theirKing >= 0) pressure += Math.max(0, 4 - distance(at, theirKing));
      if (ownKing >= 0 && distance(at, ownKing) <= 1) cover += type === PAWN ? 2 : 1;
    }
  const value =
    (s.kingAttack ?? 0) * pressure +
    (s.kingGuard ?? 0) * cover +
    ((s.greed ?? 0) * balance) / 100 -
    ((s.trades ?? 0) * pieces) / 100;
  const v = Math.round(value);
  return v === 0 ? 0 : botSide * v;
}

// Material and simple tactics, for move classes and explanations: static
// exchange on a square, pieces left hanging, forks and pins. These are quick
// approximations on top of chess.js, not a search.

import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const PIECE_NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export interface UciLike {
  from: string;
  to: string;
  promotion?: string;
}

/** A board that ignores whose turn it is, for counting attackers. */
const looseBoard = (fen: string) => new Chess(fen, { skipValidation: true });

/** The cheapest piece of `side` attacking `sq` (kings last). */
function cheapestAttacker(chess: Chess, sq: Square, side: Color): Square | null {
  let best: Square | null = null;
  let bestValue = Infinity;
  for (const from of chess.attackers(sq, side)) {
    const p = chess.get(from);
    if (p && PIECE_VALUE[p.type] < bestValue) {
      best = from;
      bestValue = PIECE_VALUE[p.type];
    }
  }
  return best;
}

/**
 * What `side` wins by capturing on `sq` and letting the exchange run, each
 * side taking with its cheapest piece and free to stop (pawns, never less than
 * 0). Pins and checks are ignored.
 */
export function exchangeGain(fen: string, sq: Square, side: Color): number {
  const chess = looseBoard(fen);
  const target = chess.get(sq);
  if (!target || target.color === side) return 0;
  const gains: number[] = [PIECE_VALUE[target.type]];
  let mover = side;
  let from = cheapestAttacker(chess, sq, mover);
  if (!from) return 0;
  for (;;) {
    const piece = chess.get(from)!;
    chess.remove(from);
    chess.remove(sq);
    chess.put(piece, sq);
    mover = other(mover);
    const next = cheapestAttacker(chess, sq, mover);
    if (!next) break;
    // a king can't take a defended piece
    if (chess.get(next)?.type === 'k' && chess.attackers(sq, other(mover)).length > 0) break;
    gains.push(PIECE_VALUE[piece.type] - gains[gains.length - 1]!);
    from = next;
  }
  for (let d = gains.length - 1; d > 0; d--) gains[d - 1] = -Math.max(-gains[d - 1]!, gains[d]!);
  return Math.max(0, gains[0]!);
}

/** Material of `side` minus the other side's, in pawns (kings left out). */
export function materialBalance(fen: string, side: Color): number {
  let total = 0;
  for (const row of new Chess(fen).board())
    for (const p of row) if (p && p.type !== 'k') total += (p.color === side ? 1 : -1) * PIECE_VALUE[p.type];
  return total;
}

/** The biggest exchange gain the opponent of `side` has against any of `side`'s pieces. */
function worstHanging(fen: string, side: Color): { square: Square; gain: number } | null {
  let worst: { square: Square; gain: number } | null = null;
  for (const row of new Chess(fen).board())
    for (const p of row) {
      if (!p || p.color !== side || p.type === 'k') continue;
      const gain = exchangeGain(fen, p.square, other(side));
      if (gain > 0 && (!worst || gain > worst.gain)) worst = { square: p.square, gain };
    }
  return worst;
}

/** The position after `move`, or null when it isn't legal. */
export function afterMove(fen: string, move: UciLike): { fen: string; san: string; captured?: PieceSymbol; piece: PieceSymbol } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    return { fen: chess.fen(), san: m.san, piece: m.piece, ...(m.captured ? { captured: m.captured } : {}) };
  } catch {
    return null;
  }
}

/**
 * Material a move offers up, in pawns: what the opponent can win by exchanges
 * after it (on the moved piece's square, or on a piece newly left hanging),
 * less anything the move captured. 0 when nothing is given away.
 */
export function materialOffered(fen: string, move: UciLike): number {
  const mover = new Chess(fen).turn();
  const next = afterMove(fen, move);
  if (!next) return 0;
  const taken = next.captured ? PIECE_VALUE[next.captured] : 0;
  const promoted = move.promotion ? PIECE_VALUE[move.promotion as PieceSymbol] - 1 : 0;
  const onSquare = exchangeGain(next.fen, move.to as Square, other(mover));
  const hangingBefore = worstHanging(fen, mover)?.gain ?? 0;
  const hangingAfter = worstHanging(next.fen, mover)?.gain ?? 0;
  return Math.max(0, onSquare - taken - promoted, hangingAfter - hangingBefore - taken);
}

/** A piece of `side` that can be won by exchanges, the most valuable one first. */
export function hangingPiece(fen: string, side: Color): { square: Square; type: PieceSymbol; gain: number } | null {
  const worst = worstHanging(fen, side);
  if (!worst) return null;
  const p = new Chess(fen).get(worst.square);
  return p ? { square: worst.square, type: p.type, gain: worst.gain } : null;
}

/**
 * Pieces of the opponent that the piece on `sq` attacks and can win: the king,
 * anything worth more than the attacker, or anything undefended.
 */
export function forkTargets(fen: string, sq: Square): { square: Square; type: PieceSymbol }[] {
  const chess = looseBoard(fen);
  const attacker = chess.get(sq);
  if (!attacker) return [];
  const them = other(attacker.color);
  const out: { square: Square; type: PieceSymbol }[] = [];
  for (const row of chess.board())
    for (const p of row) {
      if (!p || p.color !== them) continue;
      if (!chess.attackers(p.square, attacker.color).includes(sq)) continue;
      const defended = chess.attackers(p.square, them).length > 0;
      if (p.type === 'k' || PIECE_VALUE[p.type] > PIECE_VALUE[attacker.type] || !defended) out.push({ square: p.square, type: p.type });
    }
  return out;
}

const RAYS: Record<'b' | 'r', [number, number][]> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
};

const squareAt = (file: number, rank: number) =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? ((String.fromCharCode(97 + file) + (rank + 1)) as Square) : null;

/** A pin made by the slider on `sq`: an enemy piece that can't move without exposing its king or queen. */
export function pinBy(fen: string, sq: Square): { pinned: Square; type: PieceSymbol; behind: PieceSymbol } | null {
  const chess = looseBoard(fen);
  const slider = chess.get(sq);
  if (!slider || !['b', 'r', 'q'].includes(slider.type)) return null;
  const dirs = slider.type === 'q' ? [...RAYS.b, ...RAYS.r] : RAYS[slider.type as 'b' | 'r'];
  const [f0, r0] = [sq.charCodeAt(0) - 97, Number(sq[1]) - 1];
  for (const [df, dr] of dirs) {
    let first: { square: Square; type: PieceSymbol } | null = null;
    for (let k = 1; k < 8; k++) {
      const s = squareAt(f0 + df * k, r0 + dr * k);
      if (!s) break;
      const p = chess.get(s);
      if (!p) continue;
      if (p.color === slider.color) break;
      if (!first) {
        if (p.type === 'k') break;
        first = { square: s, type: p.type };
        continue;
      }
      if ((p.type === 'k' || (p.type === 'q' && slider.type !== 'q')) && PIECE_VALUE[first.type] < PIECE_VALUE[p.type])
        return { pinned: first.square, type: first.type, behind: p.type };
      break;
    }
  }
  return null;
}

/** The material change for `side` after playing `line` from `fen`, carried on while captures continue (at most `plies` moves). */
export function lineMaterial(fen: string, line: readonly UciLike[], side: Color, plies = 6): number {
  const start = materialBalance(fen, side);
  let current = fen;
  let settled = start;
  for (let i = 0; i < line.length && i < plies + 2; i++) {
    const next = afterMove(current, line[i]!);
    if (!next) break;
    current = next.fen;
    // count the material once a quiet move follows, so an exchange in progress isn't cut in half
    const quietNext = i + 1 >= line.length || !afterMove(current, line[i + 1]!)?.captured;
    if (quietNext) settled = materialBalance(current, side);
    if (i + 1 >= plies && quietNext) break;
  }
  return settled - start;
}

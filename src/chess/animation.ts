import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

/** A piece that slides from one square to another. */
export interface Slide {
  from: Square;
  to: Square;
}

/**
 * The sound for a board change that is `lastMove` played forward: a capture,
 * a check, or a plain move. Null for anything else (loading, jumping back).
 */
export function moveSoundFor(
  prevFen: string | null,
  nextFen: string,
  lastMove: { from: Square; to: Square } | null,
): 'move' | 'capture' | 'check' | null {
  if (slidesFor(prevFen, nextFen, lastMove).length === 0 || !lastMove || !prevFen) return null;
  const before = new Chess(prevFen);
  const after = new Chess(nextFen);
  if (after.inCheck()) return 'check';
  const mover = before.get(lastMove.from);
  const enPassant = mover?.type === 'p' && lastMove.from[0] !== lastMove.to[0] && !before.get(lastMove.to);
  return before.get(lastMove.to) || enPassant ? 'capture' : 'move';
}

/**
 * The pieces to animate when the board goes from `prevFen` to `nextFen`:
 * the moved piece, plus the rook when castling. Nothing is returned unless
 * the change is exactly `lastMove` played forward, so jumping around in a
 * game or loading a new one doesn't animate.
 */
export function slidesFor(prevFen: string | null, nextFen: string, lastMove: { from: Square; to: Square } | null): Slide[] {
  if (!prevFen || !lastMove || prevFen === nextFen) return [];
  let before: Chess;
  let after: Chess;
  try {
    before = new Chess(prevFen);
    after = new Chess(nextFen);
  } catch {
    return [];
  }
  const piece = before.get(lastMove.from);
  const landed = after.get(lastMove.to);
  if (!piece || !landed || piece.color !== landed.color || after.get(lastMove.from)) return [];
  // the next position must follow from the previous one by this move
  const legal = before.moves({ verbose: true }).some(m => m.from === lastMove.from && m.to === lastMove.to);
  if (!legal) return [];

  const slides: Slide[] = [{ from: lastMove.from, to: lastMove.to }];
  const fileOf = (s: Square) => s.charCodeAt(0) - 97;
  if (piece.type === 'k' && Math.abs(fileOf(lastMove.to) - fileOf(lastMove.from)) === 2) {
    const rank = lastMove.from[1];
    const kingside = fileOf(lastMove.to) > fileOf(lastMove.from);
    slides.push(kingside ? { from: `h${rank}` as Square, to: `f${rank}` as Square } : { from: `a${rank}` as Square, to: `d${rank}` as Square });
  }
  return slides;
}

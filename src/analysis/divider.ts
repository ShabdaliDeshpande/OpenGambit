// Splits a game into opening, middlegame and endgame. scalachess's divider
// isn't in the lila clone, so this rule is our own (docs/lila-feature-map.md §13):
// the middlegame starts once most minor pieces have left their starting
// squares (or at ply 30), the endgame once the pieces other than pawns and
// kings add up to 26 or less (queen 9, rook 5, bishop and knight 3).

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export const PHASES: readonly GamePhase[] = ['opening', 'middlegame', 'endgame'];

export interface Division {
  /** First ply of the middlegame, or null if the game never got there. */
  middle: number | null;
  /** First ply of the endgame, or null. */
  end: number | null;
}

const MINOR_HOMES: Record<string, string> = { b1: 'N', g1: 'N', c1: 'B', f1: 'B', b8: 'n', g8: 'n', c8: 'b', f8: 'b' };
const VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };

/** Pieces on each square of a FEN's board, e.g. { e1: 'K', e8: 'k' }. */
function placement(fen: string): Map<string, string> {
  const out = new Map<string, string>();
  const rows = (fen.split(' ')[0] ?? '').split('/');
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else out.set(String.fromCharCode(97 + file++) + (8 - i), ch);
    }
  });
  return out;
}

const minorsAtHome = (board: Map<string, string>) => Object.entries(MINOR_HOMES).filter(([sq, p]) => board.get(sq) === p).length;

const pieceMaterial = (board: Map<string, string>) => [...board.values()].reduce((s, p) => s + (VALUE[p.toLowerCase()] ?? 0), 0);

/** The division of a game, from the FEN of every position (index = ply, 0 = start). */
export function divide(fens: readonly string[]): Division {
  let middle: number | null = null;
  let end: number | null = null;
  fens.forEach((fen, ply) => {
    if (ply === 0) return;
    const board = placement(fen);
    if (end === null && pieceMaterial(board) <= 26) end = ply;
    if (middle === null && (minorsAtHome(board) <= 3 || ply >= 30 || end !== null)) middle = ply;
  });
  return { middle, end };
}

/** The phase that the move reaching `ply` belongs to. */
export function phaseOf(ply: number, div: Division): GamePhase {
  if (div.end !== null && ply >= div.end) return 'endgame';
  if (div.middle !== null && ply >= div.middle) return 'middlegame';
  return 'opening';
}

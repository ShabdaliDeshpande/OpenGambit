// The key the opening explorer files a position under: the FEN without its
// move counters, and with the en-passant square only when a pawn could
// really take there. So the same position reached by different move orders
// gets the same key. No imports: the browser, the server and the importer
// scripts all use it.

const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The piece on a square ("e4") of a FEN board field, or ''. */
function pieceAt(placement: string, square: string): string {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const row = placement.split('/')[8 - rank] ?? '';
  let f = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) f += Number(ch);
    else {
      if (f === file) return ch;
      f++;
    }
  }
  return '';
}

export function positionKey(fen: string): string {
  const [placement = '', side = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/);
  let epKept = '-';
  if (/^[a-h][36]$/.test(ep)) {
    // a pawn of the side to move must stand next to the pawn that just moved
    const pawn = side === 'w' ? 'P' : 'p';
    const rank = side === 'w' ? '5' : '4';
    const file = ep.charCodeAt(0);
    for (const f of [file - 1, file + 1])
      if (f >= 97 && f <= 104 && pieceAt(placement, String.fromCharCode(f) + rank) === pawn) epKept = ep;
  }
  return `${placement} ${side} ${castling || '-'} ${epKept}`;
}

export const START_KEY = positionKey(STANDARD_START);

/** Whether a FEN is the standard starting position (the explorer only covers games from it). */
export const isStandardStart = (fen: string) => positionKey(fen) === START_KEY;

/** "2026-10" for a timestamp, the month a game counts under in "My games". */
export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

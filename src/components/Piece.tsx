import type { Color, PieceSymbol } from 'chess.js';

// The solid glyph set is used for both colors; CSS fills and outlines them.
// U+FE0E asks for text (not emoji) presentation.
const GLYPH: Record<PieceSymbol, string> = {
  k: '♚︎',
  q: '♛︎',
  r: '♜︎',
  b: '♝︎',
  n: '♞︎',
  p: '♟︎',
};

const NAME: Record<PieceSymbol, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

export function Piece({ color, type, ghost = false }: { color: Color; type: PieceSymbol; ghost?: boolean }) {
  return (
    <span
      className={`piece ${color === 'w' ? 'white' : 'black'}${ghost ? ' ghost' : ''}`}
      role="img"
      aria-label={`${color === 'w' ? 'white' : 'black'} ${NAME[type]}`}
    >
      {GLYPH[type]}
    </span>
  );
}

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

interface Props {
  color: Color;
  type: PieceSymbol;
  ghost?: boolean;
  /** Animate in from this offset, in % of the board width. */
  slide?: { dx: number; dy: number } | null;
}

export function Piece({ color, type, ghost = false, slide = null }: Props) {
  return (
    <span
      className={`piece ${color === 'w' ? 'white' : 'black'}${ghost ? ' ghost' : ''}${slide ? ' sliding' : ''}`}
      style={slide ? ({ '--dx': `${slide.dx}cqw`, '--dy': `${slide.dy}cqw` } as React.CSSProperties) : undefined}
      role="img"
      aria-label={`${color === 'w' ? 'white' : 'black'} ${NAME[type]}`}
    >
      {GLYPH[type]}
    </span>
  );
}

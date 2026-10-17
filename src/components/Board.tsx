import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { Piece } from './Piece';
import { PromotionPicker } from './PromotionPicker';

const FILES = 'abcdefgh';

export interface Arrow {
  from: Square;
  to: Square;
  /** 'best' is drawn strong, 'alt' faint. */
  tone: 'best' | 'alt';
}

export interface BoardProps {
  fen: string;
  orientation: Color;
  /** Side allowed to move pieces, or null when the board is read-only. */
  movableColor: Color | null;
  lastMove: { from: Square; to: Square } | null;
  onMove: (from: Square, to: Square, promotion?: PieceSymbol) => void;
  arrows?: Arrow[];
  /** Squares to highlight (e.g. a hint). */
  marks?: Square[];
}

/** Center of a square in board units (0..8), as seen with `orientation` at the bottom. */
function squareCenter(sq: Square, orientation: Color) {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return orientation === 'w' ? { x: file + 0.5, y: 7 - rank + 0.5 } : { x: 7 - file + 0.5, y: rank + 0.5 };
}

function ArrowLayer({ arrows, orientation }: { arrows: Arrow[]; orientation: Color }) {
  return (
    <svg className="arrows" viewBox="0 0 8 8" aria-hidden="true">
      <defs>
        {(['best', 'alt'] as const).map(tone => (
          <marker key={tone} id={`arrowhead-${tone}`} viewBox="0 0 4 4" markerWidth="2.6" markerHeight="2.6" refX="2" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 z" className={`arrowhead ${tone}`} />
          </marker>
        ))}
      </defs>
      {arrows.map(({ from, to, tone }) => {
        const a = squareCenter(from, orientation);
        const b = squareCenter(to, orientation);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const shorten = 0.3 / len; // stop short so the head sits on the target square
        return (
          <line
            key={`${from}${to}${tone}`}
            className={`arrow ${tone}`}
            x1={a.x}
            y1={a.y}
            x2={b.x - (b.x - a.x) * shorten}
            y2={b.y - (b.y - a.y) * shorten}
            markerEnd={`url(#arrowhead-${tone})`}
          />
        );
      })}
    </svg>
  );
}

interface Drag {
  from: Square;
  pointerId: number;
  x: number; // pointer position as a fraction of board width/height
  y: number;
  moved: boolean;
}

/** Square for display index (0 = top-left as seen by the viewer). */
function squareAt(index: number, orientation: Color): Square {
  const row = Math.floor(index / 8);
  const col = index % 8;
  const file = orientation === 'w' ? col : 7 - col;
  const rank = orientation === 'w' ? 8 - row : row + 1;
  return `${FILES[file]}${rank}` as Square;
}

export function Board({ fen, orientation, movableColor, lastMove, onMove, arrows = [], marks = [] }: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);

  // legal destinations per origin square, only for the movable side
  const dests = useMemo(() => {
    const map = new Map<Square, { to: Square; capture: boolean; promotion: boolean }[]>();
    if (!movableColor || chess.turn() !== movableColor) return map;
    for (const m of chess.moves({ verbose: true })) {
      const list = map.get(m.from) ?? [];
      if (!list.some(d => d.to === m.to)) list.push({ to: m.to, capture: !!m.captured, promotion: !!m.promotion });
      map.set(m.from, list);
    }
    return map;
  }, [chess, movableColor]);

  const checkSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    return chess.findPiece({ type: 'k', color: chess.turn() })[0] ?? null;
  }, [chess]);

  // a new position invalidates any pending interaction
  useEffect(() => {
    setSelected(null);
    setDrag(null);
    setPromotion(null);
  }, [fen, movableColor]);

  const destsOf = (sq: Square | null) => (sq ? (dests.get(sq) ?? []) : []);

  const pointToSquare = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return { x, y, square: null };
    return { x, y, square: squareAt(Math.floor(y * 8) * 8 + Math.floor(x * 8), orientation) };
  };

  const tryMove = (from: Square, to: Square) => {
    const dest = destsOf(from).find(d => d.to === to);
    if (!dest) return false;
    setSelected(null);
    if (dest.promotion) setPromotion({ from, to });
    else onMove(from, to);
    return true;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || promotion) return;
    const hit = pointToSquare(e.clientX, e.clientY);
    if (!hit?.square) return;
    const sq = hit.square;
    if (selected && sq !== selected && tryMove(selected, sq)) return;
    if (dests.has(sq)) {
      e.preventDefault();
      boardRef.current?.setPointerCapture(e.pointerId);
      setSelected(sq);
      setDrag({ from: sq, pointerId: e.pointerId, x: hit.x, y: hit.y, moved: false });
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const hit = pointToSquare(e.clientX, e.clientY);
    if (hit) setDrag({ ...drag, x: hit.x, y: hit.y, moved: true });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const hit = pointToSquare(e.clientX, e.clientY);
    setDrag(null);
    const target = hit?.square;
    // dropping back on the origin square leaves it selected for click-to-move
    if (target && target !== drag.from) {
      if (!tryMove(drag.from, target) && drag.moved) setSelected(null);
    }
  };

  const squares = [];
  for (let i = 0; i < 64; i++) {
    const sq = squareAt(i, orientation);
    const piece = chess.get(sq);
    const row = Math.floor(i / 8);
    const col = i % 8;
    const light = (row + col) % 2 === 0;
    const dest = destsOf(selected).find(d => d.to === sq);
    const classes = ['sq', light ? 'light' : 'dark'];
    if (lastMove && (lastMove.from === sq || lastMove.to === sq)) classes.push('last');
    if (selected === sq) classes.push('selected');
    if (checkSquare === sq) classes.push('check');
    if (marks.includes(sq)) classes.push('marked');
    if (dest) classes.push(dest.capture ? 'dest-capture' : 'dest');
    const dragging = drag?.moved && drag.from === sq;
    squares.push(
      <div key={sq} className={classes.join(' ')} data-square={sq}>
        {col === 0 && <span className="coord rank">{sq[1]}</span>}
        {row === 7 && <span className="coord file">{sq[0]}</span>}
        {piece && <Piece color={piece.color} type={piece.type} ghost={!!dragging} />}
      </div>,
    );
  }

  const dragPiece = drag?.moved ? chess.get(drag.from) : undefined;

  return (
    <div
      ref={boardRef}
      className={`board${movableColor ? ' interactive' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      role="grid"
      aria-label="Chess board"
    >
      {squares}
      {arrows.length > 0 && <ArrowLayer arrows={arrows} orientation={orientation} />}
      {drag && dragPiece && (
        <div className="drag-piece" style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%` }}>
          <Piece color={dragPiece.color} type={dragPiece.type} />
        </div>
      )}
      {promotion && (
        <PromotionPicker
          color={chess.turn()}
          onPick={role => {
            onMove(promotion.from, promotion.to, role);
            setPromotion(null);
          }}
          onCancel={() => setPromotion(null)}
        />
      )}
    </div>
  );
}

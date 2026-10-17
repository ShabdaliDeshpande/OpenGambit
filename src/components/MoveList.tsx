import { useEffect, useRef } from 'react';
import type { MoveRecord } from '../chess/game';

interface Row {
  number: number;
  white?: { san: string; ply: number };
  black?: { san: string; ply: number };
}

/** Groups moves into numbered rows; handles games that start with Black to move. */
function toRows(moves: MoveRecord[], startFen: string): Row[] {
  const parts = startFen.split(' ');
  let number = Number(parts[5]) || 1;
  const rows: Row[] = [];
  let row: Row | null = null;
  moves.forEach((m, i) => {
    const entry = { san: m.san, ply: i + 1 };
    if (m.color === 'w') {
      row = { number, white: entry };
      rows.push(row);
    } else {
      if (!row || row.black || row.number !== number) {
        row = { number };
        rows.push(row);
      }
      row.black = entry;
      number++;
    }
  });
  return rows;
}

interface Props {
  moves: MoveRecord[];
  startFen: string;
  viewPly: number;
  resultText: string | null;
  onSelect: (ply: number) => void;
}

export function MoveList({ moves, startFen, viewPly, resultText, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [viewPly, moves.length]);

  const cell = (e?: { san: string; ply: number }) =>
    e ? (
      <button
        type="button"
        className={`move${e.ply === viewPly ? ' active' : ''}`}
        ref={e.ply === viewPly ? activeRef : undefined}
        onClick={() => onSelect(e.ply)}
      >
        {e.san}
      </button>
    ) : (
      <span className="move empty">…</span>
    );

  return (
    <div className="move-list" aria-label="Moves">
      {moves.length === 0 && <p className="muted">No moves yet.</p>}
      {toRows(moves, startFen).map(r => (
        <div className="move-row" key={`${r.number}-${r.white?.ply ?? r.black?.ply}`}>
          <span className="move-number">{r.number}.</span>
          {cell(r.white)}
          {cell(r.black)}
        </div>
      ))}
      {resultText && <p className="move-result">{resultText}</p>}
    </div>
  );
}

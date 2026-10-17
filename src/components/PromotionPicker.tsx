import { useEffect } from 'react';
import type { Color, PieceSymbol } from 'chess.js';
import { Piece } from './Piece';

const CHOICES: PieceSymbol[] = ['q', 'r', 'b', 'n'];

export function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: Color;
  onPick: (role: PieceSymbol) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="promotion-overlay"
      onPointerDown={e => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="promotion-choices" role="dialog" aria-label="Choose promotion piece">
        {CHOICES.map(role => (
          <button key={role} type="button" className="promotion-choice" onClick={() => onPick(role)}>
            <Piece color={color} type={role} />
          </button>
        ))}
      </div>
    </div>
  );
}

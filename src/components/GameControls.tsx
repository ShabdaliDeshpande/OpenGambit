import { useState } from 'react';
import type { Color } from 'chess.js';

const name = (c: Color) => (c === 'w' ? 'White' : 'Black');

interface Props {
  /** Side whose buttons are shown (side to move locally, the human vs the computer). */
  actor: Color;
  canAct: boolean;
  drawOfferBy: Color | null;
  onResign: () => void;
  onOfferDraw: () => void;
  onAcceptDraw: () => void;
  onDeclineDraw: () => void;
}

export function GameControls({ actor, canAct, drawOfferBy, onResign, onOfferDraw, onAcceptDraw, onDeclineDraw }: Props) {
  const [confirm, setConfirm] = useState<'resign' | null>(null);

  if (!canAct) return null;

  const incoming = drawOfferBy && drawOfferBy !== actor;
  return (
    <div className="controls">
      {incoming ? (
        <div className="offer" role="alert">
          <span>{name(drawOfferBy)} offers a draw.</span>
          <button type="button" className="primary" onClick={onAcceptDraw}>
            Accept
          </button>
          <button type="button" onClick={onDeclineDraw}>
            Decline
          </button>
        </div>
      ) : confirm === 'resign' ? (
        <div className="offer">
          <span>Resign as {name(actor)}?</span>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirm(null);
              onResign();
            }}
          >
            Yes, resign
          </button>
          <button type="button" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button type="button" onClick={onOfferDraw} disabled={drawOfferBy === actor} title="Offer a draw">
            {drawOfferBy === actor ? 'Draw offered' : '½ Offer draw'}
          </button>
          <button type="button" onClick={() => setConfirm('resign')} title="Resign">
            ⚑ Resign
          </button>
        </>
      )}
    </div>
  );
}

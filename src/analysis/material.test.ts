import { describe, expect, it } from 'vitest';
import { exchangeGain, forkTargets, hangingPiece, lineMaterial, materialBalance, materialOffered, pinBy } from './material';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('static exchange', () => {
  it('wins a loose piece outright', () => {
    // Black's d6 pawn attacks the undefended knight on e5
    expect(exchangeGain('4k3/8/3p4/4N3/8/8/8/4K3 w - - 0 1', 'e5', 'b')).toBe(3);
  });

  it('nets the difference when the piece is defended', () => {
    // dxe5, dxe5: Black wins a knight for a pawn
    expect(exchangeGain('4k3/8/3p4/4N3/3P4/8/8/4K3 w - - 0 1', 'e5', 'b')).toBe(2);
  });

  it('declines a capture that loses material', () => {
    // Nxe5 dxe5 would give a knight for a pawn
    expect(exchangeGain('4k3/8/3p4/4p3/8/5N2/8/4K3 w - - 0 1', 'e5', 'w')).toBe(0);
  });

  it('finds the most valuable hanging piece', () => {
    expect(hangingPiece('4k3/8/3p4/4N3/8/8/8/4K3 w - - 0 1', 'w')).toMatchObject({ square: 'e5', type: 'n', gain: 3 });
    expect(hangingPiece(START, 'w')).toBeNull();
  });
});

describe('material offered by a move', () => {
  it('sees a bishop given for a pawn next to the king', () => {
    // 4. Bxf7+ Kxf7: the bishop is worth 3, the pawn 1
    const fen = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(materialOffered(fen, { from: 'c4', to: 'f7' })).toBe(2);
  });

  it('is nothing for a quiet developing move or a fair trade', () => {
    expect(materialOffered(START, { from: 'e2', to: 'e4' })).toBe(0);
    expect(materialOffered(START, { from: 'g1', to: 'f3' })).toBe(0);
  });

  it('counts a piece left hanging elsewhere', () => {
    // the knight on c3 guards the bishop on e2 against the queen; Na4 abandons it
    const fen = '4k3/8/8/7q/8/2N5/4B3/K7 w - - 0 1';
    expect(materialOffered(fen, { from: 'c3', to: 'a4' })).toBe(3);
    expect(materialOffered(fen, { from: 'a1', to: 'b1' })).toBe(0);
  });
});

describe('tactics', () => {
  it('spots a knight fork of king and rook', () => {
    const targets = forkTargets('r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1', 'c7').map(t => t.type).sort();
    expect(targets).toEqual(['k', 'r']);
  });

  it('spots a pin against the king', () => {
    expect(pinBy('4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1', 'b5')).toEqual({ pinned: 'c6', type: 'n', behind: 'k' });
    expect(pinBy('4k3/8/8/1B6/8/8/8/4K3 w - - 0 1', 'b5')).toBeNull();
  });

  it('measures material along a line, finishing exchanges', () => {
    const fen = '4k3/8/3p4/4N3/3P4/8/8/4K3 b - - 0 1';
    // dxe5 dxe5: Black is up a knight for a pawn
    expect(lineMaterial(fen, [{ from: 'd6', to: 'e5' }, { from: 'd4', to: 'e5' }], 'b')).toBe(2);
    // stopping halfway would miss the recapture, so the line is followed to a quiet point
    expect(materialBalance(fen, 'b')).toBe(-3);
  });
});

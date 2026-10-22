import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { divide, phaseOf } from './divider';

const fensOf = (sans: string[], start?: string) => {
  const chess = new Chess(start);
  return [chess.fen(), ...sans.map(s => (chess.move(s), chess.fen()))];
};

describe('game phases', () => {
  it('stays in the opening while the minor pieces are at home', () => {
    const div = divide(fensOf(['e4', 'e5', 'Nf3', 'Nc6']));
    expect(div).toEqual({ middle: null, end: null });
    expect(phaseOf(3, div)).toBe('opening');
  });

  it('starts the middlegame once most minor pieces have moved', () => {
    // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Nc3 Bc5
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Nc3', 'Bc5'];
    const div = divide(fensOf(sans));
    // minors at home after each ply: 8,8,7,6,5,4,3 → the middlegame starts at ply 7
    expect(div.middle).toBe(7);
    expect(phaseOf(6, div)).toBe('opening');
    expect(phaseOf(7, div)).toBe('middlegame');
  });

  it('starts the middlegame at ply 30 at the latest', () => {
    const shuffle = Array.from({ length: 7 }, () => ['Ra2', 'Ra7', 'Ra1', 'Ra8']).flat();
    const div = divide(fensOf(['a4', 'a5', ...shuffle]));
    expect(div.middle).toBe(30);
  });

  it('starts the endgame when little material is left', () => {
    // queens and minor pieces off: 2 rooks each = 20 ≤ 26
    const div = divide(fensOf(['Kf1'], 'r3k2r/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w - - 0 1'));
    expect(div.end).toBe(1);
    expect(div.middle).toBe(1);
    expect(phaseOf(1, div)).toBe('endgame');
  });
});

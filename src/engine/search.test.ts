import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { acceptsDraw, chooseMove, evaluateWhite, LEVELS, levelSettings } from './search';

const fixedRng = () => 0.5; // zero noise

describe('engine', () => {
  it('has 8 strength levels that get stronger', () => {
    expect(LEVELS).toHaveLength(8);
    expect(levelSettings(0)).toBe(LEVELS[0]);
    expect(levelSettings(99)).toBe(LEVELS[7]);
    expect(LEVELS[7]!.depth).toBeGreaterThan(LEVELS[0]!.depth);
    expect(LEVELS[7]!.noise).toBeLessThan(LEVELS[0]!.noise);
  });

  it('evaluates the start position as roughly equal', () => {
    expect(Math.abs(evaluateWhite(new Chess()))).toBeLessThan(30);
  });

  it.each([1, 4, 8])('finds mate in one at level %i', level => {
    const chess = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const m = chooseMove(chess, level);
    expect(m).toMatchObject({ from: 'a1', to: 'a8' });
  });

  it('takes a free queen at a strong level', () => {
    const chess = new Chess('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
    expect(chooseMove(chess, 7, { rng: fixedRng })).toMatchObject({ from: 'd1', to: 'd5' });
  });

  it('returns a legal move at every level and leaves the position untouched', () => {
    const chess = new Chess();
    chess.move('e4');
    const before = chess.fen();
    for (let level = 1; level <= 8; level++) {
      // a fake clock that advances quickly keeps the strong levels fast in tests
      let t = 0;
      const m = chooseMove(chess, level, { now: () => (t += 50) });
      expect(m).not.toBeNull();
      expect(chess.fen()).toBe(before);
      expect(() => new Chess(before).move({ from: m!.from, to: m!.to, promotion: m!.promotion })).not.toThrow();
    }
  });

  it('promotes before the king can catch the pawn', () => {
    // waiting one move would allow ...Kb7 winning the pawn
    const chess = new Chess('8/P1k5/8/8/8/8/8/7K w - - 0 1');
    expect(chooseMove(chess, 6, { rng: fixedRng })).toMatchObject({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  it('returns null with no legal moves', () => {
    expect(chooseMove(new Chess('k7/2K5/1Q6/8/8/8/8/8 b - - 0 1'), 3)).toBeNull();
  });

  it('plays a forced mate in two', () => {
    const chess = new Chess('r5k1/5ppp/8/8/8/8/1Q6/1R4K1 w - - 0 1');
    expect(chooseMove(chess, 8)).toMatchObject({ from: 'b2', to: 'b8' });
  });

  it('accepts a draw only when worse off', () => {
    expect(acceptsDraw(new Chess('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1'), 'b')).toBe(true);
    expect(acceptsDraw(new Chess('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1'), 'w')).toBe(false);
    expect(acceptsDraw(new Chess(), 'b')).toBe(false);
  });
});

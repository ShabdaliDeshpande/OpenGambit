import { describe, expect, it } from 'vitest';
import { averageCpl, gameAccuracy, moveAccuracy, whiteWinPercent, winningChances, type Score } from './accuracy';

const cp = (v: number): Score => ({ cp: v });

describe('move accuracy', () => {
  it('is 100 when the win percentage did not drop', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 70)).toBe(100);
  });

  it('follows lila’s curve, with the +1 uncertainty bonus', () => {
    // a 10-point drop: 103.1668·e^(−0.43544) − 3.1669 + 1 ≈ 64.6
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.6, 1);
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});

describe('game accuracy', () => {
  it('is 100 for a side that never lost ground', () => {
    const win = [50, 50, 50, 50, 50, 50].map(Number);
    expect(gameAccuracy(win, 'w')).toEqual({ w: 100, b: 100 });
  });

  it('only marks down the side that blundered', () => {
    // Black's third move drops White's win % from 55 to 90
    const win = [50, 52, 52, 54, 55, 55, 90, 91, 90].map(Number);
    const acc = gameAccuracy(win, 'w');
    expect(acc.w).toBeGreaterThan(95);
    expect(acc.b).toBeLessThan(80);
  });

  it('counts the side to move first correctly when Black starts', () => {
    // Black's move takes White from 50% to 80%: Black lost ground; White's reply keeps it
    const acc = gameAccuracy([50, 80, 80], 'b');
    expect(acc.b).toBeLessThan(50);
    expect(acc.w).toBe(100);
    expect(gameAccuracy([50, 20, 20], 'b').b).toBe(100);
  });

  it('handles a longer game with a wider window', () => {
    // 21 moves: one small slip by White at ply 5
    const win = [50, 50, 50, 50, 50, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45];
    const acc = gameAccuracy(win, 'w');
    expect(acc.b).toBe(100);
    expect(acc.w).toBeGreaterThan(80);
    expect(acc.w).toBeLessThan(100);
  });

  it('has nothing to say about an empty game', () => {
    expect(gameAccuracy([50], 'w')).toEqual({ w: null, b: null });
  });
});

describe('scores', () => {
  it('turns mates and finished games into certain wins', () => {
    expect(winningChances({ mate: 2 }, 'w')).toBe(1);
    expect(winningChances({ mated: 'w' }, 'w')).toBe(-1);
    expect(whiteWinPercent(cp(0))).toBeCloseTo(50, 6);
  });

  it('averages centipawn loss per side', () => {
    // White loses 100, Black gains (no loss), White loses nothing
    expect(averageCpl([cp(0), cp(-100), cp(-100), cp(-50)], 'w')).toEqual({ w: 50, b: 0 });
  });
});

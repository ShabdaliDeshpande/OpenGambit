import { describe, expect, it } from 'vitest';
import { gamesOf, gamesText, resultShares, totalOf } from './format';

describe('explorer formatting', () => {
  it('splits results into percentages that add up to 100', () => {
    expect(resultShares({ white: 1, draws: 1, black: 1 })).toEqual({ white: 34, draws: 33, black: 33 });
    expect(resultShares({ white: 2, draws: 0, black: 1 })).toEqual({ white: 67, draws: 0, black: 33 });
    expect(resultShares({ white: 0, draws: 0, black: 0 })).toEqual({ white: 0, draws: 0, black: 0 });
    for (const c of [
      { white: 7, draws: 3, black: 5 },
      { white: 123, draws: 77, black: 1 },
    ]) {
      const s = resultShares(c);
      expect(s.white + s.draws + s.black).toBe(100);
    }
  });

  it('totals and counts games', () => {
    const t = totalOf([
      { white: 1, draws: 2, black: 3 },
      { white: 4, draws: 0, black: 1 },
    ]);
    expect(t).toEqual({ white: 5, draws: 2, black: 4 });
    expect(gamesOf(t)).toBe(11);
    expect(gamesText(1)).toBe('1 game');
    expect(gamesText(12345)).toBe('12,345 games');
  });
});

import { describe, expect, it } from 'vitest';
import { estimatePerformance, MIN_MOVES_FOR_ESTIMATE, ratingForAccuracy } from './performance';

describe('performance estimate', () => {
  it('rises with accuracy and passes through its anchors', () => {
    expect(ratingForAccuracy(50)).toBe(800);
    expect(ratingForAccuracy(80)).toBe(1700);
    expect(ratingForAccuracy(75)).toBe(1500); // halfway between 70 → 1300 and 80 → 1700
    let last = -Infinity;
    for (let a = 0; a <= 100; a += 5) {
      expect(ratingForAccuracy(a)).toBeGreaterThan(last);
      last = ratingForAccuracy(a);
    }
  });

  it('needs enough moves to say anything', () => {
    expect(estimatePerformance(90, MIN_MOVES_FOR_ESTIMATE - 1)).toBeNull();
    expect(estimatePerformance(null, 40)).toBeNull();
    expect(estimatePerformance(80, 30)).toBe(1700);
  });

  it('leans a little towards the opponent’s rating, at most 200 points', () => {
    expect(estimatePerformance(80, 30, 2100)).toBe(1800); // a quarter of the 400 gap
    expect(estimatePerformance(80, 30, 3000)).toBe(1900); // capped
    expect(estimatePerformance(80, 30, 900)).toBe(1500);
  });
});

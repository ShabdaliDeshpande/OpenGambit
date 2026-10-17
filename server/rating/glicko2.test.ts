import { describe, expect, it } from 'vitest';
import { afterIdle, capped, DEFAULT_GLICKO, isProvisional, LIMITS, rateGame, ratePeriod } from './glicko2.ts';

describe('Glicko-2', () => {
  it('matches the worked example in Glickman’s paper', () => {
    // player 1500/200/0.06 beats a 1400/30, loses to 1550/100 and 1700/300, tau = 0.5
    const after = ratePeriod(
      { rating: 1500, deviation: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(after.rating).toBeCloseTo(1464.06, 1);
    expect(after.deviation).toBeCloseTo(151.52, 1);
    expect(after.volatility).toBeCloseTo(0.05999, 4);
  });

  it('moves new players a lot and settled players a little, symmetrically', () => {
    const fresh = rateGame(DEFAULT_GLICKO, DEFAULT_GLICKO, 1);
    expect(fresh.white.rating - 1500).toBeGreaterThan(150);
    expect(fresh.white.rating - 1500).toBeCloseTo(1500 - fresh.black.rating, 6);
    expect(fresh.white.deviation).toBeLessThan(500);

    const settled = { rating: 1800, deviation: 60, volatility: 0.06 };
    const game = rateGame(settled, settled, 1);
    expect(game.white.rating - 1800).toBeGreaterThan(2);
    expect(game.white.rating - 1800).toBeLessThan(12);

    const draw = rateGame(settled, settled, 0.5);
    expect(draw.white.rating).toBeCloseTo(1800, 6);
  });

  it('rewards beating a stronger player more than a weaker one', () => {
    const me = { rating: 1500, deviation: 80, volatility: 0.06 };
    const strong = { rating: 1800, deviation: 80, volatility: 0.06 };
    const weak = { rating: 1200, deviation: 80, volatility: 0.06 };
    expect(rateGame(me, strong, 1).white.rating).toBeGreaterThan(rateGame(me, weak, 1).white.rating);
    expect(rateGame(me, weak, 0).white.rating).toBeLessThan(rateGame(me, strong, 0).white.rating);
  });

  it('keeps ratings inside the limits', () => {
    const low = { rating: 405, deviation: 300, volatility: 0.09 };
    expect(rateGame(low, DEFAULT_GLICKO, 0).white.rating).toBe(LIMITS.minRating);
    const c = capped({ rating: 3000, deviation: 10, volatility: 0.5 }, DEFAULT_GLICKO);
    expect(c).toEqual({ rating: 1500 + LIMITS.maxDelta, deviation: LIMITS.minDeviation, volatility: LIMITS.maxVolatility });
  });

  it('grows the deviation while a player is away, up to the maximum', () => {
    const g = { rating: 1700, deviation: 60, volatility: 0.06 };
    const year = afterIdle(g, 365 * 86_400_000);
    expect(year.deviation).toBeGreaterThan(100);
    expect(year.deviation).toBeLessThan(120);
    expect(year.rating).toBe(1700);
    expect(afterIdle(g, 0)).toBe(g);
    expect(afterIdle({ ...g, deviation: 499 }, 1e13).deviation).toBe(LIMITS.maxDeviation);
  });

  it('marks ratings provisional until the deviation is low enough', () => {
    expect(isProvisional(DEFAULT_GLICKO)).toBe(true);
    expect(isProvisional({ rating: 1500, deviation: 109, volatility: 0.06 })).toBe(false);
  });
});

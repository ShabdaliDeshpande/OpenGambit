import { describe, expect, it } from 'vitest';
import { BUILTIN_PUZZLES } from './builtin';
import { comboBonus, newStorm, runSequence, STORM, stormBadMove, stormGoodMove, stormSolved, stormTick, stormTimeLeft } from './runs';

describe('run order', () => {
  it('goes from easy to hard, shuffled only within rating bands', () => {
    const seq = runSequence(BUILTIN_PUZZLES, Math.random);
    expect(seq).toHaveLength(BUILTIN_PUZZLES.length);
    for (let i = 1; i < seq.length; i++) expect(Math.floor(seq[i]!.rating / 100)).toBeGreaterThanOrEqual(Math.floor(seq[i - 1]!.rating / 100));
  });
});

describe('storm', () => {
  it('gives bonus time at combos of 5, 12, 20, 30 and every 10 after', () => {
    expect([1, 4, 5, 6, 12, 20, 30, 35, 40, 50].map(comboBonus)).toEqual([0, 0, 3, 0, 5, 7, 10, 0, 10, 10]);
  });

  it('starts the clock on the first move, adds bonuses and takes 10 s for mistakes', () => {
    let s = newStorm();
    expect(stormTimeLeft(s, 0)).toBe(STORM.initialMs);
    s = stormGoodMove(s, 1_000); // clock starts at 1 s
    expect(stormTimeLeft(s, 1_000)).toBe(180_000);
    for (let i = 0; i < 4; i++) s = stormGoodMove(s, 2_000);
    expect(s.combo).toBe(5);
    expect(stormTimeLeft(s, 2_000)).toBe(180_000 - 1_000 + 3_000);
    s = stormSolved(s);
    s = stormBadMove(s, 3_000);
    expect(s).toMatchObject({ combo: 0, bestCombo: 5, errors: 1, moves: 6, score: 1, lastChange: { seconds: -10 } });
    expect(stormTimeLeft(s, 3_000)).toBe(180_000 - 2_000 + 3_000 - 10_000);
  });

  it('ends when time runs out, and ignores moves afterwards', () => {
    let s = stormGoodMove(newStorm(), 0);
    s = stormTick(s, 179_999);
    expect(s.over).toBe(false);
    s = stormTick(s, 180_000);
    expect(s.over).toBe(true);
    expect(stormSolved(stormGoodMove(s, 180_001))).toEqual(s);
    // a mistake with little time left ends the run at once
    const late = stormBadMove(stormGoodMove(newStorm(), 0), 175_000);
    expect(late.over).toBe(true);
  });
});

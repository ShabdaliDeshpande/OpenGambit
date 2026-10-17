import { describe, expect, it } from 'vitest';
import { chooseWhite, onFire, pairArena, scoreGame, totalOf, type ArenaPlayer, type Outcome, type SheetEntry } from './arena.ts';

function play(results: [Outcome, number?, boolean?][], streaks = true): SheetEntry[] {
  const sheet: SheetEntry[] = [];
  results.forEach(([outcome, plies = 40, berserk = false], i) => sheet.push(scoreGame(sheet, { gameId: `g${i}`, outcome, plies, berserk }, streaks)));
  return sheet;
}

const player = (id: string, rating: number, over: Partial<ArenaPlayer> = {}): ArenaPlayer => ({
  id,
  name: id,
  rating,
  joinedAt: 0,
  withdrawn: false,
  sheet: [],
  score: 0,
  playing: null,
  lastOpponent: null,
  colors: [],
  ...over,
});

describe('arena scoring', () => {
  it('scores 2 for a win, 1 for a draw, 0 for a loss', () => {
    expect(play([['win'], ['loss'], ['draw', 80]]).map(e => e.points)).toEqual([2, 0, 1]);
  });

  it('doubles points after two wins in a row, until the streak breaks', () => {
    const sheet = play([['win'], ['win'], ['win'], ['draw', 80], ['loss'], ['win'], ['win'], ['win']]);
    expect(sheet.map(e => e.points)).toEqual([2, 2, 4, 2, 0, 2, 2, 4]);
    expect(sheet.map(e => e.fire)).toEqual([false, false, true, true, false, false, false, true]);
    expect(onFire(sheet)).toBe(true);
  });

  it('can turn streaks off', () => {
    expect(play([['win'], ['win'], ['win']], false).map(e => e.points)).toEqual([2, 2, 2]);
  });

  it('gives nothing for quick draws, and for repeated short draws', () => {
    expect(play([['draw', 19]])[0]).toMatchObject({ result: 'void', points: 0 });
    // second short draw in a row scores 0, a loss in between doesn't break the draw streak, a long draw always scores
    expect(play([['draw', 30], ['draw', 30], ['loss'], ['draw', 30], ['draw', 70], ['win'], ['draw', 30]]).map(e => e.points)).toEqual([
      1, 0, 0, 0, 1, 2, 1,
    ]);
  });

  it('adds a point for a berserk win that lasted long enough', () => {
    const sheet = play([
      ['win', 30, true],
      ['win', 10, true],
      ['loss', 30, true],
      ['draw', 40, true],
    ]);
    expect(sheet.map(e => e.points)).toEqual([3, 2, 0, 1]);
    expect(totalOf(sheet)).toBe(6);
  });
});

describe('arena pairing', () => {
  const ranks = (ps: ArenaPlayer[]) => new Map(ps.map((p, i) => [p.id, i + 1]));
  const coin = () => 0.3;

  it('pairs the first wave by rating', () => {
    const ps = [player('a', 1500), player('b', 1900), player('c', 1600), player('d', 1800), player('e', 1200)];
    const pairs = pairArena(ps, ranks(ps), true, false, coin);
    expect(pairs.map(p => [p.white, p.black].sort().join(''))).toEqual(['bd', 'ac']);
  });

  it('keeps close ranks together and never repeats the last opponent', () => {
    const ps = [player('a', 1500, { lastOpponent: 'b' }), player('b', 1500, { lastOpponent: 'a' }), player('c', 1500), player('d', 1500)];
    const pairs = pairArena(ps, ranks(ps), false, false, coin);
    const sets = pairs.map(p => [p.white, p.black].sort().join(''));
    expect(sets.sort()).toEqual(['ac', 'bd']);
    // only two players left in the tournament: they may play again
    expect(pairArena(ps.slice(0, 2), ranks(ps), false, true, coin)).toHaveLength(1);
    expect(pairArena(ps.slice(0, 2), ranks(ps), false, false, coin)).toHaveLength(0);
  });

  it('balances colours', () => {
    const white3 = player('a', 1500, { colors: ['w', 'w', 'w'] });
    const black1 = player('b', 1500, { colors: ['b'] });
    expect(chooseWhite(white3, black1, coin)).toEqual(['b', 'a']);
    expect(chooseWhite(player('x', 1, { colors: ['w'] }), player('y', 1, { colors: ['b'] }), coin)).toEqual(['y', 'x']);
    // both had White three times in a row: not paired together
    const other = player('c', 1500, { colors: ['w', 'w', 'w'] });
    expect(pairArena([white3, other], new Map([['a', 1], ['c', 2]]), false, false, coin)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { botKey, drillKey, endgameKey, lessonKey, mergeProgress, stageStars, validItem } from './progress';

describe('learning progress', () => {
  it('checks entries', () => {
    expect(validItem(lessonKey('rook-1'), 3)).toBe(true);
    expect(validItem(lessonKey('rook-1'), 4)).toBe(false);
    expect(validItem(endgameKey('kq-k'), 1)).toBe(true);
    expect(validItem(drillKey('forks'), 41_200)).toBe(true);
    expect(validItem(drillKey('forks'), -1)).toBe(false);
    expect(validItem('bonus:rook', 3)).toBe(false);
    expect(validItem(lessonKey('Rook 1'), 3)).toBe(false);
    expect(validItem(lessonKey('rook-1'), 2.5)).toBe(false);
    expect(validItem(botKey('magpie'), 2)).toBe(true);
    expect(validItem(botKey('magpie'), 1)).toBe(true);
    expect(validItem(botKey('magpie'), 3)).toBe(false);
  });

  it('keeps the better result against a bot: a win over a draw', () => {
    expect(mergeProgress({ [botKey('moss')]: 1 }, { [botKey('moss')]: 2 })).toEqual({ [botKey('moss')]: 2 });
    expect(mergeProgress({ [botKey('moss')]: 2 }, { [botKey('moss')]: 1 })).toEqual({ [botKey('moss')]: 2 });
  });

  it('keeps the better result: more stars, the fastest drill', () => {
    const merged = mergeProgress(
      { [lessonKey('rook-1')]: 2, [drillKey('forks')]: 50_000, [lessonKey('bishop-1')]: 3 },
      { [lessonKey('rook-1')]: 3, [drillKey('forks')]: 42_000, [endgameKey('kq-k')]: 1, junk: 5 },
    );
    expect(merged).toEqual({ [lessonKey('rook-1')]: 3, [drillKey('forks')]: 42_000, [lessonKey('bishop-1')]: 3, [endgameKey('kq-k')]: 1 });
  });

  it('adds up stars for a stage', () => {
    expect(stageStars({ [lessonKey('a')]: 3, [lessonKey('b')]: 1 }, ['a', 'b', 'c'])).toBe(4);
  });
});

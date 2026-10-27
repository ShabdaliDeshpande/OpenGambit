import { describe, expect, it } from 'vitest';
import { FLAIRS, validFlair, withFlair } from '../account/flair';
import {
  advanceConditional,
  checkConditional,
  DAY_MS,
  endVacation,
  isDaysPerMove,
  moveDeadline,
  reminderAt,
  startVacation,
  timeLeftText,
  vacationLeft,
  type Vacation,
} from './rules';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const T = Date.UTC(2026, 9, 1, 12);

describe('deadlines', () => {
  it('counts whole days from the opponent’s move, after any vacation', () => {
    expect(isDaysPerMove(3)).toBe(true);
    expect(isDaysPerMove(4)).toBe(false);
    expect(moveDeadline(T, 3, null)).toBe(T + 3 * DAY_MS);
    expect(moveDeadline(T, 3, T - DAY_MS)).toBe(T + 3 * DAY_MS);
    expect(moveDeadline(T, 3, T + 2 * DAY_MS)).toBe(T + 5 * DAY_MS);
  });

  it('reminds at 80% of the time, and says how long is left', () => {
    expect(reminderAt(T, T + 10 * DAY_MS)).toBe(T + 8 * DAY_MS);
    expect(timeLeftText(3 * DAY_MS)).toBe('3 days');
    expect(timeLeftText(5 * 3_600_000)).toBe('5 hours');
    expect(timeLeftText(90_000)).toBe('2 minutes');
    expect(timeLeftText(-1)).toBe('no time');
  });
});

describe('vacation', () => {
  const fresh: Vacation = { year: 2026, used: 0, until: null };

  it('takes whole days out of 14 a year, and moves your deadlines forward', () => {
    const started = startVacation(fresh, T, 5);
    expect(started).toEqual({ vacation: { year: 2026, used: 5, until: T + 5 * DAY_MS }, shift: 5 * DAY_MS });
    if (typeof started === 'string') throw new Error(started);
    expect(vacationLeft(started.vacation, T)).toBe(9);
    expect(startVacation(started.vacation, T + DAY_MS, 1)).toBe('You’re already on vacation.');
    expect(startVacation({ ...fresh, used: 12 }, T, 5)).toBe('You have 2 vacation days left this year.');
    expect(startVacation(fresh, T, 0)).toBe('Take at least one whole day.');
    // a new year starts afresh
    expect(vacationLeft({ year: 2025, used: 14, until: null }, T)).toBe(14);
  });

  it('gives back the whole days not used when it ends early', () => {
    const on: Vacation = { year: 2026, used: 5, until: T + 5 * DAY_MS };
    // ended 1.5 days in: 3 whole days remain unused
    expect(endVacation(on, T + 1.5 * DAY_MS)).toEqual({ vacation: { year: 2026, used: 2, until: T + 1.5 * DAY_MS }, shift: -3 * DAY_MS });
    expect(endVacation(fresh, T)).toBe('You’re not on vacation.');
  });
});

describe('conditional moves', () => {
  it('keeps legal lines from the current position and drops a dangling move', () => {
    expect(checkConditional(START, [['e2e4', 'e7e5', 'g1f3'], ['d2d4', 'd7d5'], ['d2d4', 'd7d5']])).toEqual([['e2e4', 'e7e5'], ['d2d4', 'd7d5']]);
    expect(checkConditional(START, [['e7e5', 'e2e4']])).toMatch(/illegal move \(e7e5\)/);
    expect(checkConditional(START, 'nope')).toBe('Send a list of lines.');
    expect(checkConditional(START, Array.from({ length: 31 }, () => ['e2e4', 'e7e5']))).toBe('At most 30 lines.');
  });

  it('plays the prepared reply and moves the matching lines on', () => {
    const lines = [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      ['e2e4', 'e7e5', 'f1c4', 'g8f6'],
      ['d2d4', 'd7d5'],
    ];
    expect(advanceConditional(lines, 'e2e4')).toEqual({ reply: 'e7e5', lines: [['g1f3', 'b8c6'], ['f1c4', 'g8f6']] });
    expect(advanceConditional(lines, 'd2d4')).toEqual({ reply: 'd7d5', lines: [] });
    expect(advanceConditional(lines, 'c2c4')).toEqual({ reply: null, lines: [] });
  });
});

describe('flair', () => {
  it('accepts only the listed emoji', () => {
    expect(FLAIRS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FLAIRS).size).toBe(FLAIRS.length);
    expect(validFlair('🦉')).toBe(true);
    expect(validFlair('<b>')).toBe(false);
    expect(validFlair(null)).toBe(false);
    expect(withFlair('Ana', '🦉')).toBe('Ana 🦉');
    expect(withFlair('Ana', null)).toBe('Ana');
  });
});

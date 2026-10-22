import { describe, expect, it } from 'vitest';
import { reviewMoves } from './gameReview';
import { judgeTry, quickVerdict, retryCandidates, retryReducer, startRetry } from './retry';
import { at, gameOf, uci } from './reviewFixtures';

const moves = gameOf(['e4', 'd5', 'Qg4', 'Bxg4']);
const reviewed = reviewMoves(moves, [
  at({ cp: 20 }, ['e2e4']),
  at({ cp: 30 }, ['d7d5']),
  at({ cp: 10 }, ['e4d5', 'd8d5']),
  at({ cp: -900 }, ['c8g4']),
  at({ cp: -900 }, ['g1f3']),
]);
const fault = reviewed[2]!;

describe('retrying mistakes', () => {
  it('collects each side’s errors', () => {
    expect(retryCandidates(reviewed, 'w').map(m => m.san)).toEqual(['Qg4']);
    expect(retryCandidates(reviewed, 'b')).toEqual([]);
  });

  it('accepts the engine’s move and rejects the game move at once', () => {
    expect(quickVerdict(fault, uci('e4d5'))).toBe('win');
    expect(quickVerdict(fault, uci('d1g4'))).toBe('fail');
    expect(quickVerdict(fault, uci('b1c3'))).toBe('check');
  });

  it('accepts other moves that stay within 0.04 of the evaluation', () => {
    expect(judgeTry(fault, { cp: 0 })).toBe('win'); // +0.1 → 0.0 is a tiny drop
    expect(judgeTry(fault, { cp: -60 })).toBe('fail');
  });

  it('steps through the errors', () => {
    let s = startRetry(reviewed, 'w');
    expect(s).toMatchObject({ plies: [3], index: 0, status: 'find' });
    s = retryReducer(s, { type: 'try', fen: 'x', verdict: 'check' });
    expect(s.status).toBe('checking');
    s = retryReducer(s, { type: 'checked', verdict: 'fail' });
    expect(s.status).toBe('fail');
    s = retryReducer(s, { type: 'again' });
    expect(s).toMatchObject({ status: 'find', tryFen: null });
    s = retryReducer(s, { type: 'try', fen: 'y', verdict: 'win' });
    expect(s).toMatchObject({ status: 'win', solved: [3] });
    s = retryReducer(s, { type: 'next' });
    expect(s.status).toBe('done');
  });

  it('is done straight away when there is nothing to retry', () => {
    expect(startRetry(reviewed, 'b').status).toBe('done');
  });
});

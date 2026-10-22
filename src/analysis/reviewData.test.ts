import { describe, expect, it } from 'vitest';
import { checkReview, decodeScore, decodeUci, encodeScore, kindCounts, REVIEW_VERSION, reviewStats, type StoredReview } from './reviewData';
import { fromStoredReview, toStoredReview } from './savedReview';
import { reviewMoves } from './gameReview';
import { at, gameOf } from './reviewFixtures';

const moves = gameOf(['e4', 'd5', 'Qg4', 'Bxg4']);
const evals = [
  at({ cp: 20 }, ['e2e4', 'd7d5']),
  at({ cp: 30 }, ['d7d5', 'e4d5']),
  at({ cp: 10 }, ['e4d5', 'd8d5'], { cp: -20 }),
  at({ cp: -900 }, ['c8g4']),
  at({ mate: -3 }, ['g1f3']),
];

describe('saved reviews', () => {
  it('encodes scores and moves compactly and reads them back', () => {
    for (const s of [{ cp: -35 }, { mate: 4 }, { mate: -1 }, { mated: 'b' as const }]) expect(decodeScore(encodeScore(s))).toEqual(s);
    expect(decodeScore('c:abc')).toBeNull();
    expect(decodeScore('m:0')).toBeNull();
    expect(decodeUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(decodeUci('e9e8')).toBeNull();
  });

  it('round-trips a finished review', () => {
    const reviewed = reviewMoves(moves, evals);
    const stored = toStoredReview(evals, reviewed, 'test-engine', 600);
    expect(stored.kinds).toBe('SSUS');
    expect(checkReview(JSON.parse(JSON.stringify(stored)), moves.length)).toEqual(stored);
    expect(fromStoredReview(stored)).toEqual(evals);
  });

  it('refuses reviews that don’t fit the game', () => {
    const stored = toStoredReview(evals, reviewMoves(moves, evals), 'test-engine', 600);
    expect(checkReview(stored, 5)).toMatch(/every position/);
    expect(checkReview({ ...stored, kinds: 'SSU' }, 4)).toMatch(/classify every move/);
    expect(checkReview({ ...stored, kinds: 'SSUZ' }, 4)).toMatch(/classify every move/);
    expect(checkReview({ ...stored, v: 2 }, 4)).toMatch(/version/);
    expect(checkReview({ ...stored, ms: 10 }, 4)).toMatch(/out of range/);
    const badMove: StoredReview = { ...stored, positions: stored.positions.map((p, i) => (i === 0 ? { ...p, b: 'z1z2' } : p)) };
    expect(checkReview(badMove, 4)).toMatch(/best move/);
    const longLine = { ...stored, positions: stored.positions.map(p => ({ ...p, pv: Array(11).fill('e2e4').join(' ') })) };
    expect(checkReview(longLine, 4)).toMatch(/line/);
    expect(checkReview(null, 4)).toMatch(/object/);
  });

  it('works out accuracy and counts from the saved data alone', () => {
    const stored = toStoredReview(evals, reviewMoves(moves, evals), 'test-engine', 600);
    const { accuracy, performance } = reviewStats(stored);
    expect(accuracy.w!).toBeLessThan(accuracy.b!);
    expect(performance).toEqual({ w: null, b: null }); // too short to estimate
    expect(kindCounts(stored.kinds)).toEqual({ w: { best: 1, blunder: 1 }, b: { best: 2 } });
    expect(stored.v).toBe(REVIEW_VERSION);
  });
});

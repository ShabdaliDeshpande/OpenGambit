import { describe, expect, it } from 'vitest';
import { keyMoments, moveNumber, phaseSummary, reviewMoves, summarizeReview } from './gameReview';
import { at, gameOf } from './reviewFixtures';

// 1. e4 d5 2. Qg4?? Bxg4: the queen is simply lost
const moves = gameOf(['e4', 'd5', 'Qg4', 'Bxg4']);
const evals = [
  at({ cp: 20 }, ['e2e4', 'd7d5']),
  at({ cp: 30 }, ['d7d5', 'e4d5']),
  at({ cp: 10 }, ['e4d5', 'd8d5'], { cp: -20 }),
  at({ cp: -900 }, ['c8g4']),
  at({ cp: -900 }, ['g1f3']),
];

describe('reviewing a game', () => {
  it('classifies every analysed move', () => {
    const reviewed = reviewMoves(moves, evals);
    expect(reviewed.map(m => m.judgement.kind)).toEqual(['best', 'best', 'blunder', 'best']);
    expect(reviewed[2]).toMatchObject({ san: 'Qg4', color: 'w', playedBest: false, phase: 'opening' });
  });

  it('skips moves whose positions are not analysed yet', () => {
    const partial = [evals[0], evals[1], undefined, evals[3], evals[4]];
    expect(reviewMoves(moves, partial).map(m => m.san)).toEqual(['e4', 'Bxg4']);
  });

  it('asks whether each move is book', () => {
    const reviewed = reviewMoves(moves, evals, { isBook: (_fen, m) => m.from === 'e2' && m.to === 'e4' });
    expect(reviewed[0]!.judgement.kind).toBe('book');
  });

  it('sums the game up per side', () => {
    const reviewed = reviewMoves(moves, evals);
    const s = summarizeReview(moves, reviewed, evals);
    expect(s.complete).toBe(true);
    expect(s.sides.w.counts).toMatchObject({ best: 1, blunder: 1 });
    expect(s.sides.b.counts.best).toBe(2);
    expect(s.sides.w.accuracy!).toBeLessThan(s.sides.b.accuracy!);
    expect(s.sides.w.phases.opening).toMatchObject({ moves: 2, errors: 1 });
    // two moves each are too few for a performance estimate
    expect(s.sides.w.performance).toBeNull();
    expect(s.keyMoments.map(m => m.san)).toEqual(['Qg4']);
  });

  it('lists key moments in game order, biggest errors first in the selection', () => {
    const reviewed = reviewMoves(moves, evals);
    expect(keyMoments(reviewed, 1).map(m => m.san)).toEqual(['Qg4']);
  });

  it('writes move numbers and phase sentences', () => {
    expect(moveNumber(moves[2]!)).toBe('2.');
    expect(moveNumber(moves[3]!)).toBe('2…');
    const reviewed = reviewMoves(moves, evals);
    // fewer than 3 moves in a phase: no sentence
    expect(phaseSummary(summarizeReview(moves, reviewed, evals), reviewed, { w: 'Ann', b: 'Bo' })).toEqual([]);
  });

  it('writes a sentence about the best phase and the costliest move', () => {
    const long = gameOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Qe2']);
    const flat = long.map(() => at({ cp: 20 }));
    const ev = [at({ cp: 20 }, ['e2e4']), ...flat];
    ev[6] = at({ cp: 20 }, ['d2d3']);
    ev[7] = at({ cp: -150 }); // Qe2 is an error
    const reviewed = reviewMoves(long, ev);
    const lines = phaseSummary(summarizeReview(long, reviewed, ev), reviewed, { w: 'Ann', b: 'Bo' });
    expect(lines[0]).toMatch(/^Ann played the opening best \(\d+%\); the costliest move was 4\. Qe2 in the opening\.$/);
  });
});

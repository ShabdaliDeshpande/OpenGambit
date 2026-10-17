import { describe, expect, it } from 'vitest';
import { analysisReducer, initialAnalysis, type AnalysisAction, type AnalysisState } from './analysisState';
import { formatEval, pvToSan, whiteShare } from './evalFormat';
import { isMainline, lineEnd, nodeAt } from './tree';

const run = (s: AnalysisState, ...actions: AnalysisAction[]) => actions.reduce(analysisReducer, s);

describe('analysis state', () => {
  it('plays moves, navigates and branches', () => {
    let s = run(initialAnalysis(), { type: 'play', moves: ['e4', 'e5', 'Nf3'] });
    expect(s.path).toEqual(['e2e4', 'e7e5', 'g1f3']);
    s = run(s, { type: 'prev' }, { type: 'prev' }, { type: 'play', moves: ['c5'] });
    expect(s.path).toEqual(['e2e4', 'c7c5']);
    expect(isMainline(s.tree.root, s.path)).toBe(false);
    s = run(s, { type: 'first' }, { type: 'last' });
    expect(s.path).toEqual(['e2e4', 'e7e5', 'g1f3']); // follows the main line
    s = run(s, { type: 'goto', path: ['e2e4', 'c7c5'] }, { type: 'next' });
    expect(s.path).toEqual(['e2e4', 'c7c5']); // nothing after c5
  });

  it('ignores illegal moves and unknown paths', () => {
    const s = initialAnalysis();
    expect(run(s, { type: 'play', moves: ['e5'] })).toBe(s);
    expect(run(s, { type: 'goto', path: ['a2a5'] })).toBe(s);
  });

  it('deletes the current move and steps back to its parent', () => {
    const s = run(initialAnalysis(), { type: 'play', moves: ['d4', 'd5', 'c4'] }, { type: 'prev' }, { type: 'delete' });
    expect(s.path).toEqual(['d2d4']);
    expect(lineEnd(s.tree.root, [])).toEqual(['d2d4']);
  });

  it('promotes the current variation and annotates it', () => {
    let s = run(initialAnalysis(), { type: 'play', moves: ['e4'] }, { type: 'first' }, { type: 'play', moves: ['d4'] });
    s = run(s, { type: 'promote' }, { type: 'nag', nag: 1 }, { type: 'comment', text: 'Queen pawn' });
    expect(s.tree.root.children.map(c => c.san)).toEqual(['d4', 'e4']);
    expect(nodeAt(s.tree.root, ['d2d4'])).toMatchObject({ nags: [1], comment: 'Queen pawn' });
  });
});

describe('eval formatting', () => {
  it('formats centipawns and mates from White’s side', () => {
    expect(formatEval({ cp: 34, mate: null })).toBe('+0.3');
    expect(formatEval({ cp: -250, mate: null })).toBe('−2.5');
    expect(formatEval({ cp: 2, mate: null })).toBe('0.0');
    expect(formatEval({ cp: null, mate: 3 })).toBe('#3');
    expect(formatEval({ cp: null, mate: -2 })).toBe('#−2');
  });

  it('maps evaluations to an eval-bar share', () => {
    expect(whiteShare(null)).toBe(0.5);
    expect(whiteShare({ cp: 0, mate: null })).toBe(0.5);
    expect(whiteShare({ cp: 300, mate: null })).toBeGreaterThan(0.7);
    expect(whiteShare({ cp: -300, mate: null })).toBeLessThan(0.3);
    expect(whiteShare({ cp: null, mate: -1 })).toBe(0);
  });

  it('writes principal variations in SAN with move numbers', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const pv = [
      { from: 'e7', to: 'e5' },
      { from: 'g1', to: 'f3' },
      { from: 'b8', to: 'c6' },
    ] as const;
    expect(pvToSan(afterE4, [...pv])).toBe('1... e5 2. Nf3 Nc6');
    expect(pvToSan(afterE4, [...pv], 1)).toBe('1... e5');
  });
});

import { describe, expect, it } from 'vitest';
import { at } from '../analysis/reviewFixtures';
import type { Puzzle } from '../puzzles/types';
import { explainSolution, puzzleStart, solutionMoves } from './puzzleExplain';

const fork: Puzzle = {
  id: 'test-fork',
  fen: 'r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 w - - 0 1',
  solution: [
    { from: 'd5', to: 'c7' },
    { from: 'e8', to: 'd7' },
    { from: 'c7', to: 'a8' },
  ],
  rating: 1000,
  themes: ['fork'],
  source: 'builtin',
};

describe('puzzle explanations', () => {
  it('starts after the setup move and follows the solution', () => {
    const withSetup: Puzzle = { ...fork, fen: 'r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/3K4 w - - 0 1', setup: { from: 'd1', to: 'e1' } };
    // White's setup move hands the turn to Black, so this one only checks the start position
    expect(puzzleStart(withSetup)).toBe('r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 b - - 1 1');
    expect(solutionMoves(fork).map(m => m.san)).toEqual(['Nc7+', 'Kd7', 'Nxa8']);
  });

  it('explains only the solver’s moves, in Game Review’s words', () => {
    const evals = [
      at({ cp: 350 }, ['d5c7', 'e8d7', 'c7a8'], { cp: -150 }),
      at({ cp: 350 }, ['e8d7', 'c7a8']),
      at({ cp: 350 }, ['c7a8']),
      at({ cp: 360 }, ['d7c6']),
    ];
    const out = explainSolution(fork, evals);
    expect(out.map(m => m.san)).toEqual(['Nc7+', 'Nxa8']);
    expect(out[0]).toMatchObject({ ply: 1, kind: 'great', label: 'Great' });
    expect(out[0]!.text).toMatch(/^Nc7\+ is the only good move here: anything else loses ground\. It .*fork/);
    expect(out[1]).toMatchObject({ ply: 3, kind: 'best' });
  });

  it('leaves out moves whose positions aren’t analysed yet', () => {
    const evals = [at({ cp: 350 }, ['d5c7'], { cp: -150 }), at({ cp: 350 }, ['e8d7'])];
    expect(explainSolution(fork, evals).map(m => m.san)).toEqual(['Nc7+']);
  });
});

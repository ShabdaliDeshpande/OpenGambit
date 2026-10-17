import { describe, expect, it } from 'vitest';
import { parseCsvRow } from './csv';
import { EMPTY_STATS, matches, pickPuzzle, recordResult, themeCounts } from './picker';
import { sessionReducer, startSession, type SessionAction } from './session';
import type { Puzzle } from './types';

const run = (p: Puzzle, ...actions: SessionAction[]) => actions.reduce(sessionReducer, startSession(p));

// mate in two: 1. Qb8+ Rxb8 2. Rxb8#
const mateIn2: Puzzle = {
  id: 't1',
  fen: 'r5k1/5ppp/8/8/8/8/1Q6/1R4K1 w - - 0 1',
  solution: [
    { from: 'b2', to: 'b8' },
    { from: 'a8', to: 'b8' },
    { from: 'b1', to: 'b8' },
  ],
  rating: 1400,
  themes: ['mateIn2', 'sacrifice'],
  source: 'builtin',
};

// same idea, but arising after a setup move by Black (...Kh8 → Kg8 here, purely illustrative)
const withSetup: Puzzle = {
  ...mateIn2,
  id: 't2',
  fen: 'r6k/5ppp/8/8/8/8/1Q6/1R4K1 b - - 0 1',
  setup: { from: 'h8', to: 'g8' },
};

describe('puzzle session', () => {
  it('accepts the solution and plays the opponent replies', () => {
    let s = run(mateIn2, { type: 'move', move: { from: 'b2', to: 'b8' } });
    expect(s.phase).toBe('opponent');
    s = sessionReducer(s, { type: 'opponentMove' });
    expect(s).toMatchObject({ phase: 'playing', step: 2, lastMove: { from: 'a8', to: 'b8' } });
    s = sessionReducer(s, { type: 'move', move: { from: 'b1', to: 'b8' } });
    expect(s).toMatchObject({ phase: 'solved', failed: false });
  });

  it('marks a wrong move, lets it be taken back, and remembers the failure', () => {
    let s = run(mateIn2, { type: 'move', move: { from: 'b2', to: 'b7' } });
    expect(s).toMatchObject({ phase: 'wrong', failed: true });
    s = sessionReducer(s, { type: 'takeBack' });
    expect(s).toMatchObject({ phase: 'playing', fen: mateIn2.fen, failed: true });
    expect(sessionReducer(s, { type: 'move', move: { from: 'a1', to: 'a2' } })).toBe(s); // illegal: ignored
  });

  it('accepts a different checkmate on the final move, but not a different non-mating move', () => {
    // both Ra8# and Qd8# mate; the stored solution is Ra8#
    const p: Puzzle = { ...mateIn2, id: 'm1', fen: '6k1/5ppp/8/8/8/8/8/R2Q2K1 w - - 0 1', solution: [{ from: 'a1', to: 'a8' }] };
    expect(run(p, { type: 'move', move: { from: 'd1', to: 'd8' } })).toMatchObject({ phase: 'solved', failed: false });
    expect(run(p, { type: 'move', move: { from: 'd1', to: 'd5' } }).phase).toBe('wrong');
  });

  it('plays the setup move first and the solver is the other side', () => {
    let s = startSession(withSetup);
    expect(s).toMatchObject({ phase: 'setup', solver: 'w' });
    expect(sessionReducer(s, { type: 'move', move: { from: 'b2', to: 'b8' } })).toBe(s); // not yet
    s = sessionReducer(s, { type: 'setupMove' });
    expect(s).toMatchObject({ phase: 'playing', fen: mateIn2.fen.replace('w - - 0 1', 'w - - 1 2') });
  });

  it('hint shows the piece to move and counts as a failure; reveal plays out the solution', () => {
    let s = run(mateIn2, { type: 'hint' });
    expect(s).toMatchObject({ hint: 'b2', failed: true });
    s = sessionReducer(s, { type: 'reveal' });
    expect(s.phase).toBe('revealing');
    for (let i = 0; i < 3; i++) s = sessionReducer(s, { type: 'revealStep' });
    expect(s.phase).toBe('solved');
    expect(sessionReducer(s, { type: 'retry' })).toMatchObject({ phase: 'playing', step: 0, failed: true });
  });
});

describe('puzzle picking and stats', () => {
  const pool: Puzzle[] = [
    { ...mateIn2, id: 'a', rating: 1000, themes: ['mateIn1'] },
    { ...mateIn2, id: 'b', rating: 1500, themes: ['fork', 'advantage'] },
    { ...mateIn2, id: 'c', rating: 1900, themes: ['mateIn2'] },
  ];

  it('filters by difficulty and theme', () => {
    expect(matches(pool[0]!, { theme: '', difficulty: 'easy' })).toBe(true);
    expect(matches(pool[1]!, { theme: 'fork', difficulty: 'medium' })).toBe(true);
    expect(matches(pool[2]!, { theme: 'fork', difficulty: 'any' })).toBe(false);
    expect(themeCounts(pool)[0]).toEqual(['advantage', 1]);
  });

  it('prefers puzzles not attempted yet and avoids repeating the current one', () => {
    const stats = { ...EMPTY_STATS, solved: ['a'], failed: ['b'] };
    expect(pickPuzzle(pool, { theme: '', difficulty: 'any' }, stats, null, () => 0)?.id).toBe('c');
    expect(pickPuzzle(pool, { theme: '', difficulty: 'any' }, { ...EMPTY_STATS, solved: ['a', 'b', 'c'] }, 'a', () => 0)?.id).toBe('b');
    expect(pickPuzzle(pool, { theme: 'pin', difficulty: 'any' }, EMPTY_STATS, null)).toBeNull();
  });

  it('tracks streaks', () => {
    let s = recordResult(EMPTY_STATS, 'a', true);
    s = recordResult(s, 'b', true);
    expect(s).toMatchObject({ streak: 2, bestStreak: 2, solved: ['a', 'b'] });
    s = recordResult(s, 'a', false);
    expect(s).toMatchObject({ streak: 0, bestStreak: 2, solved: ['b'], failed: ['a'] });
  });
});

describe('puzzle CSV rows', () => {
  it('parses the common column layout, treating the first move as the setup', () => {
    const p = parseCsvRow('00abc,r5k1/5ppp/8/8/8/8/1Q6/1R4K1 b - - 0 1,g8h8 b2b8 a8b8 b1b8,1532,75,95,1200,backRankMate mateIn2,https://example.test/x,')!;
    expect(p).toMatchObject({ id: 'imp-00abc', rating: 1532, themes: ['backRankMate', 'mateIn2'], setup: { from: 'g8', to: 'h8' }, source: 'imported' });
    expect(p.solution.map(m => m.from + m.to)).toEqual(['b2b8', 'a8b8', 'b1b8']);
    expect(parseCsvRow('00abc,x,y,1')).toBeNull();
    expect(parseCsvRow('PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags')).toBeNull();
    expect(parseCsvRow('p,8/P7/8/8/8/8/8/k6K w - - 0 1,h1g1 a7a8q,900,,,,,')!.solution[0]).toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });
});

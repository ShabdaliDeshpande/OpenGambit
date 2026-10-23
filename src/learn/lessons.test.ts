import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ALL_LEVELS, STAGES } from './lessons';
import { levelReducer, passTo, startLevel, starsFor, type LevelState } from './level';

/** A way through each level, in UCI: the learner's moves only. */
const SOLUTIONS: Record<string, string[]> = {
  'rook-1': ['a1a6', 'a6f6', 'f6f2'],
  'rook-2': ['d4g4', 'g4g1', 'g1b1'],
  'bishop-1': ['c1e3', 'e3g5', 'g5d8'],
  'bishop-2': ['f1c4', 'c4a6', 'a6c8'],
  'queen-1': ['d1d5', 'd5a2', 'a2f7'],
  'queen-2': ['c1c5', 'c5f2', 'f2b6', 'b6a7'],
  'knight-1': ['b1c3', 'c3e4', 'e4f6'],
  'knight-2': ['g1f3', 'f3d4', 'd4b5', 'b5c7'],
  'king-1': ['e1e2', 'e2e3', 'e3f4', 'f4g4'],
  'pawn-1': ['e2e4', 'e4e5', 'e5e6'],
  'pawn-2': ['b7b8q'],
  'capture-1': ['a1a5', 'a5e5', 'e5e8'],
  'capture-2': ['d4c6', 'c6e7', 'e7f5'],
  'capture-3': ['e3d4', 'g3f4'],
  'check-1': ['d1a4'],
  'check-2': ['h1e1'],
  'mate-1': ['d1d8'],
  'mate-2': ['a1a8'],
  'mate-3': ['h1h8'],
  'stalemate-1': ['f1f8'],
  'castle-1': ['e1g1'],
  'castle-2': ['e1c1'],
  'en-passant-1': ['e5d6'],
};

/** Plays a level through, letting the other side's line moves happen. */
function playThrough(id: string): LevelState {
  const level = ALL_LEVELS.find(l => l.id === id)!;
  let s = startLevel(level);
  for (const uci of SOLUTIONS[id]!) {
    while (s.status === 'reply') s = levelReducer(s, { type: 'reply' });
    s = levelReducer(s, { type: 'move', uci });
  }
  while (s.status === 'reply') s = levelReducer(s, { type: 'reply' });
  return s;
}

describe('lessons', () => {
  it('has unique ids and a solution for every level', () => {
    const ids = ALL_LEVELS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SOLUTIONS).sort()).toEqual([...ids].sort());
    expect(STAGES.every(s => s.levels.length > 0 && s.intro.length > 20)).toBe(true);
  });

  it.each(ALL_LEVELS.map(l => [l.id] as const))('%s starts from a legal position and is solved within par for three stars', id => {
    const level = ALL_LEVELS.find(l => l.id === id)!;
    expect(() => new Chess(level.fen)).not.toThrow();
    const s = playThrough(id);
    expect(s.status).toBe('done');
    expect(s.moves).toBeLessThanOrEqual(level.par);
    expect(starsFor(s)).toBe(3);
  });

  it('never leaves the other side in check while it “passes”', () => {
    for (const level of ALL_LEVELS.filter(l => l.goal.kind === 'collect' || l.goal.kind === 'capture' || l.goal.kind === 'promote')) {
      let s = startLevel(level);
      for (const uci of SOLUTIONS[level.id]!) {
        s = levelReducer(s, { type: 'move', uci });
        if (s.status !== 'done') {
          const waiting = new Chess(passTo(s.fen, s.learner === 'w' ? 'b' : 'w'));
          expect(waiting.inCheck(), `${level.id} after ${uci}`).toBe(false);
        }
      }
    }
  });
});

describe('lesson rules', () => {
  const level = (id: string) => ALL_LEVELS.find(l => l.id === id)!;

  it('counts stars and gives the turn back in star levels', () => {
    let s = startLevel(level('rook-1'));
    s = levelReducer(s, { type: 'move', uci: 'a1a6' });
    expect(s.collected).toEqual(['a6']);
    expect(s.fen.split(' ')[1]).toBe('w');
    expect(s.status).toBe('playing');
  });

  it('turns a wrong answer into a mistake you can take back', () => {
    let s = startLevel(level('mate-1'));
    s = levelReducer(s, { type: 'move', uci: 'd1d7' });
    expect(s.status).toBe('wrong');
    expect(s.message).toMatch(/isn’t checkmate/);
    s = levelReducer(s, { type: 'retry' });
    expect(s.fen).toBe(level('mate-1').fen);
    s = levelReducer(s, { type: 'move', uci: 'd1d8' });
    expect(s.status).toBe('done');
    expect(starsFor(s)).toBe(2); // one mistake
  });

  it('recognises stalemate and explains it', () => {
    let s = startLevel(level('stalemate-1'));
    s = levelReducer(s, { type: 'move', uci: 'f1f7' });
    expect(s.message).toMatch(/stalemate/);
  });

  it('plays the other side’s move in a line, and wants the right reply', () => {
    let s = startLevel(level('en-passant-1'));
    expect(s.status).toBe('reply');
    s = levelReducer(s, { type: 'reply' });
    expect(s.status).toBe('playing');
    const wrong = levelReducer(s, { type: 'move', uci: 'e5e6' });
    expect(wrong.status).toBe('wrong');
    expect(levelReducer(s, { type: 'move', uci: 'e5d6' }).status).toBe('done');
  });

  it('takes stars away for extra moves', () => {
    expect(starsFor({ level: level('rook-1'), moves: 3, mistakes: 0 })).toBe(3);
    expect(starsFor({ level: level('rook-1'), moves: 5, mistakes: 0 })).toBe(2);
    expect(starsFor({ level: level('rook-1'), moves: 9, mistakes: 0 })).toBe(1);
  });
});

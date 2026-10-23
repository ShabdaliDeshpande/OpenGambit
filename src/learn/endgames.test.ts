import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { analyse } from '../engine/search';
import { endgameOutcome, ENDGAMES, practiceVerdict } from './endgames';

const fakeNow = () => {
  let t = 0;
  return () => (t += 1);
};

describe('endgame practice', () => {
  it('starts every position legally, with you to move', () => {
    for (const e of ENDGAMES) {
      const c = new Chess(e.fen);
      expect(c.isGameOver(), e.id).toBe(false);
      expect(c.turn(), e.id).toBe('w');
    }
  });

  it('gives the attacker a real win, and the defender a real draw', () => {
    for (const e of ENDGAMES) {
      const line = analyse(e.fen, [], { maxDepth: 6, now: fakeNow(), maxMs: 1e12 })!.lines[0]!;
      const white = line.mate !== null ? (line.mate > 0 ? 10_000 : -10_000) : line.cp!;
      if (e.goal.kind === 'hold') expect(white, e.id).toBeGreaterThan(-400);
      // a won pawn ending only looks a few pawns up to a short search
      else expect(white, e.id).toBeGreaterThan(e.goal.kind === 'promote' ? 150 : 300);
    }
  });

  it('grades moves with lila’s practice thresholds', () => {
    expect(practiceVerdict({ cp: 100 }, { cp: 95 }, 'w')).toBe('good');
    expect(practiceVerdict({ cp: 100 }, { cp: 70 }, 'w')).toBe('inaccuracy'); // drop 0.054
    expect(practiceVerdict({ cp: 100 }, { cp: 30 }, 'w')).toBe('mistake'); // drop 0.127
    expect(practiceVerdict({ cp: 100 }, { cp: -300 }, 'w')).toBe('blunder');
    // seen from Black: going from −1 to +2 is a blunder
    expect(practiceVerdict({ cp: -100 }, { cp: 200 }, 'b')).toBe('blunder');
    expect(practiceVerdict({ cp: -100 }, { cp: -95 }, 'b')).toBe('good');
  });

  it('decides mate goals', () => {
    const goal = { kind: 'mate', within: 3 } as const;
    expect(endgameOutcome(goal, '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', 1, 'w', false, { cp: 900 }).outcome).toBe('playing');
    expect(endgameOutcome(goal, 'Q6k/8/6K1/8/8/8/8/8 b - - 1 1', 2, 'w', false, { mated: 'b' })).toEqual({ outcome: 'won', message: 'Checkmate in 2 moves!' });
    expect(endgameOutcome(goal, '7k/5Q2/6K1/8/8/8/8/8 b - - 1 1', 2, 'w', false, { cp: 0 }).message).toMatch(/Stalemate/);
    expect(endgameOutcome(goal, '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', 3, 'w', false, { cp: 900 }).outcome).toBe('lost');
  });

  it('decides promotion and holding goals', () => {
    const promote = { kind: 'promote', within: 8 } as const;
    expect(endgameOutcome(promote, '4Q3/8/4K3/8/8/8/8/k7 b - - 0 1', 4, 'w', true, { cp: 900 }).outcome).toBe('won');
    expect(endgameOutcome(promote, '4k3/8/4K3/8/8/8/8/8 w - - 0 1', 4, 'w', false, { cp: 0 }).message).toMatch(/pawn was lost/);
    const hold = { kind: 'hold', moves: 10 } as const;
    expect(endgameOutcome(hold, '8/8/8/8/4k3/4p3/8/4K3 w - - 0 1', 10, 'w', false, { cp: -50 }).outcome).toBe('won');
    expect(endgameOutcome(hold, '8/8/8/8/4k3/4p3/8/4K3 w - - 0 1', 4, 'w', false, { cp: -900 }).outcome).toBe('lost');
    expect(endgameOutcome(hold, '8/8/8/8/8/8/8/k1K5 w - - 0 1', 4, 'w', false, { cp: 0 }).outcome).toBe('won'); // drawn: only kings
  });
});

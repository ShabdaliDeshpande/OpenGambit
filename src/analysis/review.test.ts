import { describe, expect, it } from 'vitest';
import { classify, judge, winningChances, type Score } from './review';

const cp = (v: number): Score => ({ cp: v });

describe('winning chances', () => {
  it('follows the logistic curve, symmetric for both sides', () => {
    expect(winningChances(cp(0), 'w')).toBeCloseTo(0, 6);
    expect(winningChances(cp(300), 'w')).toBeCloseTo(0.503, 2);
    expect(winningChances(cp(300), 'b')).toBeCloseTo(-0.503, 2);
    expect(winningChances(cp(5000), 'w')).toBe(winningChances(cp(1000), 'w')); // capped
    expect(winningChances({ mate: 3 }, 'w')).toBe(1);
    expect(winningChances({ mate: -2 }, 'w')).toBe(-1);
    expect(winningChances({ mated: 'b' }, 'w')).toBe(1);
  });
});

describe('judging moves', () => {
  it('uses lila’s thresholds for bad moves', () => {
    // White goes from +0.5 to −0.2: chances drop about 0.13 → inaccuracy
    expect(judge(cp(50), cp(-20), 'w', false).kind).toBe('inaccuracy');
    // +0.8 to −0.6: about 0.26 → mistake
    expect(judge(cp(80), cp(-60), 'w', false).kind).toBe('mistake');
    // +1 to −1 near equality is already a blunder on this scale (about 0.36)
    expect(judge(cp(100), cp(-100), 'w', false).kind).toBe('blunder');
    expect(judge(cp(200), cp(-300), 'w', false).kind).toBe('blunder');
    // the same drop seen from Black's side
    expect(judge(cp(-200), cp(300), 'b', false).kind).toBe('blunder');
  });

  it('calls the engine’s move or an equal one best, small losses excellent or good', () => {
    expect(judge(cp(30), cp(25), 'w', true).kind).toBe('best');
    expect(judge(cp(30), cp(30), 'w', false).kind).toBe('best');
    expect(judge(cp(30), cp(10), 'w', false).kind).toBe('excellent');
    expect(judge(cp(60), cp(10), 'w', false).kind).toBe('good');
    expect(judge(cp(60), cp(0), 'w', false).kind).toBe('inaccuracy'); // 0.11
    // winning big already: losing 1 pawn barely changes the chances
    expect(judge(cp(900), cp(800), 'w', false).kind).not.toMatch(/mistake|blunder/);
  });

  it('judges forced mates like lila', () => {
    // walking into a forced mate from an equal position
    expect(judge(cp(0), { mate: -3 }, 'w', false).kind).toBe('blunder');
    // already lost anyway
    expect(judge(cp(-1200), { mate: -3 }, 'w', false).kind).toBe('inaccuracy');
    expect(judge(cp(-800), { mate: -3 }, 'w', false).kind).toBe('mistake');
    // letting a forced mate slip, but still winning easily
    expect(judge({ mate: 2 }, cp(1500), 'w', false).kind).toBe('inaccuracy');
    expect(judge({ mate: 2 }, cp(100), 'w', false).kind).toBe('blunder');
    // delivering mate is best
    expect(judge({ mate: 1 }, { mated: 'b' }, 'w', true).kind).toBe('best');
  });

  it('turns the win-percentage drop into accuracy', () => {
    expect(judge(cp(0), cp(0), 'w', true).accuracy).toBeCloseTo(100, 0);
    const blunder = judge(cp(200), cp(-500), 'w', false).accuracy;
    expect(blunder).toBeLessThan(30);
    expect(blunder).toBeGreaterThanOrEqual(0);
  });
});

describe('full classes', () => {
  const base = { mover: 'w' as const, playedBest: false };

  it('marks opening theory as book, whatever the engine thinks', () => {
    expect(classify({ ...base, before: cp(30), after: cp(-80), book: true }).kind).toBe('book');
  });

  it('calls a failure to punish the opponent’s mistake a miss', () => {
    // Black just blundered; White gives part of it back (an inaccuracy on its own)
    expect(classify({ ...base, before: cp(300), after: cp(180), previous: 'blunder' }).kind).toBe('miss');
    // the same move after a normal opponent move is just an inaccuracy
    expect(classify({ ...base, before: cp(300), after: cp(180), previous: 'good' }).kind).toBe('inaccuracy');
    // a blunder stays a blunder
    expect(classify({ ...base, before: cp(300), after: cp(-300), previous: 'blunder' }).kind).toBe('blunder');
  });

  it('calls a lost forced mate a miss while still clearly winning', () => {
    expect(classify({ ...base, before: { mate: 3 }, after: cp(1500) }).kind).toBe('miss');
  });

  it('calls a sacrifice the engine likes brilliant', () => {
    expect(classify({ ...base, before: cp(40), after: cp(60), playedBest: true, offered: 3 }).kind).toBe('brilliant');
    // giving up material when already completely winning is just best
    expect(classify({ ...base, before: cp(900), after: cp(950), playedBest: true, offered: 3 }).kind).toBe('best');
    // a sacrifice that leaves you worse is not brilliant, even if it is the best try
    expect(classify({ ...base, before: cp(-200), after: cp(-200), playedBest: true, offered: 3 }).kind).toBe('best');
    // only material counts: a pawn is not a sacrifice
    expect(classify({ ...base, before: cp(40), after: cp(40), playedBest: true, offered: 1 }).kind).toBe('best');
  });

  it('calls the only move that holds great', () => {
    // everything else loses at least 0.2 of the winning chances
    expect(classify({ ...base, before: cp(0), after: cp(0), playedBest: true, second: cp(-250) }).kind).toBe('great');
    expect(classify({ ...base, before: cp(0), after: cp(0), playedBest: true, second: cp(-20) }).kind).toBe('best');
    // finding an equally good second choice is not great
    expect(classify({ ...base, before: cp(0), after: cp(0), playedBest: false, second: cp(-250) }).kind).toBe('best');
  });

  it('only works out the sacrifice when it matters', () => {
    let calls = 0;
    const offered = () => {
      calls++;
      return 3;
    };
    classify({ ...base, before: cp(300), after: cp(-300), offered });
    expect(calls).toBe(0);
    classify({ ...base, before: cp(0), after: cp(0), playedBest: true, offered });
    expect(calls).toBe(1);
  });
});

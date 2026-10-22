import { describe, expect, it } from 'vitest';
import { judge, summarize, winningChances, type Score } from './review';

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

describe('summary', () => {
  it('counts each kind and averages accuracy per side', () => {
    const s = summarize([
      { color: 'w', judgement: judge(cp(0), cp(0), 'w', true) },
      { color: 'b', judgement: judge(cp(0), cp(300), 'b', false) },
      { color: 'w', judgement: judge(cp(300), cp(300), 'w', true) },
    ]);
    expect(s.w.counts).toMatchObject({ best: 2, blunder: 0 });
    expect(s.b.counts.blunder).toBe(1);
    expect(s.w.accuracy).toBeGreaterThan(95);
    expect(s.b.accuracy).toBeLessThan(40);
  });
});

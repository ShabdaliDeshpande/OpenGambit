import { describe, expect, it } from 'vitest';
import { createClock, findTimeControl, flaggedColor, formatClock, pressClock, remainingMs, stopClock } from './clock';
import { createGame } from './game';
import { playSan } from './testUtils';

const tc = (id: string) => findTimeControl(id)!;

describe('clock model', () => {
  it('has the five required presets', () => {
    for (const id of ['1+0', '3+2', '5+0', '10+0', '15+10']) expect(findTimeControl(id)).not.toBeNull();
  });

  it('the first move starts the opponent clock without charging or adding time', () => {
    const c = pressClock(createClock(tc('3+2')), 'w', 500);
    expect(c.active).toBe('b');
    expect(c.remaining.w).toBe(180_000);
    expect(remainingMs(c, 'b', 2_500)).toBe(178_000);
  });

  it('charges elapsed time and adds the increment after each move', () => {
    let c = pressClock(createClock(tc('3+2')), 'w', 0); // black to move
    c = pressClock(c, 'b', 5_000); // black used 5s, +2s
    expect(c.remaining.b).toBe(177_000);
    c = pressClock(c, 'w', 8_000); // white used 3s, +2s
    expect(c.remaining.w).toBe(179_000);
    expect(c.active).toBe('b');
  });

  it('15+10 adds ten seconds per move', () => {
    let c = pressClock(createClock(tc('15+10')), 'w', 0);
    c = pressClock(c, 'b', 1_000);
    expect(c.remaining.b).toBe(900_000 - 1_000 + 10_000);
  });

  it('an increment can push the clock above its starting value', () => {
    let c = pressClock(createClock(tc('3+2')), 'w', 0);
    c = pressClock(c, 'b', 100);
    expect(c.remaining.b).toBe(181_900);
  });

  it('only the running side loses time', () => {
    const c = pressClock(createClock(tc('5+0')), 'w', 0);
    expect(remainingMs(c, 'w', 10_000)).toBe(300_000);
    expect(remainingMs(c, 'b', 10_000)).toBe(290_000);
  });

  it('reports the flagged side at zero', () => {
    const c = pressClock(createClock(tc('1+0')), 'w', 0);
    expect(flaggedColor(c, 59_999)).toBeNull();
    expect(flaggedColor(c, 60_000)).toBe('b');
    expect(remainingMs(c, 'b', 90_000)).toBe(0);
  });

  it('stopping settles the running side', () => {
    const c = stopClock(pressClock(createClock(tc('1+0')), 'w', 0), 4_000);
    expect(c.active).toBeNull();
    expect(c.remaining.b).toBe(56_000);
  });

  it('formats times', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(9_450)).toBe('0:09.4');
    expect(formatClock(-5)).toBe('0:00.0');
    expect(formatClock(3_600_000)).toBe('1:00:00');
  });
});

describe('clock inside a game', () => {
  it('applies the 3+2 increment through the reducer', () => {
    const s = playSan(createGame({ mode: 'local', humanColor: 'w', level: 1, timeControlId: '3+2' }), ['e4', 'e5', 'Nf3'], 0, 4_000);
    // e4 @0 starts black; e5 @4000: black -4s +2s; Nf3 @8000: white -4s +2s
    expect(s.clock?.remaining.b).toBe(178_000);
    expect(s.clock?.remaining.w).toBe(178_000);
    expect(s.clock?.active).toBe('b');
  });
});

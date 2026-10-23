import { describe, expect, it } from 'vitest';
import { linear, nearestIndex, niceTicks, pointAtOrBefore } from './scale';

describe('chart scales', () => {
  it('picks round ticks that cover the data', () => {
    expect(niceTicks(1432, 1618)).toEqual([1400, 1450, 1500, 1550, 1600, 1650]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(62.5, 91.2)).toEqual([60, 70, 80, 90, 100]);
    const flat = niceTicks(1500, 1500);
    expect(flat[0]!).toBeLessThan(1500);
    expect(flat.at(-1)!).toBeGreaterThan(1500);
  });

  it('maps values and finds the nearest point', () => {
    const x = linear(0, 10, 100, 200);
    expect(x(5)).toBe(150);
    expect(linear(3, 3, 0, 10)(3)).toBe(5);
    expect(nearestIndex([1, 5, 9], 6)).toBe(1);
    expect(nearestIndex([1, 5, 9], 8)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it('reads a series value at a time', () => {
    const pts = [
      { t: 10, v: 1 },
      { t: 20, v: 2 },
    ];
    expect(pointAtOrBefore(pts, 5)).toBeNull();
    expect(pointAtOrBefore(pts, 15)).toEqual({ t: 10, v: 1 });
    expect(pointAtOrBefore(pts, 25)).toEqual({ t: 20, v: 2 });
  });
});

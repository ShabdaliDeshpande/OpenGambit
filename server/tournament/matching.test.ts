import { describe, expect, it } from 'vitest';
import { EXACT_LIMIT, minCostMatching } from './matching.ts';

/** Brute force over all matchings, for checking. */
function brute(n: number, cost: (i: number, j: number) => number | null, single: (i: number) => number | null): number {
  const go = (left: number[]): number => {
    if (left.length === 0) return 0;
    const [i, ...rest] = left as [number, ...number[]];
    let best = Number.POSITIVE_INFINITY;
    const s = single(i);
    if (s !== null) best = s + go(rest);
    rest.forEach((j, k) => {
      const c = cost(i, j);
      if (c !== null) best = Math.min(best, c + go(rest.filter((_, x) => x !== k)));
    });
    return best;
  };
  return go(Array.from({ length: n }, (_, i) => i));
}

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

describe('minimum-cost matching', () => {
  it('pairs neighbours when cost is distance', () => {
    const m = minCostMatching(6, (i, j) => Math.abs(i - j), () => null)!;
    expect(m.pairs).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(m.cost).toBe(3);
  });

  it('avoids forbidden pairs, leaves one out when odd, and fails when impossible', () => {
    const m = minCostMatching(4, (i, j) => (i === 0 && j === 1 ? null : Math.abs(i - j)), () => null)!;
    expect(m.pairs).toEqual([
      [0, 2],
      [1, 3],
    ]);
    const odd = minCostMatching(3, (i, j) => Math.abs(i - j), i => (i === 2 ? 0 : null))!;
    expect(odd).toMatchObject({ pairs: [[0, 1]], singles: [2] });
    expect(minCostMatching(2, () => null, () => null)).toBeNull();
  });

  it('finds the optimum on random instances (exact solver)', () => {
    const r = rng(7);
    for (let t = 0; t < 30; t++) {
      const n = 2 + Math.floor(r() * 7);
      const table = Array.from({ length: n }, () => Array.from({ length: n }, () => (r() < 0.15 ? null : Math.floor(r() * 100))));
      const cost = (i: number, j: number) => table[i]![j]!;
      const single = (i: number) => (i % 3 === 0 ? 150 : null);
      const m = minCostMatching(n, cost, single);
      const expected = brute(n, cost, single);
      if (!Number.isFinite(expected)) expect(m).toBeNull();
      else expect(m!.cost).toBe(expected);
    }
  });

  it('gives a valid, close-to-optimal matching for big groups (heuristic)', () => {
    const n = EXACT_LIMIT + 12;
    const m = minCostMatching(n, (i, j) => (j === i + 1 && i % 2 === 0 ? null : Math.abs(i - j)), () => null)!;
    const seen = new Set(m.pairs.flat());
    expect(seen.size).toBe(n);
    for (const [i, j] of m.pairs) expect(j === i + 1 && i % 2 === 0).toBe(false);
    expect(m.cost).toBeLessThanOrEqual(2 * n); // optimum here is about n
  });
});

// Minimum-cost matching for tournament pairings.
//
// Players are numbered 0..n-1. `cost(i, j)` is the price of pairing i with j,
// or null when they must not meet. `single(i)` is the price of leaving i
// unpaired this time (null = not allowed). The result pairs everyone at the
// lowest total price found.

export type Cost = (i: number, j: number) => number | null;

export interface Matching {
  pairs: [number, number][];
  singles: number[];
  cost: number;
}

/** Up to this many players the search is exact; above it a heuristic is used. */
export const EXACT_LIMIT = 18;

export function minCostMatching(n: number, cost: Cost, single: (i: number) => number | null): Matching | null {
  if (n === 0) return { pairs: [], singles: [], cost: 0 };
  return n <= EXACT_LIMIT ? exact(n, cost, single) : heuristic(n, cost, single);
}

/** Dynamic programming over subsets: always settle the lowest unsettled player. */
function exact(n: number, cost: Cost, single: (i: number) => number | null): Matching | null {
  const full = (1 << n) - 1;
  const best = new Float64Array(1 << n).fill(Number.POSITIVE_INFINITY);
  const choice = new Int8Array(1 << n).fill(-2);
  best[full] = 0;
  const costs: (number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < n; j++) row.push(i < j ? cost(i, j) : null);
    costs.push(row);
  }
  const singles = Array.from({ length: n }, (_, i) => single(i));
  for (let mask = full - 1; mask >= 0; mask--) {
    let i = 0;
    while (mask & (1 << i)) i++;
    const withI = mask | (1 << i);
    let value = Number.POSITIVE_INFINITY;
    let pick = -2;
    const s = singles[i]!;
    if (s !== null && best[withI]! + s < value) {
      value = best[withI]! + s;
      pick = -1;
    }
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j)) continue;
      const c = costs[i]![j]!;
      if (c === null) continue;
      const v = best[withI | (1 << j)]! + c;
      if (v < value) {
        value = v;
        pick = j;
      }
    }
    best[mask] = value;
    choice[mask] = pick;
  }
  if (!Number.isFinite(best[0]!)) return null;
  const pairs: [number, number][] = [];
  const left: number[] = [];
  let mask = 0;
  while (mask !== full) {
    let i = 0;
    while (mask & (1 << i)) i++;
    const j = choice[mask]!;
    if (j === -1) {
      left.push(i);
      mask |= 1 << i;
    } else {
      pairs.push([i, j]);
      mask |= (1 << i) | (1 << j);
    }
  }
  return { pairs, singles: left, cost: best[0]! };
}

/**
 * Greedy in input order (the caller sorts by rank), then improved by moving
 * partners between two players' pairs while that lowers the total.
 */
function heuristic(n: number, cost: Cost, single: (i: number) => number | null): Matching | null {
  const INF = Number.POSITIVE_INFINITY;
  const pc = (i: number, j: number) => (cost(Math.min(i, j), Math.max(i, j)) ?? INF);
  const sc = (i: number) => single(i) ?? INF;
  const partner = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    if (partner[i] !== -1) continue;
    let bestJ = -1;
    let bestC = INF;
    for (let j = i + 1; j < n; j++) {
      if (partner[j] !== -1) continue;
      const v = pc(i, j);
      if (v < bestC) {
        bestC = v;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestC < INF && bestC <= sc(i) + sc(bestJ)) {
      partner[i] = bestJ;
      partner[bestJ] = i;
    }
  }

  // try pairing a with b instead, re-pairing (or leaving single) their old partners
  for (let round = 0, improved = true; improved && round < 100; round++) {
    improved = false;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const pa = partner[a]!;
        const pb = partner[b]!;
        if (pa === b) continue;
        const now = (pa >= 0 ? pc(a, pa) : sc(a)) + (pb >= 0 ? pc(b, pb) : sc(b));
        const rest = pa >= 0 && pb >= 0 ? pc(pa, pb) : pa >= 0 ? sc(pa) : pb >= 0 ? sc(pb) : 0;
        const next = pc(a, b) + rest;
        // the old pairs each counted once in `now`, except when both were paired: then now covers both pairs
        if (next < now - 1e-9) {
          if (pa >= 0 && pb >= 0) {
            partner[pa] = pb;
            partner[pb] = pa;
          } else if (pa >= 0) partner[pa] = -1;
          else if (pb >= 0) partner[pb] = -1;
          partner[a] = b;
          partner[b] = a;
          improved = true;
        }
      }
    // two unpaired players who can't meet: split an existing pair between them
    const alone = [...partner.keys()].filter(i => partner[i] === -1);
    for (let s = 0; s < alone.length; s++)
      for (let t = s + 1; t < alone.length; t++) {
        const [u, v] = [alone[s]!, alone[t]!];
        if (partner[u] !== -1 || partner[v] !== -1) continue;
        const now = sc(u) + sc(v);
        for (let x = 0; x < n; x++) {
          const y = partner[x]!;
          if (y < x) continue;
          const pair = pc(x, y);
          for (const [p, q] of [
            [x, y],
            [y, x],
          ] as const) {
            if (pc(u, p) + pc(v, q) < now + pair - 1e-9) {
              partner[u] = p;
              partner[p] = u;
              partner[v] = q;
              partner[q] = v;
              improved = true;
              break;
            }
          }
          if (partner[u] !== -1) break;
        }
      }
  }

  const pairs: [number, number][] = [];
  const left: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = partner[i]!;
    if (p < 0) {
      const s = single(i);
      if (s === null) return null;
      left.push(i);
      total += s;
    } else if (i < p) {
      const c = cost(i, p);
      if (c === null) return null;
      pairs.push([i, p]);
      total += c;
    }
  }
  return { pairs, singles: left, cost: total };
}

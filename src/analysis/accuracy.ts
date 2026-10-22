// Winning chances and accuracy, following lila's published formulas (see
// docs/lila-feature-map.md §13). No imports, so the server can use the same
// code to work out the accuracy of a saved review.

export type Side = 'w' | 'b';

/** An evaluation from White's point of view. `mated` is a finished game: that side is checkmated. */
export type Score = { cp: number } | { mate: number } | { mated: Side };

/** Centipawns for `pov` (mates count as ±1000, a finished mate as ±1000 too). */
export function povCp(score: Score, pov: Side): number {
  const sign = pov === 'w' ? 1 : -1;
  if ('cp' in score) return sign * score.cp;
  if ('mate' in score) return sign * (score.mate > 0 ? 1000 : -1000);
  return score.mated === pov ? -1000 : 1000;
}

/** Winning chances for `pov` between −1 and 1 (the logistic curve lila uses). */
export function winningChances(score: Score, pov: Side): number {
  if ('mated' in score) return score.mated === pov ? -1 : 1;
  if ('mate' in score) return (score.mate > 0) === (pov === 'w') ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, povCp(score, pov)));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

/** White's win percentage, 0–100. */
export const whiteWinPercent = (score: Score) => 50 + 50 * winningChances(score, 'w');

/**
 * Accuracy of one move from the mover's win percentage before and after it:
 * 100 when it didn't drop, otherwise lila's fitted curve plus 1 for the
 * engine's own uncertainty, kept between 0 and 100.
 */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

const stdDev = (xs: readonly number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
};

/**
 * Accuracy per side for a run of positions, as lila computes it: the average
 * of a volatility-weighted mean and the harmonic mean of the move accuracies.
 * `win` holds White's win percentage for every position, the first one before
 * any move; `firstMover` is the side that plays the first move.
 */
export function gameAccuracy(win: readonly number[], firstMover: Side): Record<Side, number | null> {
  const moves = win.length - 1;
  const out: Record<Side, number | null> = { w: null, b: null };
  if (moves < 1) return out;
  // a window of moves ÷ 10 positions (2 to 8) measures how sharp each moment was
  const size = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < Math.min(size, win.length) - 2; i++) windows.push(win.slice(0, size));
  for (let i = 0; i + size <= win.length; i++) windows.push(win.slice(i, i + size));

  const per: Record<Side, { acc: number; weight: number }[]> = { w: [], b: [] };
  for (let i = 0; i < moves; i++) {
    const side: Side = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b';
    const [p, n] = [win[i]!, win[i + 1]!];
    const acc = side === 'w' ? moveAccuracy(p, n) : moveAccuracy(100 - p, 100 - n);
    const window = windows[i] ?? win.slice(Math.max(0, i + 1 - size), i + 1);
    per[side].push({ acc, weight: Math.max(0.5, Math.min(12, stdDev(window))) });
  }
  for (const side of ['w', 'b'] as const) {
    const xs = per[side];
    if (xs.length === 0) continue;
    const weighted = xs.reduce((s, x) => s + x.acc * x.weight, 0) / xs.reduce((s, x) => s + x.weight, 0);
    // a single 0% move would make the harmonic mean 0, so each move counts as at least 1%
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(1, x.acc), 0);
    out[side] = Math.round(((weighted + harmonic) / 2) * 10) / 10;
  }
  return out;
}

/** Average centipawn loss per side (each loss at least 0, evaluations capped at ±1000). */
export function averageCpl(scores: readonly Score[], firstMover: Side): Record<Side, number | null> {
  const losses: Record<Side, number[]> = { w: [], b: [] };
  for (let i = 0; i + 1 < scores.length; i++) {
    const side: Side = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b';
    losses[side].push(Math.max(0, povCp(scores[i]!, side) - povCp(scores[i + 1]!, side)));
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return { w: avg(losses.w), b: avg(losses.b) };
}

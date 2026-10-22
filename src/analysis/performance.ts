// A rough performance estimate for one game, from accuracy. lila has nothing
// like it; the anchor points below are our own choice, and the app always
// shows the result as an estimate, never as a rating. No imports, so the
// server can compute it for saved reviews.

/** [accuracy %, rating] anchors; values between them are interpolated. */
const ANCHORS: readonly [number, number][] = [
  [0, 100],
  [30, 400],
  [50, 800],
  [60, 1000],
  [70, 1300],
  [80, 1700],
  [87, 2000],
  [92, 2300],
  [96, 2600],
  [100, 3000],
];

/** Fewer moves than this tell too little to estimate anything. */
export const MIN_MOVES_FOR_ESTIMATE = 8;

/** The rating the curve gives for an accuracy. */
export function ratingForAccuracy(accuracy: number): number {
  const a = Math.max(0, Math.min(100, accuracy));
  for (let i = 1; i < ANCHORS.length; i++) {
    const [x1, y1] = ANCHORS[i]!;
    const [x0, y0] = ANCHORS[i - 1]!;
    if (a <= x1) return y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  }
  return ANCHORS[ANCHORS.length - 1]![1];
}

/**
 * Estimated performance for one side of a game. The same accuracy says a bit
 * more against a stronger opponent, so when the opponent's rating is known the
 * estimate moves a quarter of the way towards it (at most 200 points).
 */
export function estimatePerformance(accuracy: number | null, moves: number, opponentRating: number | null = null): number | null {
  if (accuracy === null || moves < MIN_MOVES_FOR_ESTIMATE) return null;
  let est = ratingForAccuracy(accuracy);
  if (opponentRating !== null) est += Math.max(-200, Math.min(200, (opponentRating - est) / 4));
  return Math.round(est / 10) * 10;
}

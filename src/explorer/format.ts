// Display helpers for the opening explorer table.

export interface Counts {
  white: number;
  draws: number;
  black: number;
}

export const gamesOf = (c: Counts) => c.white + c.draws + c.black;

/** White / draw / black shares in whole percent that always add up to 100. */
export function resultShares(c: Counts): Counts {
  const n = gamesOf(c);
  if (n === 0) return { white: 0, draws: 0, black: 0 };
  const raw = [c.white, c.draws, c.black].map(x => (100 * x) / n);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, x) => s + x, 0);
  // hand the remaining points to the largest remainders
  for (const i of raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  return { white: floors[0]!, draws: floors[1]!, black: floors[2]! };
}

/** The total over all moves. */
export const totalOf = (moves: readonly Counts[]): Counts =>
  moves.reduce((t, m) => ({ white: t.white + m.white, draws: t.draws + m.draws, black: t.black + m.black }), { white: 0, draws: 0, black: 0 });

/** "1,234 games". */
export const gamesText = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'game' : 'games'}`;

// Glicko-2 rating system, written from Mark Glickman's description
// ("Example of the Glicko-2 system", 2012). Each rated game is applied as
// its own rating period, right after the game ends.

export interface Glicko {
  rating: number;
  deviation: number;
  volatility: number;
}

export type Score = 0 | 0.5 | 1;

export const DEFAULT_GLICKO: Glicko = { rating: 1500, deviation: 500, volatility: 0.09 };

export const LIMITS = {
  minRating: 400,
  minDeviation: 45,
  maxDeviation: 500,
  maxVolatility: 0.1,
  /** Most rating points one game can move. */
  maxDelta: 700,
  /** A rating is shown as provisional ("?") while its deviation is at least this. */
  provisionalDeviation: 110,
  /** How many rating periods pass per day without games, for deviation growth. */
  periodsPerDay: 0.21436,
};

const SCALE = 173.7178;
const EPSILON = 0.000001;

export const isProvisional = (g: Glicko): boolean => g.deviation >= LIMITS.provisionalDeviation;

/** Deviation grows while a player doesn't play: uncertainty comes back over time. */
export function afterIdle(g: Glicko, idleMs: number): Glicko {
  if (idleMs <= 0) return g;
  const periods = (idleMs / 86_400_000) * LIMITS.periodsPerDay;
  const phi = g.deviation / SCALE;
  const grown = Math.sqrt(phi * phi + periods * g.volatility * g.volatility) * SCALE;
  return { ...g, deviation: Math.min(LIMITS.maxDeviation, grown) };
}

/**
 * One rating period for `player` against several opponents (used by the paper's
 * example). `tau` limits how fast volatility changes.
 */
export function ratePeriod(player: Glicko, games: { opponent: Glicko; score: Score }[], tau = 0.75): Glicko {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.deviation / SCALE;
  const sigma = player.volatility;
  if (games.length === 0) return afterPeriodWithoutGames(player);

  let vInv = 0;
  let sum = 0;
  for (const { opponent, score } of games) {
    const muJ = (opponent.rating - 1500) / SCALE;
    const phiJ = opponent.deviation / SCALE;
    const gJ = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
    const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // new volatility: solve f(x) = 0 with the Illinois algorithm
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * sum;
  return { rating: newMu * SCALE + 1500, deviation: newPhi * SCALE, volatility: newSigma };
}

function afterPeriodWithoutGames(g: Glicko): Glicko {
  const phi = g.deviation / SCALE;
  return { ...g, deviation: Math.sqrt(phi * phi + g.volatility * g.volatility) * SCALE };
}

/** Keeps a rating inside the limits, and the change from `before` within maxDelta. */
export function capped(after: Glicko, before: Glicko): Glicko {
  const delta = Math.max(-LIMITS.maxDelta, Math.min(LIMITS.maxDelta, after.rating - before.rating));
  return {
    rating: Math.max(LIMITS.minRating, before.rating + delta),
    deviation: Math.max(LIMITS.minDeviation, Math.min(LIMITS.maxDeviation, after.deviation)),
    volatility: Math.min(LIMITS.maxVolatility, after.volatility),
  };
}

/** New ratings for both players after one game. `whiteScore` is 1, ½ or 0. */
export function rateGame(white: Glicko, black: Glicko, whiteScore: Score): { white: Glicko; black: Glicko } {
  const blackScore = (1 - whiteScore) as Score;
  return {
    white: capped(ratePeriod(white, [{ opponent: black, score: whiteScore }]), white),
    black: capped(ratePeriod(black, [{ opponent: white, score: blackScore }]), black),
  };
}

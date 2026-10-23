// Insights for one player, from their saved games, reviews and clocks: rating
// history; results by colour, opening, time control, time of day and the
// opponent's rating; accuracy over time and by phase; errors per game; time
// per move and time trouble; and the openings they play most. Pure, so it's
// easy to test; insightsData.ts loads what it needs.
import { Chess } from 'chess.js';
import { findTimeControl } from '../../src/chess/clock.ts';
import { divide, phaseOf, PHASES, type GamePhase } from '../../src/analysis/divider.ts';
import { gameAccuracy, whiteWinPercent } from '../../src/analysis/accuracy.ts';
import { decodeScore, kindOfCode, type StoredReview } from '../../src/analysis/reviewData.ts';

export type Side = 'w' | 'b';
export type Outcome = 'win' | 'draw' | 'loss';

export interface InsightGame {
  id: string;
  whiteId: string | null;
  blackId: string | null;
  category: string;
  tc: string;
  rated: boolean;
  moves: string[];
  clocks: number[] | null;
  result: '1-0' | '0-1' | '1/2-1/2';
  whiteRating: number | null;
  blackRating: number | null;
  whiteDiff: number | null;
  blackDiff: number | null;
  endedAt: number;
  review?: StoredReview | null;
  /** The opening's name when names are imported; otherwise the first moves are used. */
  opening?: { eco: string; name: string } | null;
}

export interface Bucket {
  label: string;
  win: number;
  draw: number;
  loss: number;
}

export interface Insights {
  games: number;
  /** Rating after each rated game, per speed. */
  rating: Record<string, { t: number; rating: number }[]>;
  results: {
    byColor: Bucket[];
    bySpeed: Bucket[];
    byTimeControl: Bucket[];
    byTimeOfDay: Bucket[];
    byOpponent: Bucket[];
  };
  /** Most-played openings, most games first. */
  openings: Bucket[];
  accuracy: {
    reviewed: number;
    /** Your accuracy in each reviewed game, oldest first. */
    overTime: { t: number; accuracy: number }[];
    average: number | null;
    byPhase: Record<GamePhase, number | null>;
    /** Per reviewed game. */
    blunders: number | null;
    mistakes: number | null;
    inaccuracies: number | null;
  };
  time: {
    /** Games with recorded clocks. */
    games: number;
    /** Average seconds you spent per move, by speed. */
    perMove: { label: string; seconds: number; games: number }[];
    /** Games where your clock fell below 10% of the starting time. */
    trouble: Bucket & { games: number; share: number | null };
  };
}

const outcomeFor = (g: InsightGame, me: Side): Outcome =>
  g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === (me === 'w') ? 'win' : 'loss';

function tally(groups: Map<string, Bucket>, label: string, outcome: Outcome) {
  const b = groups.get(label) ?? { label, win: 0, draw: 0, loss: 0 };
  b[outcome]++;
  groups.set(label, b);
}

const gamesIn = (b: Bucket) => b.win + b.draw + b.loss;

/** The first moves as SAN, "1. e4 e5", for games without an opening name. */
function firstMoves(moves: readonly string[], plies = 2): string {
  const chess = new Chess();
  const parts: string[] = [];
  for (const [i, u] of moves.slice(0, plies).entries()) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u[4] ? { promotion: u[4] } : {}) });
      parts.push(i % 2 === 0 ? `${i / 2 + 1}. ${m.san}` : m.san);
    } catch {
      break;
    }
  }
  return parts.join(' ') || '(no moves)';
}

/** Rating gap bands, the opponent's rating minus yours. */
export const OPPONENT_BANDS: readonly { label: string; max: number }[] = [
  { label: '200+ lower', max: -200 },
  { label: '100–200 lower', max: -100 },
  { label: 'within 100 lower', max: 0 },
  { label: 'within 100 higher', max: 100 },
  { label: '100–200 higher', max: 200 },
  { label: '200+ higher', max: Infinity },
];

export const opponentBand = (gap: number) => OPPONENT_BANDS.find(b => gap < b.max)?.label ?? OPPONENT_BANDS[OPPONENT_BANDS.length - 1]!.label;

/** Four-hour slots of the day, in the viewer's time zone. */
export const DAY_SLOTS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];

export function hourIn(ms: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms));
  return Number(h) % 24;
}

/** Whether a time zone name is one this server knows. */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Your accuracy in each phase of one reviewed game. */
function phaseAccuracy(g: InsightGame, me: Side): Partial<Record<GamePhase, number>> {
  const review = g.review!;
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const u of g.moves) {
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u[4] ? { promotion: u[4] } : {}) });
    } catch {
      return {};
    }
    fens.push(chess.fen());
  }
  const win = review.positions.map(p => whiteWinPercent(decodeScore(p.s) ?? { cp: 0 }));
  const div = divide(fens);
  const out: Partial<Record<GamePhase, number>> = {};
  for (const phase of PHASES) {
    const plies = g.moves.map((_m, i) => i + 1).filter(ply => phaseOf(ply, div) === phase);
    if (plies.length === 0) continue;
    const [first, last] = [plies[0]!, plies[plies.length - 1]!];
    const acc = gameAccuracy(win.slice(first - 1, last + 1), first % 2 === 1 ? 'w' : 'b')[me];
    if (acc !== null) out[phase] = acc;
  }
  return out;
}

export function buildInsights(userId: string, games: readonly InsightGame[], timeZone = 'UTC'): Insights {
  const mine = games
    .map(g => ({ g, me: (g.whiteId === userId ? 'w' : 'b') as Side }))
    .filter(({ g }) => g.whiteId === userId || g.blackId === userId)
    .sort((a, b) => a.g.endedAt - b.g.endedAt);

  const rating: Insights['rating'] = {};
  const byColor = new Map<string, Bucket>();
  const bySpeed = new Map<string, Bucket>();
  const byTc = new Map<string, Bucket>();
  const byHour = new Map<string, Bucket>(DAY_SLOTS.map(s => [s, { label: s, win: 0, draw: 0, loss: 0 }]));
  const byOpp = new Map<string, Bucket>(OPPONENT_BANDS.map(b => [b.label, { label: b.label, win: 0, draw: 0, loss: 0 }]));
  const openings = new Map<string, Bucket>();
  const overTime: { t: number; accuracy: number }[] = [];
  const phaseSums: Record<GamePhase, number[]> = { opening: [], middlegame: [], endgame: [] };
  const errors = { blunders: 0, mistakes: 0, inaccuracies: 0 };
  let reviewed = 0;
  const perMove = new Map<string, { seconds: number; moves: number; games: number }>();
  const trouble: Bucket = { label: 'time trouble', win: 0, draw: 0, loss: 0 };
  let timedGames = 0;

  for (const { g, me } of mine) {
    const outcome = outcomeFor(g, me);
    tally(byColor, me === 'w' ? 'White' : 'Black', outcome);
    tally(bySpeed, g.category, outcome);
    tally(byTc, g.tc, outcome);
    tally(byHour, DAY_SLOTS[Math.floor(hourIn(g.endedAt, timeZone) / 4)]!, outcome);
    tally(openings, g.opening ? `${g.opening.eco} ${g.opening.name}` : firstMoves(g.moves), outcome);

    const [myRating, theirRating, myDiff] = me === 'w' ? [g.whiteRating, g.blackRating, g.whiteDiff] : [g.blackRating, g.whiteRating, g.blackDiff];
    if (g.rated && myRating !== null && theirRating !== null) {
      tally(byOpp, opponentBand(theirRating - myRating), outcome);
      if (myDiff !== null) (rating[g.category] ??= []).push({ t: g.endedAt, rating: myRating + myDiff });
    }

    if (g.review) {
      const accuracy = gameAccuracy(g.review.positions.map(p => whiteWinPercent(decodeScore(p.s) ?? { cp: 0 })), 'w')[me];
      if (accuracy !== null) {
        reviewed++;
        overTime.push({ t: g.endedAt, accuracy });
        for (const [phase, a] of Object.entries(phaseAccuracy(g, me))) phaseSums[phase as GamePhase].push(a);
        [...g.review.kinds].forEach((c, i) => {
          if ((i % 2 === 0) !== (me === 'w')) return;
          const kind = kindOfCode(c);
          if (kind === 'blunder') errors.blunders++;
          else if (kind === 'mistake' || kind === 'miss') errors.mistakes++;
          else if (kind === 'inaccuracy') errors.inaccuracies++;
        });
      }
    }

    const tc = findTimeControl(g.tc);
    if (g.clocks && tc && g.clocks.length === g.moves.length) {
      timedGames++;
      let spent = 0;
      let moves = 0;
      let lowest = Infinity;
      g.clocks.forEach((left, i) => {
        if ((i % 2 === 0) !== (me === 'w')) return;
        lowest = Math.min(lowest, left);
        // the clock starts with the second move of each side
        if (i >= 2) {
          spent += Math.max(0, g.clocks![i - 2]! + tc.incrementMs - left);
          moves++;
        }
      });
      if (moves > 0) {
        const p = perMove.get(g.category) ?? { seconds: 0, moves: 0, games: 0 };
        perMove.set(g.category, { seconds: p.seconds + spent / 1000, moves: p.moves + moves, games: p.games + 1 });
      }
      if (lowest < tc.initialMs * 0.1) trouble[outcome]++;
    }
  }

  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  const perGame = (n: number) => (reviewed ? Math.round((n / reviewed) * 100) / 100 : null);
  const troubleGames = gamesIn(trouble);
  const sortedBy = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => gamesIn(b) - gamesIn(a));

  return {
    games: mine.length,
    rating,
    results: {
      byColor: ['White', 'Black'].map(l => byColor.get(l) ?? { label: l, win: 0, draw: 0, loss: 0 }),
      bySpeed: sortedBy(bySpeed),
      byTimeControl: sortedBy(byTc),
      byTimeOfDay: [...byHour.values()],
      byOpponent: [...byOpp.values()],
    },
    openings: sortedBy(openings).slice(0, 10),
    accuracy: {
      reviewed,
      overTime,
      average: avg(overTime.map(o => o.accuracy)),
      byPhase: { opening: avg(phaseSums.opening), middlegame: avg(phaseSums.middlegame), endgame: avg(phaseSums.endgame) },
      blunders: perGame(errors.blunders),
      mistakes: perGame(errors.mistakes),
      inaccuracies: perGame(errors.inaccuracies),
    },
    time: {
      games: timedGames,
      perMove: [...perMove.entries()].map(([label, p]) => ({ label, seconds: Math.round((p.seconds / p.moves) * 10) / 10, games: p.games })),
      trouble: { ...trouble, games: troubleGames, share: timedGames ? Math.round((troubleGames / timedGames) * 1000) / 10 : null },
    },
  };
}

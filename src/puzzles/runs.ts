// Puzzle Streak and Puzzle Storm: runs of puzzles that get harder as you go.
// Pure logic; time is passed in, so it is easy to test.

import type { Puzzle } from './types';

/**
 * The order puzzles come in: easiest first, shuffled a little within bands of
 * similar rating so no two runs are quite the same.
 */
export function runSequence(puzzles: readonly Puzzle[], random: () => number = Math.random, band = 100): Puzzle[] {
  return [...puzzles]
    .map(p => ({ p, key: Math.floor(p.rating / band) + random() }))
    .sort((a, b) => a.key - b.key)
    .map(x => x.p);
}

// ---------- Storm ----------

export const STORM = {
  /** Length of a run before bonuses, in ms. */
  initialMs: 3 * 60_000,
  /** Time lost on a wrong move. */
  malusMs: 10_000,
  /** [combo reached, seconds gained]: after the last level, every 10 more moves gain its bonus again. */
  levels: [
    [5, 3],
    [12, 5],
    [20, 7],
    [30, 10],
  ] as const,
};

/** Seconds of bonus time earned on reaching `combo` correct moves in a row (0 if none). */
export function comboBonus(combo: number): number {
  for (const [at, seconds] of STORM.levels) if (combo === at) return seconds;
  const [lastAt, lastSeconds] = STORM.levels[STORM.levels.length - 1]!;
  return combo > lastAt && (combo - lastAt) % 10 === 0 ? lastSeconds : 0;
}

export interface StormState {
  /** When time runs out; null until the first move starts the clock. */
  deadline: number | null;
  score: number;
  combo: number;
  bestCombo: number;
  moves: number;
  errors: number;
  /** The latest time change, for a "+3s" or "−10s" flash. */
  lastChange: { seconds: number; at: number } | null;
  over: boolean;
}

export const newStorm = (): StormState => ({
  deadline: null,
  score: 0,
  combo: 0,
  bestCombo: 0,
  moves: 0,
  errors: 0,
  lastChange: null,
  over: false,
});

export const stormTimeLeft = (s: StormState, now: number): number =>
  s.deadline === null ? STORM.initialMs : Math.max(0, s.deadline - now);

/** Starts the clock on the first move, and ends the run once time is up. */
function running(s: StormState, now: number): StormState {
  if (s.over) return s;
  if (s.deadline === null) return { ...s, deadline: now + STORM.initialMs };
  return now >= s.deadline ? { ...s, over: true } : s;
}

export function stormGoodMove(s0: StormState, now: number): StormState {
  const s = running(s0, now);
  if (s.over) return s;
  const combo = s.combo + 1;
  const bonus = comboBonus(combo);
  return {
    ...s,
    combo,
    bestCombo: Math.max(s.bestCombo, combo),
    moves: s.moves + 1,
    deadline: s.deadline! + bonus * 1000,
    lastChange: bonus ? { seconds: bonus, at: now } : s.lastChange,
  };
}

export function stormBadMove(s0: StormState, now: number): StormState {
  const s = running(s0, now);
  if (s.over) return s;
  const next = { ...s, combo: 0, moves: s.moves + 1, errors: s.errors + 1, deadline: s.deadline! - STORM.malusMs, lastChange: { seconds: -10, at: now } };
  return now >= next.deadline ? { ...next, over: true } : next;
}

export const stormSolved = (s: StormState): StormState => (s.over ? s : { ...s, score: s.score + 1 });

export const stormTick = (s: StormState, now: number): StormState => (s.deadline !== null && !s.over && now >= s.deadline ? { ...s, over: true } : s);

export const stormEnd = (s: StormState): StormState => ({ ...s, over: true });

// ---------- Streak ----------

export interface StreakState {
  index: number;
  score: number;
  /** One skip per run: it plays the right move for you. */
  skipAvailable: boolean;
  over: boolean;
}

export const newStreak = (): StreakState => ({ index: 0, score: 0, skipAvailable: true, over: false });

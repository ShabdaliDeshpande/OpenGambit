import type { Puzzle } from './types';

export type Difficulty = 'any' | 'easy' | 'medium' | 'hard';

export const DIFFICULTY_RANGE: Record<Difficulty, [number, number]> = {
  any: [0, Infinity],
  easy: [0, 1299],
  medium: [1300, 1699],
  hard: [1700, Infinity],
};

export interface PuzzleFilter {
  theme: string; // '' = any
  difficulty: Difficulty;
  /** Pick puzzles closest to this rating (your rating plus a difficulty offset). */
  target?: number | null;
}

/** Difficulty relative to your puzzle rating, as an offset in rating points. */
export const RELATIVE_DIFFICULTY: readonly { label: string; offset: number }[] = [
  { label: 'Easiest', offset: -600 },
  { label: 'Easier', offset: -300 },
  { label: 'Normal', offset: 0 },
  { label: 'Harder', offset: 300 },
  { label: 'Hardest', offset: 600 },
];

export interface PuzzleStats {
  solved: string[];
  failed: string[];
  streak: number;
  bestStreak: number;
}

export const EMPTY_STATS: PuzzleStats = { solved: [], failed: [], streak: 0, bestStreak: 0 };

export function matches(p: Puzzle, f: PuzzleFilter): boolean {
  const [lo, hi] = DIFFICULTY_RANGE[f.difficulty];
  return p.rating >= lo && p.rating <= hi && (!f.theme || p.themes.includes(f.theme));
}

/**
 * Picks a puzzle matching the filter, preferring ones not attempted yet, and
 * never the current one if there is any alternative. Returns null if nothing matches.
 */
export function pickPuzzle(
  all: readonly Puzzle[],
  filter: PuzzleFilter,
  stats: PuzzleStats,
  currentId: string | null,
  rng: () => number = Math.random,
): Puzzle | null {
  const pool = all.filter(p => matches(p, filter));
  if (pool.length === 0) return null;
  const attempted = new Set([...stats.solved, ...stats.failed]);
  if (filter.target !== undefined && filter.target !== null) {
    // the puzzles nearest the target: a handful, so there's still some variety
    const target = filter.target;
    const byDistance = pool.filter(p => p.id !== currentId).sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
    const freshNear = byDistance.filter(p => !attempted.has(p.id)).slice(0, 5);
    const near = freshNear.length ? freshNear : byDistance.slice(0, 5);
    if (near.length) return near[Math.floor(rng() * near.length)]!;
    return pool[0]!;
  }
  const fresh = pool.filter(p => !attempted.has(p.id) && p.id !== currentId);
  const others = pool.filter(p => p.id !== currentId);
  const choices = fresh.length ? fresh : others.length ? others : pool;
  return choices[Math.floor(rng() * choices.length)]!;
}

/** Records a finished attempt. A puzzle counts as solved only without mistakes, hints or reveals. */
export function recordResult(stats: PuzzleStats, id: string, clean: boolean): PuzzleStats {
  const solved = stats.solved.filter(x => x !== id);
  const failed = stats.failed.filter(x => x !== id);
  if (clean) {
    const streak = stats.streak + 1;
    return { solved: [...solved, id], failed, streak, bestStreak: Math.max(stats.bestStreak, streak) };
  }
  return { solved, failed: [...failed, id], streak: 0, bestStreak: stats.bestStreak };
}

/** All themes present, most common first. */
export function themeCounts(all: readonly Puzzle[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of all) for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const THEME_LABELS: Record<string, string> = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  advantage: 'Win material',
  fork: 'Fork',
  sacrifice: 'Sacrifice',
  promotion: 'Promotion',
  endgame: 'Endgame',
};

export const themeLabel = (t: string) =>
  THEME_LABELS[t] ?? t.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

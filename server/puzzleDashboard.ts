import type { Glicko } from './rating/glicko2.ts';
import { displayRating, type PuzzleAttempt } from './store.ts';

export interface ThemeStat {
  theme: string;
  /** First attempts at puzzles with this theme. */
  played: number;
  firstWins: number;
  /** Average puzzle rating − 500 + 1000 × first-try success rate. */
  performance: number;
}

export interface PuzzleDashboard {
  rating: { rating: number; provisional: boolean; deviation: number };
  played: number;
  firstWins: number;
  successRate: number;
  /** Consecutive first-try wins, most recent first. */
  streak: number;
  performance: number | null;
  strengths: ThemeStat[];
  improvements: ThemeStat[];
  themes: ThemeStat[];
  /** Rating after each rated attempt, oldest first. */
  chart: { at: number; rating: number }[];
  history: { puzzleId: string; win: boolean; first: boolean; puzzleRating: number; themes: string[]; ratingDiff: number | null; at: number }[];
}

function stat(theme: string, list: readonly PuzzleAttempt[]): ThemeStat {
  const firstWins = list.filter(a => a.win).length;
  const avg = list.reduce((s, a) => s + a.puzzleRating, 0) / list.length;
  return { theme, played: list.length, firstWins, performance: Math.round(avg - 500 + (1000 * firstWins) / list.length) };
}

/**
 * Builds the dashboard from a player's attempts (newest first). Only first
 * attempts count for the statistics, as only they are rated.
 */
export function buildDashboard(attempts: readonly PuzzleAttempt[], rating: Glicko): PuzzleDashboard {
  const firsts = attempts.filter(a => a.first);
  const firstWins = firsts.filter(a => a.win).length;
  const overall = firsts.length ? stat('', firsts) : null;

  const byTheme = new Map<string, PuzzleAttempt[]>();
  for (const a of firsts) for (const t of a.themes) byTheme.set(t, [...(byTheme.get(t) ?? []), a]);
  const themes = [...byTheme].map(([t, list]) => stat(t, list)).sort((a, b) => b.played - a.played || a.theme.localeCompare(b.theme));
  const global = overall?.performance ?? 0;

  let streak = 0;
  for (const a of firsts) {
    if (!a.win) break;
    streak++;
  }

  return {
    rating: { ...displayRating(rating), deviation: Math.round(rating.deviation) },
    played: firsts.length,
    firstWins,
    successRate: firsts.length ? Math.round((100 * firstWins) / firsts.length) : 0,
    streak,
    performance: overall?.performance ?? null,
    strengths: themes
      .filter(t => t.firstWins >= 3 && t.performance > global)
      .sort((a, b) => b.performance - a.performance)
      .slice(0, 5),
    improvements: themes
      .filter(t => t.played - t.firstWins >= 3 && t.performance < global)
      .sort((a, b) => a.performance - b.performance)
      .slice(0, 5),
    themes,
    chart: firsts
      .filter(a => a.ratingAfter !== null)
      .slice(0, 200)
      .reverse()
      .map(a => ({ at: a.createdAt, rating: a.ratingAfter! })),
    history: attempts.slice(0, 30).map(a => ({
      puzzleId: a.puzzleId,
      win: a.win,
      first: a.first,
      puzzleRating: a.puzzleRating,
      themes: a.themes,
      ratingDiff: a.ratingDiff,
      at: a.createdAt,
    })),
  };
}

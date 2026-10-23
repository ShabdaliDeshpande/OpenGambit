// Calls to the account API (/api). The session lives in an HttpOnly cookie,
// so the page never sees it.

import type { StoredReview } from '../analysis/reviewData';

export type Category = 'bullet' | 'blitz' | 'rapid' | 'classical';

export const CATEGORIES: readonly Category[] = ['bullet', 'blitz', 'rapid', 'classical'];

export const CATEGORY_LABEL: Record<Category, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' };

export interface PublicRating {
  rating: number;
  provisional: boolean;
  deviation: number;
  games: number;
}

/** A rating without a game count (the puzzle rating). */
export interface ShownRatingWithDeviation {
  rating: number;
  provisional: boolean;
  deviation: number;
}

export interface Me {
  id: string;
  username: string;
  ratings: Record<Category, PublicRating>;
  puzzleRating: ShownRatingWithDeviation;
}

export interface GameSide {
  id: string | null;
  name: string;
  rating: number | null;
  diff: number | null;
}

export interface PublicGame {
  id: string;
  white: GameSide;
  black: GameSide;
  tc: string;
  category: Category;
  rated: boolean;
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: string;
  plies: number;
  startedAt: number;
  endedAt: number;
  moves?: string[];
  /** Accuracy per side when the game has a saved review. */
  review?: { white: number | null; black: number | null } | null;
}

export interface Profile {
  user: { id: string; username: string; createdAt: number };
  ratings: Record<Category, PublicRating>;
  puzzleRating: ShownRatingWithDeviation;
  runs?: RunBests;
  totalGames: number;
  games: PublicGame[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Can’t reach the server.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  return data;
}

export const fetchMe = async () => (await call<{ user: Me | null }>('/api/me')).user;
export const signUp = async (username: string, password: string) => (await call<{ user: Me }>('/api/signup', { username, password })).user;
export const logIn = async (username: string, password: string) => (await call<{ user: Me }>('/api/login', { username, password })).user;
export const logOut = async () => {
  await call('/api/logout', {});
};
export const fetchProfile = (name: string) => call<Profile>(`/api/users/${encodeURIComponent(name)}`);
export const fetchGames = async (name: string, before: number) =>
  (await call<{ games: PublicGame[] }>(`/api/users/${encodeURIComponent(name)}/games?before=${before}`)).games;
export const fetchGame = async (id: string) => (await call<{ game: PublicGame }>(`/api/games/${encodeURIComponent(id)}`)).game;
export const fetchReview = async (id: string) => (await call<{ review: StoredReview | null }>(`/api/games/${encodeURIComponent(id)}/review`)).review;
export type ServerAnalysis =
  | { enabled: boolean; status: 'none' | 'done' | 'failed' }
  | { enabled: true; status: 'queued'; position: number }
  | { enabled: true; status: 'running'; done: number; total: number };
export const fetchServerAnalysis = (id: string) => call<ServerAnalysis>(`/api/games/${encodeURIComponent(id)}/analysis`);
export const requestServerAnalysis = async (id: string) => ({ enabled: true, ...(await call<object>(`/api/games/${encodeURIComponent(id)}/analysis`, {})) }) as ServerAnalysis;
export const saveReview = (id: string, review: StoredReview) =>
  call<{ saved: boolean; accuracy: { white: number | null; black: number | null } }>(`/api/games/${encodeURIComponent(id)}/review`, { review });

export interface PuzzleResult {
  /** False when you had tried this puzzle before: practice, not rated. */
  first: boolean;
  diff: number | null;
  rating: ShownRatingWithDeviation;
}

export interface ThemeStat {
  theme: string;
  played: number;
  firstWins: number;
  performance: number;
}

export interface PuzzleDashboardData {
  rating: ShownRatingWithDeviation;
  played: number;
  firstWins: number;
  successRate: number;
  streak: number;
  performance: number | null;
  strengths: ThemeStat[];
  improvements: ThemeStat[];
  themes: ThemeStat[];
  chart: { at: number; rating: number }[];
  history: { puzzleId: string; win: boolean; first: boolean; puzzleRating: number; themes: string[]; ratingDiff: number | null; at: number }[];
}

export const submitPuzzleAttempt = (id: string, win: boolean, moves: { from: string; to: string; promotion?: string }[], theme: string) =>
  call<PuzzleResult>('/api/puzzles/attempt', { id, win, moves, ...(theme ? { theme } : {}) });
export const fetchDailyPuzzle = () => call<{ id: string; date: string; solved: boolean }>('/api/puzzles/daily');
export const fetchPuzzleDashboard = async () => (await call<{ dashboard: PuzzleDashboardData }>('/api/puzzles/dashboard')).dashboard;

export type RunMode = 'streak' | 'storm';
export type RunBests = Record<RunMode, { best: number; today: number }>;
export const submitRun = (mode: RunMode, score: number) => call<RunBests & { newBest: boolean }>('/api/puzzles/run', { mode, score });
export const fetchRuns = async () => (await call<{ runs: RunBests }>('/api/puzzles/runs')).runs;

export const changePassword = (current: string, password: string) => call<{ ok: true }>('/api/account/password', { current, password });
export const deleteAccount = (current: string, confirm: string) => call<{ user: null }>('/api/account/delete', { current, confirm });

export type LeaderboardEntry = { username: string; rating: number; games: number };
export const fetchLeaderboard = async () =>
  (await call<{ leaderboard: Record<Category | 'puzzle', LeaderboardEntry[]> }>('/api/leaderboard')).leaderboard;

/** "1734" or "1500?" while provisional. */
export const ratingText = (r: { rating: number; provisional: boolean } | null | undefined) =>
  r ? `${r.rating}${r.provisional ? '?' : ''}` : '';

export const diffText = (d: number | null | undefined) => (d === null || d === undefined ? '' : d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');

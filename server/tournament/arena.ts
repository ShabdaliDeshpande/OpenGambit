// Arena tournaments: a fixed duration, players are paired again as soon as
// they finish a game, and points reward winning streaks and berserk wins.
// Pure logic: the tournament manager supplies time, randomness and games.

import type { Color } from 'chess.js';
import { minCostMatching } from './matching.ts';

export type Outcome = 'win' | 'draw' | 'loss';

export interface SheetEntry {
  gameId: string;
  /** 'void' is a draw that scored nothing because it was too short. */
  result: Outcome | 'void';
  points: number;
  /** The game was played while on a winning streak (points doubled). */
  fire: boolean;
  berserk: boolean;
}

/** Below this many plies a draw scores nothing. */
export const QUICK_DRAW_PLIES = 20;
/** A berserk win needs at least this many plies to earn its extra point. */
export const BERSERK_MIN_PLIES = 14;
/** Draws in games shorter than this don't score when the previous result (ignoring losses) was a draw too. */
export const LONG_GAME_PLIES = 60;

/** True if the player's last two results were wins: the next game counts double. */
export const onFire = (sheet: readonly SheetEntry[]): boolean => sheet.at(-1)?.result === 'win' && sheet.at(-2)?.result === 'win';

/** Looking back past losses, was the latest result a draw? */
function inDrawStreak(sheet: readonly SheetEntry[]): boolean {
  for (let i = sheet.length - 1; i >= 0; i--) {
    const r = sheet[i]!.result;
    if (r === 'loss') continue;
    return r !== 'win';
  }
  return false;
}

/** Points for one finished game, given the player's earlier results. */
export function scoreGame(
  sheet: readonly SheetEntry[],
  game: { gameId: string; outcome: Outcome; plies: number; berserk: boolean },
  streaks = true,
): SheetEntry {
  const fire = streaks && onFire(sheet);
  const base = { gameId: game.gameId, berserk: game.berserk, fire };
  switch (game.outcome) {
    case 'loss':
      return { ...base, result: 'loss', points: 0 };
    case 'draw':
      if (game.plies < QUICK_DRAW_PLIES) return { ...base, result: 'void', points: 0 };
      if (fire) return { ...base, result: 'draw', points: 2 };
      if (game.plies < LONG_GAME_PLIES && inDrawStreak(sheet)) return { ...base, result: 'draw', points: 0 };
      return { ...base, result: 'draw', points: 1 };
    case 'win': {
      const bonus = game.berserk && game.plies >= BERSERK_MIN_PLIES ? 1 : 0;
      return { ...base, result: 'win', points: (fire ? 4 : 2) + bonus };
    }
  }
}

export interface ArenaPlayer {
  id: string;
  name: string;
  rating: number;
  joinedAt: number;
  /** Paused: not paired until they rejoin. Their score stays. */
  withdrawn: boolean;
  sheet: SheetEntry[];
  score: number;
  /** The game they're playing now, if any. */
  playing: string | null;
  lastOpponent: string | null;
  colors: Color[];
}

export interface ArenaPairing {
  white: string;
  black: string;
}

export const totalOf = (sheet: readonly SheetEntry[]) => sheet.reduce((s, e) => s + e.points, 0);

/**
 * Tournament performance: average opponent rating, plus or minus 500 per
 * point of score above or below 50%. Used to break ties.
 */
export function performance(player: ArenaPlayer, ratingOf: (id: string) => number, opponents: string[]): number {
  if (opponents.length === 0) return 0;
  const avg = opponents.reduce((s, id) => s + ratingOf(id), 0) / opponents.length;
  const wins = player.sheet.filter(e => e.result === 'win').length;
  const losses = player.sheet.filter(e => e.result === 'loss').length;
  return Math.round(avg + (500 * (wins - losses)) / opponents.length);
}

/** Standings order: score, then tie-break, then who joined first. */
export function rankArena(players: readonly ArenaPlayer[], tieBreak: (p: ArenaPlayer) => number): ArenaPlayer[] {
  return [...players].sort((a, b) => b.score - a.score || tieBreak(b) - tieBreak(a) || a.joinedAt - b.joinedAt);
}

/** Who gets White: the player who has had Black more often, then whoever had Black last. */
export function chooseWhite(a: ArenaPlayer, b: ArenaPlayer, random: () => number): [string, string] {
  const balance = (p: ArenaPlayer) => p.colors.filter(c => c === 'w').length - p.colors.filter(c => c === 'b').length;
  const [ba, bb] = [balance(a), balance(b)];
  if (ba !== bb) return ba < bb ? [a.id, b.id] : [b.id, a.id];
  const [la, lb] = [a.colors.at(-1), b.colors.at(-1)];
  if (la !== lb) return la === 'b' || lb === 'w' ? [a.id, b.id] : [b.id, a.id];
  return random() < 0.5 ? [a.id, b.id] : [b.id, a.id];
}

/** Both have had the same colour in each of their last three games: they can't both get the other one. */
function colorClash(a: ArenaPlayer, b: ArenaPlayer): boolean {
  const streak = (p: ArenaPlayer) => {
    const last = p.colors.slice(-3);
    return last.length === 3 && last.every(c => c === last[0]) ? last[0] : null;
  };
  const [sa, sb] = [streak(a), streak(b)];
  return sa !== null && sa === sb;
}

/**
 * Pairs the waiting players. In the first wave everyone is paired by rating;
 * afterwards pairs are chosen to keep ranks and ratings close, never
 * repeating the opponent you just played (unless only two players are active).
 */
export function pairArena(
  waiting: readonly ArenaPlayer[],
  ranks: ReadonlyMap<string, number>,
  firstWave: boolean,
  onlyTwoActive: boolean,
  random: () => number,
): ArenaPairing[] {
  if (waiting.length < 2) return [];
  const toPairing = (a: ArenaPlayer, b: ArenaPlayer): ArenaPairing => {
    const [white, black] = chooseWhite(a, b, random);
    return { white, black };
  };

  if (firstWave) {
    const byRating = [...waiting].sort((a, b) => b.rating - a.rating);
    const out: ArenaPairing[] = [];
    for (let i = 0; i + 1 < byRating.length; i += 2) {
      const [a, b] = random() < 0.5 ? [byRating[i]!, byRating[i + 1]!] : [byRating[i + 1]!, byRating[i]!];
      out.push(toPairing(a, b));
    }
    return out;
  }

  const players = [...waiting].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
  const maxRank = Math.max(1, ...players.map(p => ranks.get(p.id) ?? 1));
  const rank = (p: ArenaPlayer) => ranks.get(p.id) ?? maxRank;
  const cost = (i: number, j: number) => {
    const [a, b] = [players[i]!, players[j]!];
    if (!onlyTwoActive && (a.lastOpponent === b.id || b.lastOpponent === a.id)) return null;
    if (colorClash(a, b)) return null;
    // close ranks matter more near the top of the table
    const factor = 300 + (1700 * (maxRank - Math.min(rank(a), rank(b)))) / maxRank;
    return Math.abs(rank(a) - rank(b)) * factor + Math.abs(a.rating - b.rating);
  };
  const m = minCostMatching(players.length, cost, () => 1e9);
  return (m?.pairs ?? []).map(([i, j]) => toPairing(players[i]!, players[j]!));
}

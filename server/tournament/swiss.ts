// Swiss tournaments: a fixed number of rounds; each round pairs players with
// similar scores who haven't met yet, balancing colours. A simplified take on
// the Dutch system, solved as a minimum-cost matching. Pure logic.

import type { Color } from 'chess.js';
import { minCostMatching } from './matching.ts';

/** What happened to a player in one round. */
export type RoundOutcome = 'win' | 'draw' | 'loss' | 'bye' | 'absent';

export interface RoundEntry {
  round: number;
  outcome: RoundOutcome;
  opponent: string | null;
  color: Color | null;
}

export interface SwissPlayer {
  id: string;
  name: string;
  rating: number;
  joinedAt: number;
  withdrawn: boolean;
  /** Points in halves (a win is 2), so there are no fractions. */
  halves: number;
  rounds: RoundEntry[];
}

export interface SwissRoundPairing {
  pairs: { white: string; black: string }[];
  bye: string | null;
}

const HALVES: Record<RoundOutcome, number> = { win: 2, bye: 2, draw: 1, loss: 0, absent: 0 };

export const pointsOf = (p: SwissPlayer) => p.halves / 2;

export function addRound(p: SwissPlayer, entry: RoundEntry): void {
  p.rounds = [...p.rounds.filter(r => r.round !== entry.round), entry].sort((a, b) => a.round - b.round);
  p.halves = p.rounds.reduce((s, r) => s + HALVES[r.outcome], 0);
}

export const opponentsOf = (p: SwissPlayer) => new Set(p.rounds.flatMap(r => (r.opponent ? [r.opponent] : [])));
const colorsOf = (p: SwissPlayer) => p.rounds.flatMap(r => (r.color ? [r.color] : []));

/** Late joining is open until more than half the rounds have started. */
export const canJoinLate = (roundsStarted: number, nbRounds: number) => roundsStarted <= Math.floor(nbRounds / 2);

/**
 * Colour preference: 'absolute' after two of the same colour in a row or a
 * surplus of two; 'strong' with a surplus of one; 'mild' to alternate.
 */
export function colorWish(p: SwissPlayer): { color: Color | null; strength: 0 | 1 | 2 | 3 } {
  const colors = colorsOf(p);
  if (colors.length === 0) return { color: null, strength: 0 };
  const balance = colors.filter(c => c === 'w').length - colors.filter(c => c === 'b').length;
  const [last, prev] = [colors.at(-1)!, colors.at(-2)];
  const other: Color = last === 'w' ? 'b' : 'w';
  if (balance >= 2) return { color: 'b', strength: 3 };
  if (balance <= -2) return { color: 'w', strength: 3 };
  if (prev === last) return { color: other, strength: 3 };
  if (balance !== 0) return { color: balance > 0 ? 'b' : 'w', strength: 2 };
  return { color: other, strength: 1 };
}

/** Sonneborn–Berger (in halves of halves): opponents' scores for wins, half for draws. Byes don't count. */
export function sonnebornBerger(p: SwissPlayer, byId: ReadonlyMap<string, SwissPlayer>): number {
  let sb = 0;
  for (const r of p.rounds) {
    const opp = r.opponent ? byId.get(r.opponent) : undefined;
    if (!opp) continue;
    if (r.outcome === 'win') sb += opp.halves * 2;
    else if (r.outcome === 'draw') sb += opp.halves;
  }
  return sb / 4;
}

/** Buchholz: the sum of the opponents' scores. */
export function buchholz(p: SwissPlayer, byId: ReadonlyMap<string, SwissPlayer>): number {
  let total = 0;
  for (const id of opponentsOf(p)) total += byId.get(id)?.halves ?? 0;
  return total / 2;
}

/** Standings: points, then Sonneborn–Berger, then Buchholz, then rating. */
export function rankSwiss(players: readonly SwissPlayer[]): SwissPlayer[] {
  const byId = new Map(players.map(p => [p.id, p]));
  const sb = new Map(players.map(p => [p.id, sonnebornBerger(p, byId)]));
  const bh = new Map(players.map(p => [p.id, buchholz(p, byId)]));
  return [...players].sort(
    (a, b) => b.halves - a.halves || sb.get(b.id)! - sb.get(a.id)! || bh.get(b.id)! - bh.get(a.id)! || b.rating - a.rating || a.joinedAt - b.joinedAt,
  );
}

/**
 * Pairs the next round among players who haven't withdrawn. Returns null when
 * no complete pairing exists (everyone has met), which ends the tournament.
 */
export function pairSwiss(players: readonly SwissPlayer[], random: () => number): SwissRoundPairing | null {
  const active = [...players].filter(p => !p.withdrawn).sort((a, b) => b.halves - a.halves || b.rating - a.rating || a.joinedAt - b.joinedAt);
  const n = active.length;
  if (n < 2) return null;

  const met = active.map(opponentsOf);
  const wish = active.map(colorWish);
  const hadBye = active.map(p => p.rounds.some(r => r.outcome === 'bye'));
  // position of each player inside their score group, for the top-half-vs-bottom-half shape
  const groupSize = new Map<number, number>();
  for (const p of active) groupSize.set(p.halves, (groupSize.get(p.halves) ?? 0) + 1);
  const firstOfGroup = new Map<number, number>();
  active.forEach((p, i) => firstOfGroup.has(p.halves) || firstOfGroup.set(p.halves, i));

  const cost = (i: number, j: number) => {
    const [a, b] = [active[i]!, active[j]!];
    if (met[i]!.has(b.id)) return null;
    const [wa, wb] = [wish[i]!, wish[j]!];
    if (wa.strength === 3 && wb.strength === 3 && wa.color === wb.color) return null;
    const scoreGap = a.halves - b.halves;
    let c = 10_000 * scoreGap * scoreGap;
    // within a score group, the top half should meet the bottom half
    const size = groupSize.get(a.halves)!;
    if (scoreGap === 0 && size > 1) {
      const ideal = Math.floor(size / 2);
      c += 40 * Math.abs(j - i - ideal);
    } else c += Math.abs(j - i);
    if (wa.color && wa.color === wb.color) c += wa.strength + wb.strength >= 4 ? 600 : 150;
    return c;
  };
  // an odd player out gets the bye: the lowest-ranked one who hasn't had one
  const single = (i: number) => (n % 2 === 0 ? 1e9 : (hadBye[i] ? 5e7 : 1e7) + (n - i) * 100);
  const m = minCostMatching(n, cost, single);
  if (!m || m.singles.length > n % 2) return null;

  const pairs = m.pairs.map(([i, j]) => {
    const [a, b] = [active[i]!, active[j]!];
    const [wa, wb] = [wish[i]!, wish[j]!];
    let aWhite: boolean;
    if (wa.strength !== wb.strength) aWhite = wa.strength > wb.strength ? wa.color === 'w' : wb.color === 'b';
    else if (wa.color && wa.color !== wb.color) aWhite = wa.color === 'w';
    else if (wa.color) aWhite = i < j ? wa.color === 'w' : wb.color === 'b'; // same wish: the higher ranked gets it
    else aWhite = random() < 0.5;
    return aWhite ? { white: a.id, black: b.id } : { white: b.id, black: a.id };
  });
  return { pairs, bye: m.singles.length ? active[m.singles[0]!]!.id : null };
}

// Daily tournaments: Swiss and Arena played at days per move. A Swiss round
// lasts as long as its games; an Arena runs for a fixed number of days and
// pairs you again whenever your game ends. Pairing and scoring reuse the
// live tournaments' pure rules.

import type { Color } from 'chess.js';
import { HttpError } from '../http.ts';
import { addRound, canJoinLate, pairSwiss, pointsOf, rankSwiss, type RoundEntry, type SwissPlayer } from '../tournament/swiss.ts';
import { pairArena, performance, rankArena, scoreGame, totalOf, type ArenaPlayer, type SheetEntry } from '../tournament/arena.ts';
import { DAY_MS, isDaysPerMove } from '../../src/daily/rules.ts';
import { newId, type DailyStore, type DailyTourRow } from './dailyStore.ts';

export interface TourPlayer {
  id: string;
  name: string;
  rating: number;
  joinedAt: number;
  withdrawn: boolean;
  // Swiss
  halves: number;
  rounds: RoundEntry[];
  // Arena
  sheet: SheetEntry[];
  score: number;
  playing: string | null;
  lastOpponent: string | null;
  colors: Color[];
}

export interface TourGame {
  id: string;
  white: string;
  black: string;
  round: number;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
}

interface TourData {
  players: TourPlayer[];
  games: TourGame[];
}

export interface TourSpec {
  kind: 'swiss' | 'arena';
  name: string;
  days: number;
  rated: boolean;
  /** Hours from now until it starts. */
  startInHours: number;
  /** Swiss: rounds. */
  nbRounds?: number;
  /** Arena: how many days it runs. */
  durationDays?: number;
}

export const TOUR_LIMITS = { minStartHours: 1, maxStartHours: 168, minRounds: 3, maxRounds: 9, arenaDays: [7, 14, 28] as readonly number[], maxOpenPerUser: 3, maxPlayers: 64 };

export interface TourHooks {
  now: () => number;
  random: () => number;
  /** Starts a daily game for the tournament and returns its id. */
  startGame: (tourId: string, whiteId: string, blackId: string, days: number, rated: boolean) => Promise<string>;
  notify: (userId: string, text: string, tourId: string) => Promise<void>;
  rating: (userId: string) => Promise<number>;
}

const read = (t: DailyTourRow): TourData => JSON.parse(t.data) as TourData;

function outcomeFor(result: TourGame['result'], color: Color): 'win' | 'draw' | 'loss' {
  if (result === '1/2-1/2') return 'draw';
  return (result === '1-0') === (color === 'w') ? 'win' : 'loss';
}

/** The standings shown on a tournament page. */
export function standings(t: DailyTourRow, data: TourData) {
  if (t.kind === 'swiss')
    return rankSwiss(data.players).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, rating: p.rating, withdrawn: p.withdrawn, points: pointsOf(p), detail: p.rounds.map(r => r.outcome) }));
  const opponents = (id: string) => data.games.filter(g => g.result && (g.white === id || g.black === id)).map(g => (g.white === id ? g.black : g.white));
  const ratingOf = (id: string) => data.players.find(p => p.id === id)?.rating ?? 1500;
  return rankArena(data.players, p => performance(p as ArenaPlayer, ratingOf, opponents(p.id))).map((p, i) => ({
    rank: i + 1,
    id: p.id,
    name: p.name,
    rating: p.rating,
    withdrawn: p.withdrawn,
    points: p.score,
    detail: (p as TourPlayer).sheet.map(e => (e.fire && e.points > 0 ? `${e.points}🔥` : String(e.points))),
  }));
}

export class DailyTours {
  private readonly ds: DailyStore;
  private readonly hooks: TourHooks;

  constructor(ds: DailyStore, hooks: TourHooks) {
    this.ds = ds;
    this.hooks = hooks;
  }

  async create(userId: string, spec: TourSpec): Promise<string> {
    const L = TOUR_LIMITS;
    const name = spec.name.trim();
    if (!name || name.length > 60) throw new HttpError(400, 'Give the tournament a name (up to 60 characters).');
    if (spec.kind !== 'swiss' && spec.kind !== 'arena') throw new HttpError(400, 'Choose Swiss or Arena.');
    if (!isDaysPerMove(spec.days)) throw new HttpError(400, 'Choose 1, 2, 3, 5, 7 or 14 days per move.');
    if (!Number.isInteger(spec.startInHours) || spec.startInHours < L.minStartHours || spec.startInHours > L.maxStartHours)
      throw new HttpError(400, `Start it between ${L.minStartHours} and ${L.maxStartHours} hours from now.`);
    if (spec.kind === 'swiss' && !(Number.isInteger(spec.nbRounds) && spec.nbRounds! >= L.minRounds && spec.nbRounds! <= L.maxRounds))
      throw new HttpError(400, `A Swiss has ${L.minRounds} to ${L.maxRounds} rounds.`);
    if (spec.kind === 'arena' && !L.arenaDays.includes(spec.durationDays ?? 0)) throw new HttpError(400, 'An Arena runs for 7, 14 or 28 days.');
    if ((await this.ds.openToursBy(userId)) >= L.maxOpenPerUser) throw new HttpError(429, `You can run at most ${L.maxOpenPerUser} daily tournaments at a time.`);
    const now = this.hooks.now();
    const startsAt = now + spec.startInHours * 3_600_000;
    const id = newId();
    await this.ds.insertTour({
      id,
      kind: spec.kind,
      name,
      days: spec.days,
      rated: spec.rated,
      createdBy: userId,
      status: 'created',
      startsAt,
      endsAt: spec.kind === 'arena' ? startsAt + spec.durationDays! * DAY_MS : null,
      nbRounds: spec.kind === 'swiss' ? spec.nbRounds! : null,
      round: 0,
      data: JSON.stringify({ players: [], games: [] } satisfies TourData),
      createdAt: now,
    });
    return id;
  }

  async join(userId: string, username: string, id: string): Promise<void> {
    const t = await this.ds.tour(id);
    if (!t) throw new HttpError(404, 'No such tournament.');
    if (t.status === 'finished') throw new HttpError(409, 'This tournament has finished.');
    const data = read(t);
    const now = this.hooks.now();
    if (t.kind === 'swiss' && t.status === 'started' && !canJoinLate(t.round, t.nbRounds!)) throw new HttpError(409, 'It’s too late to join this Swiss.');
    if (t.kind === 'arena' && t.endsAt !== null && now >= t.endsAt) throw new HttpError(409, 'This Arena has ended.');
    const existing = data.players.find(p => p.id === userId);
    if (existing) existing.withdrawn = false;
    else {
      if (data.players.length >= TOUR_LIMITS.maxPlayers) throw new HttpError(409, 'This tournament is full.');
      data.players.push({
        id: userId,
        name: username,
        rating: await this.hooks.rating(userId),
        joinedAt: now,
        withdrawn: false,
        halves: 0,
        rounds: [],
        sheet: [],
        score: 0,
        playing: null,
        lastOpponent: null,
        colors: [],
      });
    }
    t.data = JSON.stringify(data);
    if (t.kind === 'arena' && t.status === 'started') await this.pairArenaWaiting(t, data, false);
    await this.ds.saveTour(t);
  }

  async leave(userId: string, id: string): Promise<void> {
    const t = await this.ds.tour(id);
    if (!t) throw new HttpError(404, 'No such tournament.');
    const data = read(t);
    const p = data.players.find(x => x.id === userId);
    if (!p) throw new HttpError(409, 'You’re not in this tournament.');
    // before the start you leave the list; afterwards you're paused, and your games so far still count
    if (t.status === 'created') data.players = data.players.filter(x => x.id !== userId);
    else p.withdrawn = true;
    t.data = JSON.stringify(data);
    await this.ds.saveTour(t);
  }

  async view(id: string) {
    const t = await this.ds.tour(id);
    if (!t) return null;
    const data = read(t);
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      days: t.days,
      rated: t.rated,
      status: t.status,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      nbRounds: t.nbRounds,
      round: t.round,
      players: data.players.length,
      standings: standings(t, data),
      games: data.games.map(g => ({ ...g, whiteName: data.players.find(p => p.id === g.white)?.name ?? '?', blackName: data.players.find(p => p.id === g.black)?.name ?? '?' })),
    };
  }

  async list() {
    return (await this.ds.tours()).map(t => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      days: t.days,
      rated: t.rated,
      status: t.status,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      nbRounds: t.nbRounds,
      round: t.round,
      players: read(t).players.length,
    }));
  }

  /** Starts tournaments whose time has come and ends Arenas whose time is up. */
  async sweep(): Promise<void> {
    const now = this.hooks.now();
    for (const t of await this.ds.activeTours()) {
      const data = read(t);
      if (t.status === 'created' && now >= t.startsAt) {
        t.status = 'started';
        if (data.players.filter(p => !p.withdrawn).length < 2) await this.finish(t, data, 'Not enough players joined, so it was called off.');
        else if (t.kind === 'swiss') await this.nextSwissRound(t, data);
        else await this.pairArenaWaiting(t, data, true);
      } else if (t.status === 'started' && t.kind === 'arena' && now >= t.endsAt! && !data.games.some(g => !g.result)) await this.finish(t, data);
      else continue;
      t.data = JSON.stringify(data);
      await this.ds.saveTour(t);
    }
  }

  /** A tournament game ended. */
  async gameEnded(tourId: string, gameId: string, result: '1-0' | '0-1' | '1/2-1/2', plies: number): Promise<void> {
    const t = await this.ds.tour(tourId);
    if (!t || t.status !== 'started') return;
    const data = read(t);
    const game = data.games.find(g => g.id === gameId);
    if (!game || game.result) return;
    game.result = result;
    for (const [color, id] of [['w', game.white], ['b', game.black]] as const) {
      const p = data.players.find(x => x.id === id);
      if (!p) continue;
      const outcome = outcomeFor(result, color);
      if (t.kind === 'swiss') addRound(p as SwissPlayer, { round: game.round, outcome, opponent: color === 'w' ? game.black : game.white, color });
      else {
        p.sheet.push(scoreGame(p.sheet, { gameId, outcome, plies, berserk: false }));
        p.score = totalOf(p.sheet);
        p.playing = null;
      }
    }
    if (t.kind === 'swiss') {
      if (!data.games.some(g => g.round === t.round && !g.result)) {
        if (t.round >= t.nbRounds!) await this.finish(t, data);
        else await this.nextSwissRound(t, data);
      }
    } else if (this.hooks.now() < t.endsAt!) await this.pairArenaWaiting(t, data, false);
    else if (!data.games.some(g => !g.result)) await this.finish(t, data);
    t.data = JSON.stringify(data);
    await this.ds.saveTour(t);
  }

  private async nextSwissRound(t: DailyTourRow, data: TourData): Promise<void> {
    const pairing = pairSwiss(data.players as SwissPlayer[], this.hooks.random);
    if (!pairing) return this.finish(t, data);
    t.round += 1;
    for (const pair of pairing.pairs) {
      const id = await this.hooks.startGame(t.id, pair.white, pair.black, t.days, t.rated);
      data.games.push({ id, white: pair.white, black: pair.black, round: t.round, result: null });
      for (const pid of [pair.white, pair.black]) await this.hooks.notify(pid, `Round ${t.round} of ${t.name} has started.`, t.id);
    }
    if (pairing.bye) {
      const p = data.players.find(x => x.id === pairing.bye)!;
      addRound(p as SwissPlayer, { round: t.round, outcome: 'bye', opponent: null, color: null });
      await this.hooks.notify(p.id, `You have a bye in round ${t.round} of ${t.name}: a free point.`, t.id);
    }
    // a round of nothing but a bye ends the tournament
    if (pairing.pairs.length === 0) await this.finish(t, data);
  }

  private async pairArenaWaiting(t: DailyTourRow, data: TourData, firstWave: boolean): Promise<void> {
    const waiting = data.players.filter(p => !p.withdrawn && !p.playing);
    const active = data.players.filter(p => !p.withdrawn);
    const ranks = new Map(standings(t, data).map(s => [s.id, s.rank]));
    for (const pair of pairArena(waiting as ArenaPlayer[], ranks, firstWave, active.length === 2, this.hooks.random)) {
      const id = await this.hooks.startGame(t.id, pair.white, pair.black, t.days, t.rated);
      data.games.push({ id, white: pair.white, black: pair.black, round: 0, result: null });
      for (const [pid, color] of [[pair.white, 'w'], [pair.black, 'b']] as const) {
        const p = data.players.find(x => x.id === pid)!;
        p.playing = id;
        p.lastOpponent = color === 'w' ? pair.black : pair.white;
        p.colors.push(color);
      }
    }
  }

  private async finish(t: DailyTourRow, data: TourData, note?: string): Promise<void> {
    t.status = 'finished';
    const table = standings(t, data);
    for (const s of table) await this.hooks.notify(s.id, note ? `${t.name}: ${note}` : `${t.name} has finished. You placed ${s.rank} of ${table.length}.`, t.id);
  }
}

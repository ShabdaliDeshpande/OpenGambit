import { randomBytes } from 'node:crypto';
import type { Color } from 'chess.js';
import { findTimeControl, type TimeControl } from '../../src/chess/clock.ts';
import {
  TOUR_OPTIONS,
  type CreateTour,
  type ServerMessage,
  type TourKind,
  type TourSnapshot,
  type TourStanding,
  type TourStatus,
  type TourSummary,
} from '../../src/online/protocol.ts';
import { speedOf } from '../config.ts';
import type { GameRoom, TournamentRules } from '../room.ts';
import { currentGlicko, type Store } from '../store.ts';
import type { Account, Conn } from '../types.ts';
import { pairArena, performance, rankArena, scoreGame, totalOf, type ArenaPlayer, type Outcome } from './arena.ts';
import { addRound, canJoinLate, pairSwiss, rankSwiss, sonnebornBerger, type SwissPlayer } from './swiss.ts';

/** What the manager needs from the game server. */
export interface TourHost {
  now(): number;
  random(): number;
  isOnline(userId: string): boolean;
  /** The account as the game server knows it now (with up-to-date ratings), if connected recently. */
  liveAccount(userId: string): Account | null;
  startGame(tc: TimeControl, white: Account, black: Account, rated: boolean, rules: TournamentRules): string;
}

export interface TourLimits {
  pairingMs: number;
  maxActive: number;
  maxPerUser: number;
  maxPlayers: number;
  /** Finished tournaments stay in memory (live page) this long; afterwards they come from the database. */
  finishedTtlMs: number;
}

export const DEFAULT_TOUR_LIMITS: TourLimits = {
  pairingMs: 1_000,
  maxActive: 30,
  maxPerUser: 2,
  maxPlayers: 200,
  finishedTtlMs: 30 * 60_000,
};

/** Swiss games: no draw offers before move 30. */
const SWISS_DRAW_MIN_PLIES = 60;

interface Base {
  id: string;
  name: string;
  tc: TimeControl;
  rated: boolean;
  createdBy: { id: string; name: string };
  createdAt: number;
  startsAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  status: TourStatus;
  cancelled: boolean;
  accounts: Map<string, Account>;
  /** Games being played: id → user ids. */
  games: Map<string, { white: string; black: string }>;
  timers: ReturnType<typeof setTimeout>[];
}

interface Arena extends Base {
  kind: 'arena';
  durationMs: number;
  berserk: boolean;
  streaks: boolean;
  players: Map<string, ArenaPlayer>;
  opponents: Map<string, string[]>;
}

interface Swiss extends Base {
  kind: 'swiss';
  nbRounds: number;
  roundIntervalMs: number;
  round: number;
  nextRoundAt: number | null;
  players: Map<string, SwissPlayer>;
}

type Tour = Arena | Swiss;

const NAME = /^[\p{L}\p{N} .,'!?&()#+-]{0,30}$/u;

const newId = () => {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(8)].map(b => chars[b % chars.length]).join('');
};

/**
 * Runs Arena and Swiss tournaments: sign-up, start, pairing, scoring and the
 * end, with a live page for everyone watching. Running tournaments are kept
 * in memory like running games; finished ones are saved to the database.
 */
export class TournamentManager {
  private readonly tours = new Map<string, Tour>();
  private readonly listeners = new Set<Conn>();
  private readonly watchers = new Map<string, Set<Conn>>();
  private readonly host: TourHost;
  private readonly store: Store | null;
  private readonly limits: TourLimits;
  private readonly writes = new Set<Promise<void>>();

  constructor(host: TourHost, store: Store | null, limits: Partial<TourLimits> = {}) {
    this.host = host;
    this.store = store;
    this.limits = { ...DEFAULT_TOUR_LIMITS, ...limits };
  }

  stop(): void {
    for (const t of this.tours.values()) this.clearTimers(t);
  }

  async settled(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes]);
  }

  get(id: string): Tour | undefined {
    return this.tours.get(id);
  }

  // ---------- messages from players ----------

  setListening(conn: Conn, on: boolean): void {
    if (on) {
      this.listeners.add(conn);
      conn.send({ t: 'tours', tours: this.list() });
    } else this.listeners.delete(conn);
  }

  watch(conn: Conn, id: string): void {
    const tour = this.tours.get(id);
    if (!tour) return conn.send({ t: 'error', message: 'Tournament not found.', tour: id });
    let set = this.watchers.get(id);
    if (!set) this.watchers.set(id, (set = new Set()));
    set.add(conn);
    conn.send({ t: 'tour', tour: this.snapshot(tour, conn) });
  }

  unwatch(conn: Conn, id: string): void {
    this.watchers.get(id)?.delete(conn);
  }

  dropConn(conn: Conn): void {
    this.listeners.delete(conn);
    for (const set of this.watchers.values()) set.delete(conn);
  }

  create(conn: Conn, req: CreateTour): string | null {
    const account = conn.player?.account;
    if (!account) return 'Sign in to create tournaments.';
    const tc = findTimeControl(req.tc);
    if (!tc) return 'Unknown time control.';
    const kind: TourKind | null = req.kind === 'arena' || req.kind === 'swiss' ? req.kind : null;
    if (!kind) return 'Unknown tournament type.';
    const name = typeof req.name === 'string' ? req.name.trim().replace(/\s+/g, ' ') : '';
    if (!NAME.test(name)) return 'Names can be up to 30 letters, digits, spaces and simple punctuation.';
    const pick = <T extends number>(value: unknown, allowed: readonly T[]) => (allowed.includes(value as T) ? (value as T) : null);
    const startIn = pick(req.startInMin, TOUR_OPTIONS.startInMin);
    if (startIn === null) return 'Pick when the tournament starts.';
    const active = [...this.tours.values()].filter(t => t.status !== 'finished');
    if (active.length >= this.limits.maxActive) return 'Too many tournaments are running. Try again later.';
    if (active.filter(t => t.createdBy.id === account.user.id).length >= this.limits.maxPerUser)
      return `You can have at most ${this.limits.maxPerUser} upcoming or running tournaments.`;

    const now = this.host.now();
    const base: Base = {
      id: newId(),
      name: name || `${tc.label} ${kind === 'arena' ? 'Arena' : 'Swiss'}`,
      tc,
      rated: req.rated === true,
      createdBy: { id: account.user.id, name: account.user.username },
      createdAt: now,
      startsAt: now + startIn * 60_000,
      startedAt: null,
      finishedAt: null,
      status: 'created',
      cancelled: false,
      accounts: new Map(),
      games: new Map(),
      timers: [],
    };
    let tour: Tour;
    if (kind === 'arena') {
      const duration = pick(req.durationMin, TOUR_OPTIONS.durationMin);
      if (duration === null) return 'Pick how long the arena lasts.';
      tour = { ...base, kind, durationMs: duration * 60_000, berserk: req.berserk === true, streaks: true, players: new Map(), opponents: new Map() };
    } else {
      const rounds = pick(req.nbRounds, TOUR_OPTIONS.nbRounds);
      const interval = pick(req.roundIntervalSec, TOUR_OPTIONS.roundIntervalSec);
      if (rounds === null || interval === null) return 'Pick the number of rounds and the pause between them.';
      tour = { ...base, kind, nbRounds: rounds, roundIntervalMs: interval * 1000, round: 0, nextRoundAt: null, players: new Map() };
    }
    this.tours.set(tour.id, tour);
    this.later(tour, tour.startsAt - now, () => this.start(tour));
    // the creator usually wants to play
    this.join(conn, tour.id);
    conn.send({ t: 'tourCreated', id: tour.id });
    this.changed(tour);
    return null;
  }

  join(conn: Conn, id: string): string | null {
    const account = conn.player?.account;
    if (!account) return 'Sign in to join tournaments.';
    const tour = this.tours.get(id);
    if (!tour) return 'Tournament not found.';
    if (!this.canJoin(tour, account.user.id)) return 'This tournament can’t be joined now.';
    const userId = account.user.id;
    const existing = tour.players.get(userId);
    if (!existing && tour.players.size >= this.limits.maxPlayers) return 'This tournament is full.';
    tour.accounts.set(userId, account);
    if (existing) existing.withdrawn = false;
    else {
      const rating = Math.round(currentGlicko(account.ratings[speedOf(tour.tc)], this.host.now()).rating);
      const base = { id: userId, name: account.user.username, rating, joinedAt: this.host.now(), withdrawn: false };
      if (tour.kind === 'arena')
        tour.players.set(userId, { ...base, sheet: [], score: 0, playing: null, lastOpponent: null, colors: [] });
      else {
        const p: SwissPlayer = { ...base, halves: 0, rounds: [] };
        // rounds already played count as absences
        for (let r = 1; r <= tour.round; r++) addRound(p, { round: r, outcome: 'absent', opponent: null, color: null });
        tour.players.set(userId, p);
      }
    }
    this.changed(tour);
    return null;
  }

  withdraw(conn: Conn, id: string): string | null {
    const userId = conn.player?.account?.user.id;
    const tour = this.tours.get(id);
    if (!tour || !userId) return 'Tournament not found.';
    const p = tour.players.get(userId);
    if (!p || tour.status === 'finished') return null;
    // before the start you simply leave; afterwards you pause and keep your score
    if (tour.status === 'created') tour.players.delete(userId);
    else p.withdrawn = true;
    this.changed(tour);
    return null;
  }

  // ---------- the game server tells us about finished games ----------

  gameEnded(room: GameRoom): void {
    const tour = room.tournament && this.tours.get(room.tournament.id);
    if (!tour || !tour.games.delete(room.id)) return;
    const [w, b] = [room.player('w').id, room.player('b').id];
    const winner = room.result?.winner ?? null;
    const outcome = (c: Color): Outcome => (winner === null ? 'draw' : winner === c ? 'win' : 'loss');
    const noShow = room.result?.reason === 'no-start' ? (winner === 'w' ? b : w) : null;

    if (tour.kind === 'arena') {
      for (const [id, c] of [
        [w, 'w'],
        [b, 'b'],
      ] as const) {
        const p = tour.players.get(id);
        if (!p) continue;
        p.playing = null;
        // games still running when the arena ends don't count
        if (tour.status === 'started' && room.result) {
          p.sheet.push(scoreGame(p.sheet, { gameId: room.id, outcome: outcome(c), plies: room.plies, berserk: room.berserked[c] }, tour.streaks));
          p.score = totalOf(p.sheet);
        }
        if (id === noShow) p.withdrawn = true;
      }
    } else {
      const round = tour.round;
      for (const [id, c, opp] of [
        [w, 'w', b],
        [b, 'b', w],
      ] as const) {
        const p = tour.players.get(id);
        if (!p) continue;
        addRound(p, { round, outcome: outcome(c), opponent: opp, color: c });
        if (id === noShow) p.withdrawn = true;
      }
      if (tour.status === 'started' && tour.games.size === 0) this.roundOver(tour);
    }
    this.changed(tour);
  }

  // ---------- lifecycle ----------

  private start(tour: Tour): void {
    if (tour.status !== 'created') return;
    const active = [...tour.players.values()].filter(p => !p.withdrawn);
    if (active.length < 2) return this.finish(tour, true);
    tour.status = 'started';
    tour.startedAt = this.host.now();
    if (tour.kind === 'arena') {
      this.later(tour, tour.durationMs, () => this.finish(tour));
      this.pairArenaNow(tour);
      const tick = () => {
        if (tour.status !== 'started') return;
        this.pairArenaNow(tour);
        this.later(tour, this.limits.pairingMs, tick);
      };
      this.later(tour, this.limits.pairingMs, tick);
    } else this.startRound(tour);
    this.changed(tour);
  }

  private pairArenaNow(tour: Arena): void {
    const players = [...tour.players.values()];
    const waiting = players.filter(p => !p.withdrawn && !p.playing && this.host.isOnline(p.id));
    if (waiting.length < 2) return;
    const ranked = this.arenaRanking(tour);
    const ranks = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const firstWave = players.every(p => p.sheet.length === 0) && tour.games.size === 0;
    const onlyTwo = players.filter(p => !p.withdrawn).length === 2;
    const pairs = pairArena(waiting, ranks, firstWave, onlyTwo, this.host.random);
    for (const { white, black } of pairs) this.launch(tour, white, black, { berserk: tour.berserk, drawMinPlies: 0 });
    if (pairs.length) this.changed(tour);
  }

  private startRound(tour: Swiss): void {
    if (tour.status !== 'started') return;
    tour.nextRoundAt = null;
    if (tour.round >= tour.nbRounds) return this.finish(tour);
    const pairing = pairSwiss([...tour.players.values()], this.host.random);
    // nobody left to pair who hasn't met: the tournament is over
    if (!pairing || pairing.pairs.length === 0) return this.finish(tour);
    tour.round += 1;
    const round = tour.round;
    for (const p of tour.players.values()) if (p.withdrawn) addRound(p, { round, outcome: 'absent', opponent: null, color: null });
    if (pairing.bye) addRound(tour.players.get(pairing.bye)!, { round, outcome: 'bye', opponent: null, color: null });
    for (const { white, black } of pairing.pairs) this.launch(tour, white, black, { berserk: false, drawMinPlies: SWISS_DRAW_MIN_PLIES });
    this.changed(tour);
  }

  private roundOver(tour: Swiss): void {
    if (tour.round >= tour.nbRounds) return this.finish(tour);
    tour.nextRoundAt = this.host.now() + tour.roundIntervalMs;
    this.later(tour, tour.roundIntervalMs, () => this.startRound(tour));
  }

  private launch(tour: Tour, white: string, black: string, rules: { berserk: boolean; drawMinPlies: number }): void {
    const acc = (id: string) => this.host.liveAccount(id) ?? tour.accounts.get(id)!;
    const gameId = this.host.startGame(tour.tc, acc(white), acc(black), tour.rated, { id: tour.id, name: tour.name, ...rules });
    tour.games.set(gameId, { white, black });
    if (tour.kind === 'arena') {
      const [w, b] = [tour.players.get(white)!, tour.players.get(black)!];
      w.playing = gameId;
      b.playing = gameId;
      w.colors.push('w');
      b.colors.push('b');
      w.lastOpponent = black;
      b.lastOpponent = white;
      tour.opponents.set(white, [...(tour.opponents.get(white) ?? []), black]);
      tour.opponents.set(black, [...(tour.opponents.get(black) ?? []), white]);
    }
  }

  private finish(tour: Tour, cancelled = false): void {
    if (tour.status === 'finished') return;
    tour.status = 'finished';
    tour.cancelled = cancelled;
    tour.finishedAt = this.host.now();
    if (tour.kind === 'swiss') tour.nextRoundAt = null;
    this.clearTimers(tour);
    if (!cancelled) this.save(tour);
    this.changed(tour);
    // keep the live page for a while, then serve it from the database
    this.later(tour, this.limits.finishedTtlMs, () => {
      this.tours.delete(tour.id);
      this.watchers.delete(tour.id);
    });
  }

  private save(tour: Tour): void {
    if (!this.store || tour.startedAt === null) return;
    const standings = this.standings(tour);
    const write = this.store
      .saveTournament({
        id: tour.id,
        kind: tour.kind,
        name: tour.name,
        tc: tour.tc.id,
        rated: tour.rated,
        createdBy: tour.createdBy.id,
        createdByName: tour.createdBy.name,
        settings: this.settingsOf(tour),
        startedAt: tour.startedAt,
        finishedAt: tour.finishedAt ?? this.host.now(),
        players: tour.players.size,
        winnerName: standings[0]?.name ?? null,
        standings: standings.map(s => ({ ...s, playing: null })),
      })
      .catch(err => console.error(`Could not save tournament ${tour.id}:`, err))
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
  }

  // ---------- views ----------

  private canJoin(tour: Tour, userId: string): boolean {
    if (tour.status === 'finished') return false;
    if (tour.kind === 'swiss' && tour.status === 'started' && !tour.players.has(userId)) return canJoinLate(tour.round, tour.nbRounds);
    return true;
  }

  private arenaRanking(tour: Arena): ArenaPlayer[] {
    const ratingOf = (id: string) => tour.players.get(id)?.rating ?? 1500;
    const perf = new Map([...tour.players.values()].map(p => [p.id, performance(p, ratingOf, tour.opponents.get(p.id) ?? [])]));
    return rankArena([...tour.players.values()], p => perf.get(p.id) ?? 0);
  }

  private standings(tour: Tour): TourStanding[] {
    if (tour.kind === 'arena') {
      const ratingOf = (id: string) => tour.players.get(id)?.rating ?? 1500;
      return this.arenaRanking(tour).map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        rating: p.rating,
        score: p.score,
        fire: tour.streaks && p.sheet.at(-1)?.result === 'win' && p.sheet.at(-2)?.result === 'win',
        withdrawn: p.withdrawn,
        playing: p.playing,
        tieBreak: p.sheet.length ? performance(p, ratingOf, tour.opponents.get(p.id) ?? []) : null,
        arena: p.sheet.map(e => ({ result: e.result, points: e.points, fire: e.fire, berserk: e.berserk })),
      }));
    }
    const byId = new Map([...tour.players.values()].map(p => [p.id, p]));
    const playing = new Map<string, string>();
    for (const [gameId, g] of tour.games) {
      playing.set(g.white, gameId);
      playing.set(g.black, gameId);
    }
    return rankSwiss([...tour.players.values()]).map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      rating: p.rating,
      score: p.halves / 2,
      fire: false,
      withdrawn: p.withdrawn,
      playing: playing.get(p.id) ?? null,
      tieBreak: sonnebornBerger(p, byId),
      swiss: p.rounds.map(r => ({ round: r.round, outcome: r.outcome, opponent: r.opponent ? (byId.get(r.opponent)?.name ?? null) : null, color: r.color })),
    }));
  }

  private settingsOf(tour: Tour): Record<string, unknown> {
    return tour.kind === 'arena'
      ? { durationMin: tour.durationMs / 60_000, berserk: tour.berserk, streaks: tour.streaks }
      : { nbRounds: tour.nbRounds, roundIntervalSec: tour.roundIntervalMs / 1000, rounds: tour.round };
  }

  summary(tour: Tour): TourSummary {
    const now = this.host.now();
    const standings = tour.status === 'finished' && !tour.cancelled ? this.standings(tour) : null;
    return {
      id: tour.id,
      kind: tour.kind,
      name: tour.name,
      tc: tour.tc.id,
      rated: tour.rated,
      status: tour.status,
      cancelled: tour.cancelled,
      createdBy: tour.createdBy.name,
      players: tour.players.size,
      msToStart: tour.status === 'created' ? Math.max(0, tour.startsAt - now) : null,
      msToEnd: tour.kind === 'arena' && tour.status === 'started' && tour.startedAt !== null ? Math.max(0, tour.startedAt + tour.durationMs - now) : null,
      round: tour.kind === 'swiss' ? tour.round : null,
      nbRounds: tour.kind === 'swiss' ? tour.nbRounds : null,
      winner: standings?.[0]?.name ?? null,
    };
  }

  snapshot(tour: Tour, viewer: Conn | null): TourSnapshot {
    const userId = viewer?.player?.account?.user.id ?? null;
    const me = userId ? tour.players.get(userId) : undefined;
    const names = (id: string) => tour.players.get(id)?.name ?? '?';
    const standings = this.standings(tour);
    return {
      ...this.summary(tour),
      berserk: tour.kind === 'arena' && tour.berserk,
      streaks: tour.kind === 'arena' && tour.streaks,
      durationMin: tour.kind === 'arena' ? tour.durationMs / 60_000 : null,
      roundIntervalSec: tour.kind === 'swiss' ? tour.roundIntervalMs / 1000 : null,
      msToNextRound: tour.kind === 'swiss' && tour.nextRoundAt !== null ? Math.max(0, tour.nextRoundAt - this.host.now()) : null,
      standings,
      games: [...tour.games].map(([id, g]) => ({ id, white: names(g.white), black: names(g.black) })),
      you: userId
        ? { joined: !!me, withdrawn: !!me?.withdrawn, playing: standings.find(s => s.id === userId)?.playing ?? null }
        : null,
      canJoin: !!userId && this.canJoin(tour, userId) && (!me || me.withdrawn),
    };
  }

  list(): TourSummary[] {
    const order: Record<TourStatus, number> = { started: 0, created: 1, finished: 2 };
    return [...this.tours.values()]
      .sort((a, b) => order[a.status] - order[b.status] || a.startsAt - b.startsAt)
      .map(t => this.summary(t));
  }

  private changed(tour: Tour): void {
    for (const conn of this.watchers.get(tour.id) ?? []) conn.send({ t: 'tour', tour: this.snapshot(tour, conn) });
    const tours: ServerMessage = { t: 'tours', tours: this.list() };
    for (const conn of this.listeners) conn.send(tours);
  }

  private later(tour: Tour, ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      tour.timers = tour.timers.filter(x => x !== t);
      fn();
    }, Math.max(0, ms));
    tour.timers.push(t);
  }

  private clearTimers(tour: Tour): void {
    for (const t of tour.timers) clearTimeout(t);
    tour.timers = [];
  }
}

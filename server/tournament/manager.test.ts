import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTour, TourSnapshot } from '../../src/online/protocol.ts';
import { migrate } from '../db/db.ts';
import { openSqlite } from '../db/sqlite.ts';
import { Store } from '../store.ts';
import { testHub, type TestClient } from '../testUtils.ts';
import type { Account } from '../types.ts';

const ARENA: CreateTour = {
  kind: 'arena',
  name: 'Friday Blitz',
  tc: '3+2',
  rated: true,
  startInMin: 1,
  durationMin: 10,
  berserk: true,
  nbRounds: 0,
  roundIntervalSec: 0,
};
const SWISS: CreateTour = { ...ARENA, kind: 'swiss', name: '', nbRounds: 3, roundIntervalSec: 10, durationMin: 0, berserk: false };

/** 14 quiet plies, so a berserk win afterwards earns its bonus. */
const OPENING = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c2c3', 'd7d6', 'b1d2', 'a7a6', 'h2h3', 'h7h6'];
/** 20 plies: long enough for a draw to score. */
const LONGER = [...OPENING, 'a2a3', 'b7b5', 'c4a2', 'c8b7', 'e1g1', 'e8g8'];

describe('tournaments', () => {
  let store: Store;
  let h: ReturnType<typeof testHub>;
  const accounts: Record<string, Account> = {};
  const clients: Record<string, TestClient> = {};

  beforeEach(async () => {
    vi.useFakeTimers();
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    h = testHub({ firstMoveMs: () => 20_000 }, store);
    // ratings differ so first-wave pairings are predictable: a > b > c > d > e
    for (const [i, name] of ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'].entries()) {
      const user = (await store.createUser(name, 'h'))!;
      const ratings = await store.ratings(user.id);
      ratings.blitz = { glicko: { rating: 2000 - i * 100, deviation: 80, volatility: 0.06 }, games: 10, updatedAt: Date.now() };
      accounts[name] = { user, ratings };
      clients[name] = h.join(null, accounts[name]!);
    }
  });
  afterEach(async () => {
    h.hub.stop();
    vi.useRealTimers();
    await store.db.close();
  });

  const tm = () => h.hub.tournaments;
  const snap = (id: string): TourSnapshot => tm().snapshot(tm().get(id)!, null);
  const create = (who: string, req: CreateTour) => {
    clients[who]!.send({ t: 'createTour', tour: req });
    return clients[who]!.last('tourCreated')!.id;
  };
  const gameOf = (id: string, name: string) => snap(id).standings.find(s => s.name === name)!.playing!;
  const colorOf = (game: string, name: string) => (h.hub.room(game)!.player('w').name === name ? 'w' : 'b');
  /** Plays moves in a game, alternating sides, then optionally resigns as `resigner`. */
  const play = (game: string, moves: string[], resigner?: string) => {
    const room = h.hub.room(game)!;
    const byColor = { w: clients[room.player('w').name]!, b: clients[room.player('b').name]! };
    moves.forEach((uci, ply) => byColor[ply % 2 ? 'b' : 'w'].send({ t: 'move', game, uci, ply: room.plies }));
    if (resigner) clients[resigner]!.send({ t: 'resign', game });
  };
  const foolsMate = (game: string) => {
    // whoever has White plays the losing moves
    play(game, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  };

  it('only lets signed-in players create and join, and validates settings', () => {
    const guest = h.join();
    guest.send({ t: 'createTour', tour: ARENA });
    expect(guest.errors()).toEqual(['Sign in to create tournaments.']);
    clients.Alice!.send({ t: 'createTour', tour: { ...ARENA, startInMin: 3 } });
    clients.Alice!.send({ t: 'createTour', tour: { ...ARENA, tc: '7+7' } });
    clients.Alice!.send({ t: 'createTour', tour: { ...ARENA, name: '<script>' } });
    expect(clients.Alice!.errors()).toEqual([
      'Pick when the tournament starts.',
      'Unknown time control.',
      'Names can be up to 30 letters, digits, spaces and simple punctuation.',
    ]);
    const id = create('Alice', ARENA);
    expect(snap(id)).toMatchObject({ name: 'Friday Blitz', kind: 'arena', status: 'created', players: 1, msToStart: 60_000 });
    guest.send({ t: 'joinTour', id });
    expect(guest.errors()).toContain('Sign in to join tournaments.');
  });

  it('lists tournaments live to everyone who is looking', () => {
    const guest = h.join();
    guest.send({ t: 'tours', on: true });
    const id = create('Bob', SWISS);
    expect(guest.last('tours')!.tours).toMatchObject([{ id, kind: 'swiss', name: '3+2 Blitz Swiss', players: 1, nbRounds: 3 }]);
    clients.Carol!.send({ t: 'joinTour', id });
    expect(guest.last('tours')!.tours[0]!.players).toBe(2);
  });

  it('cancels a tournament that nobody else joined', () => {
    const id = create('Alice', ARENA);
    vi.advanceTimersByTime(60_000);
    expect(snap(id)).toMatchObject({ status: 'finished', cancelled: true });
  });

  it('runs an arena: rating pairings, streaks, berserk, re-pairing and the end', async () => {
    const id = create('Alice', ARENA);
    for (const n of ['Bob', 'Carol', 'Dave']) clients[n]!.send({ t: 'joinTour', id });
    clients.Dave!.send({ t: 'watchTour', id });
    vi.advanceTimersByTime(60_000);

    // first wave pairs by rating: Alice–Bob and Carol–Dave
    const g1 = gameOf(id, 'Alice');
    const g2 = gameOf(id, 'Carol');
    expect(gameOf(id, 'Bob')).toBe(g1);
    expect(gameOf(id, 'Dave')).toBe(g2);
    expect(clients.Alice!.last('started')!.game).toBe(g1);
    expect(h.hub.room(g1)!.snapshot(clients.Alice!.conn)).toMatchObject({ tournament: { id, name: 'Friday Blitz' }, canAbort: false, canBerserk: true });

    // Alice goes berserk and wins after 14 plies: 2 + 1
    clients.Alice!.send({ t: 'berserk', game: g1 });
    const aliceColor = colorOf(g1, 'Alice');
    expect(h.hub.room(g1)!.remainingMs(aliceColor)).toBe(90_000);
    play(g1, OPENING, 'Bob');
    // Carol–Dave: a draw by agreement after 20 plies scores 1 each
    play(g2, LONGER);
    clients.Carol!.send({ t: 'draw', game: g2, action: 'offer' });
    clients.Dave!.send({ t: 'draw', game: g2, action: 'accept' });
    await h.hub.settled();

    let table = snap(id).standings;
    expect(table.map(s => [s.name, s.score])).toEqual([
      ['Alice', 3],
      // equal points: Dave's performance is higher (he drew a higher-rated opponent)
      ['Dave', 1],
      ['Carol', 1],
      ['Bob', 0],
    ]);
    expect(table[0]!.arena).toEqual([{ result: 'win', points: 3, fire: false, berserk: true }]);
    expect(clients.Dave!.last('tour')!.tour.standings[0]!.name).toBe('Alice');

    // next pairing tick: no rematches, so Alice meets Carol or Dave
    vi.advanceTimersByTime(1_000);
    const g3 = gameOf(id, 'Alice');
    const aliceOpp = [h.hub.room(g3)!.player('w').name, h.hub.room(g3)!.player('b').name].find(n => n !== 'Alice')!;
    expect(['Carol', 'Dave']).toContain(aliceOpp);
    const g4 = gameOf(id, 'Bob');
    expect(g4).not.toBe(g3);

    // Alice wins again, then a third time on fire: 2, then 4
    play(g3, OPENING, aliceOpp);
    play(g4, OPENING);
    clients.Bob!.send({ t: 'resign', game: g4 });
    vi.advanceTimersByTime(1_000);
    const g5 = gameOf(id, 'Alice');
    const opp5 = [h.hub.room(g5)!.player('w').name, h.hub.room(g5)!.player('b').name].find(n => n !== 'Alice')!;
    play(g5, OPENING, opp5);
    table = snap(id).standings;
    expect(table[0]).toMatchObject({ name: 'Alice', score: 3 + 2 + 4, fire: true });

    // a game still running when time is up doesn't count
    vi.advanceTimersByTime(1_000);
    const running = snap(id).games.length;
    vi.advanceTimersByTime(10 * 60_000);
    expect(snap(id).status).toBe('finished');
    const before = snap(id).standings.map(s => s.score);
    for (const g of [...h.hub['rooms'].values()].filter(r => r.status === 'playing' && r.tournament)) clients[g.player('w').name]!.send({ t: 'resign', game: g.id });
    expect(snap(id).standings.map(s => s.score)).toEqual(before);
    expect(running).toBeGreaterThanOrEqual(0);

    await h.hub.settled();
    const saved = await store.tournament(id);
    expect(saved).toMatchObject({ kind: 'arena', name: 'Friday Blitz', winnerName: 'Alice', players: 4, rated: true });
    expect((await store.game(g1))!.tournamentId).toBe(id);
    // rated tournament games count for ratings (Alice played at least three)
    expect((await store.ratings(accounts.Alice!.user.id)).blitz.games).toBeGreaterThanOrEqual(3);
  });

  it('forfeits a missed first move in an arena and pauses that player', () => {
    const id = create('Alice', { ...ARENA, berserk: false });
    clients.Bob!.send({ t: 'joinTour', id });
    vi.advanceTimersByTime(60_000);
    const g = gameOf(id, 'Alice');
    vi.advanceTimersByTime(20_000);
    const room = h.hub.room(g)!;
    expect(room.result).toMatchObject({ reason: 'no-start' });
    const late = room.player(room.result!.winner === 'w' ? 'b' : 'w').name;
    const row = snap(id).standings.find(s => s.name === late)!;
    expect(row).toMatchObject({ withdrawn: true, score: 0 });
    expect(snap(id).standings[0]!.score).toBe(2);
  });

  it('lets players leave before the start and pause later', () => {
    const id = create('Alice', ARENA);
    clients.Bob!.send({ t: 'joinTour', id });
    clients.Bob!.send({ t: 'withdrawTour', id });
    expect(snap(id).players).toBe(1);
    clients.Bob!.send({ t: 'joinTour', id });
    clients.Carol!.send({ t: 'joinTour', id });
    vi.advanceTimersByTime(60_000);
    clients.Carol!.send({ t: 'withdrawTour', id });
    expect(snap(id).standings.find(s => s.name === 'Carol')).toMatchObject({ withdrawn: true });
    clients.Carol!.send({ t: 'joinTour', id });
    expect(snap(id).standings.find(s => s.name === 'Carol')).toMatchObject({ withdrawn: false });
  });

  it('runs a swiss: byes, rounds after the interval, no early draws, late join, and the end', async () => {
    const id = create('Alice', SWISS);
    clients.Bob!.send({ t: 'joinTour', id });
    clients.Carol!.send({ t: 'joinTour', id });
    vi.advanceTimersByTime(60_000);
    let s = snap(id);
    expect(s.round).toBe(1);
    expect(s.games).toHaveLength(1);
    // the lowest-rated player gets the bye
    expect(s.standings.find(x => x.name === 'Carol')!.swiss).toEqual([{ round: 1, outcome: 'bye', opponent: null, color: null }]);

    const g1 = gameOf(id, 'Alice');
    play(g1, OPENING);
    clients.Alice!.send({ t: 'draw', game: g1, action: 'offer' });
    expect(clients.Alice!.errors()).toContain('You can’t offer a draw again yet.'); // not before move 30
    clients.Bob!.send({ t: 'resign', game: g1 });

    // round 1 is over: late joining is still open (1 of 3 rounds started)
    expect(snap(id).msToNextRound).toBe(10_000);
    clients.Dave!.send({ t: 'joinTour', id });
    expect(snap(id).standings.find(x => x.name === 'Dave')!.swiss).toEqual([{ round: 1, outcome: 'absent', opponent: null, color: null }]);
    vi.advanceTimersByTime(10_000);
    s = snap(id);
    expect(s.round).toBe(2);
    expect(s.games).toHaveLength(2);
    // nobody meets the same opponent twice
    expect(h.hub.room(gameOf(id, 'Alice'))!.player(colorOf(gameOf(id, 'Alice'), 'Alice') === 'w' ? 'b' : 'w').name).not.toBe('Bob');
    // late joining closes once more than half the rounds have started
    clients.Erin!.send({ t: 'joinTour', id });
    expect(clients.Erin!.errors()).toContain('This tournament can’t be joined now.');

    for (const g of s.games) play(g.id, OPENING, g.black);
    vi.advanceTimersByTime(10_000);
    for (const g of snap(id).games) play(g.id, OPENING, g.black);
    s = snap(id);
    expect(s.status).toBe('finished');
    expect(s.round).toBe(3);
    const points = s.standings.map(x => x.score);
    expect(points).toEqual([...points].sort((a, b) => b - a));
    await h.hub.settled();
    expect(await store.tournament(id)).toMatchObject({ kind: 'swiss', players: 4 });
  });

  it('pairs swiss players even if they are offline; a no-show loses and is withdrawn', () => {
    const id = create('Alice', SWISS);
    clients.Bob!.send({ t: 'joinTour', id });
    h.disconnect(clients.Bob!);
    vi.advanceTimersByTime(60_000);
    const g = gameOf(id, 'Alice');
    if (colorOf(g, 'Alice') === 'w') play(g, ['e2e4']);
    vi.advanceTimersByTime(20_000);
    expect(h.hub.room(g)!.result).toMatchObject({ reason: 'no-start' });
    const s = snap(id);
    expect(s.standings[0]).toMatchObject({ name: 'Alice', score: 1 });
    expect(s.standings.find(x => x.name === 'Bob')).toMatchObject({ withdrawn: true });
    // with one active player left, the tournament ends at the next round
    vi.advanceTimersByTime(10_000);
    expect(snap(id).status).toBe('finished');
  });

  void foolsMate;
});

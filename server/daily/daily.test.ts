import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/db.ts';
import { openSqlite } from '../db/sqlite.ts';
import { Store, type User } from '../store.ts';
import { DAY_MS } from '../../src/daily/rules.ts';
import { DailyService } from './daily.ts';

describe('daily chess', () => {
  let store: Store;
  let daily: DailyService;
  let t: number;
  let ana: User;
  let ben: User;
  let cy: User;
  let dee: User;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    t = Date.UTC(2026, 9, 1, 12);
    store = new Store(db, () => t);
    let seed = 1;
    daily = new DailyService(store, { now: () => t, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });
    [ana, ben, cy, dee] = (await Promise.all(['Ana', 'Ben', 'Cy', 'Dee'].map(async n => (await store.createUser(n, 'h'))!))) as [User, User, User, User];
  });
  afterEach(async () => {
    daily.stop();
    await store.db.close();
  });

  /** Ana plays White against Ben. */
  async function newGame(days = 3, rated = false) {
    const seek = await daily.createSeek(ana, days, 'w', rated);
    return daily.acceptSeek(ben, seek);
  }
  const kinds = async (u: User) => (await daily.notifications(u)).list.map(n => n.kind);

  it('pairs a seek, takes moves in turn and tells the other player', async () => {
    const id = await newGame();
    expect((await daily.seeks(ana)).length).toBe(0);
    let view = await daily.move(ana, id, 'e2e4', 0);
    expect(view!.moves).toEqual(['e2e4']);
    expect(view!.turn).toBe('b');
    expect(view!.deadline).toBe(t + 3 * DAY_MS);
    await expect(daily.move(ana, id, 'd2d4', 1)).rejects.toThrow('It’s not your move.');
    await expect(daily.move(ben, id, 'e7e5', 0)).rejects.toThrow('The game has moved on');
    await expect(daily.move(ben, id, 'e7e4', 1)).rejects.toThrow('isn’t legal');
    t += DAY_MS;
    view = await daily.move(ben, id, 'e7e5', 1);
    expect(view!.deadline).toBe(t + 3 * DAY_MS);
    expect(await kinds(ben)).toContain('move');
    const mine = await daily.myGames(ana);
    expect(mine).toMatchObject([{ id, opponent: 'Ben', you: 'w', yourMove: true }]);
  });

  it('plays your conditional reply as soon as the opponent makes the expected move', async () => {
    const id = await newGame();
    await daily.move(ana, id, 'e2e4', 0);
    await daily.move(ben, id, 'e7e5', 1);
    await daily.move(ana, id, 'g1f3', 2);
    // Ben prepares: if Ana plays Bc4 after ...Nc6, answer Nf6
    await expect(daily.setLines(ben, id, [['d2d4']])).rejects.toThrow(); // not his turn to prepare: it's his move
    await daily.move(ben, id, 'b8c6', 3);
    expect(await daily.setLines(ben, id, [['f1c4', 'g8f6', 'd2d3', 'f8e7'], ['f1b5', 'a7a6']])).toHaveLength(2);
    const view = await daily.move(ana, id, 'f1c4', 4);
    expect(view!.moves.slice(-2)).toEqual(['f1c4', 'g8f6']);
    expect(view!.turn).toBe('w');
    expect(await kinds(ben)).toContain('conditional');
    // the line goes on: d3 is answered by Be7 too
    const after = await daily.move(ana, id, 'd2d3', 6);
    expect(after!.moves.at(-1)).toBe('f8e7');
    // an unexpected move drops the rest
    expect((await daily.view(id, ben))!.lines).toEqual([]);
  });

  it('reminds at 80% of the time and ends the game on time', async () => {
    const id = await newGame(1);
    t += 0.81 * DAY_MS;
    await daily.sweep();
    expect(await kinds(ana)).toContain('reminder');
    t += 0.2 * DAY_MS;
    await daily.sweep();
    const done = await store.game(id);
    expect(done).toMatchObject({ result: '0-1', reason: 'timeout', category: 'correspondence', tc: '1d' });
    expect(await daily.myGames(ana)).toEqual([]);
    expect((await daily.view(id, ana))!.status).toBe('ended');
  });

  it('rates finished games in the correspondence category', async () => {
    const id = await newGame(3, true);
    await daily.resign(ana, id);
    const ratings = await store.ratings(ben.id);
    expect(ratings.correspondence.games).toBe(1);
    expect(ratings.correspondence.glicko.rating).toBeGreaterThan(1500);
  });

  it('pauses your clocks on vacation and gives back unused whole days', async () => {
    const id = await newGame(3);
    const before = (await daily.view(id, ana))!.deadline;
    const v = await daily.setVacation(ana, 5);
    expect(v).toMatchObject({ on: true, left: 9 });
    expect((await daily.view(id, ana))!.deadline).toBe(before + 5 * DAY_MS);
    await expect(daily.createSeek(ana, 3, 'w', false)).rejects.toThrow('on vacation');
    // ended after a day and a half: three whole days come back
    t += 1.5 * DAY_MS;
    expect(await daily.setVacation(ana, null)).toMatchObject({ on: false, left: 12 });
    expect((await daily.view(id, ana))!.deadline).toBe(before + 2 * DAY_MS);
  });

  it('starts your clock after your vacation when the opponent moves meanwhile', async () => {
    const id = await newGame(2);
    await daily.move(ana, id, 'e2e4', 0);
    await daily.setVacation(ben, 4);
    t += DAY_MS;
    expect((await daily.view(id, ben))!.deadline).toBe(t - DAY_MS + 4 * DAY_MS + 2 * DAY_MS);
    await daily.move(ben, id, 'e7e5', 1);
    await daily.setVacation(ben, null);
  });

  it('handles draw offers, challenges and their answers', async () => {
    const id = await newGame();
    await daily.draw(ana, id, 'offer');
    await expect(daily.draw(ana, id, 'accept')).rejects.toThrow('no draw offer');
    await daily.draw(ben, id, 'accept');
    expect((await store.game(id))!.result).toBe('1/2-1/2');

    const c = await daily.challenge(cy, 'dee', 7, 'b', false);
    expect(await kinds(dee)).toContain('challenge');
    expect((await daily.challenges(dee))[0]).toMatchObject({ incoming: true, name: 'Cy', days: 7 });
    const game = await daily.answerChallenge(dee, c, 'accept');
    expect((await daily.view(game!, dee))!.white.name).toBe('Dee');
    await expect(daily.challenge(cy, 'nobody', 3, 'w', false)).rejects.toThrow('No player');
    const c2 = await daily.challenge(cy, 'Dee', 3, 'w', false);
    await daily.answerChallenge(dee, c2, 'decline');
    expect((await daily.challenges(cy)).length).toBe(0);
  });

  it('runs a daily Swiss round by round', async () => {
    const id = await daily.createTour(ana, { kind: 'swiss', name: 'Autumn Swiss', days: 3, rated: false, startInHours: 1, nbRounds: 3 });
    for (const u of [ana, ben, cy, dee]) await daily.tours.join(u.id, u.username, id);
    t += 3_600_000;
    await daily.sweep();
    let tour = (await daily.tours.view(id))!;
    expect(tour).toMatchObject({ status: 'started', round: 1 });
    expect(tour.games).toHaveLength(2);
    for (let round = 1; round <= 3; round++) {
      tour = (await daily.tours.view(id))!;
      for (const g of tour.games.filter(x => x.round === round)) {
        const loser = [ana, ben, cy, dee].find(u => u.id === g.black)!;
        await daily.resign(loser, g.id);
      }
    }
    tour = (await daily.tours.view(id))!;
    expect(tour.status).toBe('finished');
    expect(tour.games).toHaveLength(6);
    expect(tour.standings[0]!.points).toBeGreaterThanOrEqual(2);
    expect(await kinds(ana)).toContain('tour');
  });

  it('runs a daily Arena for its days, pairing you again after each game', async () => {
    const id = await daily.createTour(ana, { kind: 'arena', name: 'Week Arena', days: 1, rated: false, startInHours: 1, durationDays: 7 });
    for (const u of [ana, ben, cy, dee]) await daily.tours.join(u.id, u.username, id);
    t += 3_600_000;
    await daily.sweep();
    let tour = (await daily.tours.view(id))!;
    expect(tour.games.filter(g => !g.result)).toHaveLength(2);
    const first = tour.games[0]!;
    await daily.resign([ana, ben, cy, dee].find(u => u.id === first.black)!, first.id);
    tour = (await daily.tours.view(id))!;
    expect(tour.standings[0]!.points).toBe(2);
    // after the end time, games still running finish, then the Arena ends
    t += 8 * DAY_MS;
    await daily.sweep();
    tour = (await daily.tours.view(id))!;
    expect(tour.status).toBe('finished');
  });
});

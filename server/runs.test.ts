import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { PuzzleCatalogue } from './puzzles.ts';
import { Store } from './store.ts';

describe('streak and storm bests', () => {
  let store: Store;
  let now = 10 * 86_400_000 + 5_000; // day 10, just after midnight UTC
  let userId: string;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db, () => now);
    userId = (await store.createUser('runner', 'h'))!.id;
  });
  afterEach(() => store.db.close());

  it('keeps the best of all time and of today, separately per mode', async () => {
    expect(await store.recordRun(userId, 'storm', 12)).toMatchObject({ storm: { best: 12, today: 12 }, streak: { best: 0, today: 0 }, newBest: true });
    expect(await store.recordRun(userId, 'storm', 9)).toMatchObject({ storm: { best: 12, today: 12 }, newBest: false });
    now += 86_400_000; // the next day
    expect(await store.recordRun(userId, 'storm', 7)).toMatchObject({ storm: { best: 12, today: 7 }, newBest: false });
    expect(await store.recordRun(userId, 'streak', 4)).toMatchObject({ streak: { best: 4, today: 4 }, newBest: true });
    expect(await store.recordRun(userId, 'streak', 0)).toMatchObject({ newBest: false });
  });
});

describe('run API', () => {
  let server: Server;
  let base: string;
  let store: Store;
  let cookie: string;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    const { handler } = createApi(store, { puzzles: new PuzzleCatalogue() });
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await post('/api/signup', { username: 'Racer', password: 'fast-moves' });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  function post(path: string, body: unknown, withCookie = true) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...(withCookie && cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  it('saves plausible runs for signed-in players and shows bests on the profile', async () => {
    expect((await post('/api/puzzles/run', { mode: 'storm', score: 5 }, false)).status).toBe(401);
    expect((await post('/api/puzzles/run', { mode: 'blitz', score: 5 })).status).toBe(400);
    expect((await post('/api/puzzles/run', { mode: 'storm', score: 9999 })).status).toBe(400);
    expect((await post('/api/puzzles/run', { mode: 'streak', score: 500 })).status).toBe(400); // more than there are puzzles
    expect((await post('/api/puzzles/run', { mode: 'storm', score: 2.5 })).status).toBe(400);

    const ok = (await (await post('/api/puzzles/run', { mode: 'storm', score: 21 })).json()) as { storm: { best: number }; newBest: boolean };
    expect(ok).toMatchObject({ storm: { best: 21 }, newBest: true });
    await post('/api/puzzles/run', { mode: 'streak', score: 6 });

    const runs = (await (await fetch(base + '/api/puzzles/runs', { headers: { cookie } })).json()) as { runs: unknown };
    expect(runs.runs).toEqual({ streak: { best: 6, today: 6 }, storm: { best: 21, today: 21 } });
    const profile = (await (await fetch(base + '/api/users/racer')).json()) as { runs: { storm: { best: number } } };
    expect(profile.runs.storm.best).toBe(21);
  });
});

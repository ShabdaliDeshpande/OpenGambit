import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store, type Ratings } from './store.ts';
import { testHub } from './testUtils.ts';
import type { Account } from './types.ts';

describe('account settings API', () => {
  let server: Server;
  let base: string;
  let store: Store;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    const { handler } = createApi(store);
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  const me = async (cookie: string) => ((await (await fetch(base + '/api/me', { headers: { cookie } })).json()) as { user: unknown }).user;

  it('changes the password and signs out other sessions only', async () => {
    const laptop = cookieOf(await post('/api/signup', { username: 'Vera', password: 'first-pass' }));
    const phone = cookieOf(await post('/api/login', { username: 'vera', password: 'first-pass' }));

    expect((await post('/api/account/password', { current: 'first-pass', password: 'second-pass' })).status).toBe(401);
    expect((await post('/api/account/password', { current: 'wrong-pass', password: 'second-pass' }, laptop)).status).toBe(403);
    expect((await post('/api/account/password', { current: 'first-pass', password: 'short' }, laptop)).status).toBe(400);
    expect((await post('/api/account/password', { current: 'first-pass', password: 'first-pass' }, laptop)).status).toBe(400);
    expect((await post('/api/account/password', { current: 'first-pass', password: 'second-pass' }, laptop)).status).toBe(200);

    expect(await me(laptop)).not.toBeNull();
    expect(await me(phone)).toBeNull();
    expect((await post('/api/login', { username: 'vera', password: 'first-pass' })).status).toBe(401);
    expect((await post('/api/login', { username: 'vera', password: 'second-pass' })).status).toBe(200);
  });

  it('deletes an account, keeping games with the name replaced, and frees the username', async () => {
    const cookie = cookieOf(await post('/api/signup', { username: 'Nona', password: 'goodbye-1' }));
    const nona = (await store.userByName('nona'))!;
    const opp = (await store.createUser('Opp', 'h'))!;
    await store.finishGame({
      id: 'g1',
      whiteId: nona.id,
      blackId: opp.id,
      whiteName: 'Nona',
      blackName: 'Opp',
      tc: '5+0',
      category: 'blitz',
      rated: true,
      moves: ['e2e4'],
      result: '0-1',
      reason: 'resign',
      startedAt: 1,
      endedAt: 2,
    });
    await store.recordPuzzle(nona.id, { id: 'p', rating: 1500, themes: [] }, true);

    expect((await post('/api/account/delete', { current: 'goodbye-1', confirm: 'nona' }, cookie)).status).toBe(400);
    expect((await post('/api/account/delete', { current: 'wrong', confirm: 'Nona' }, cookie)).status).toBe(403);
    const res = await post('/api/account/delete', { current: 'goodbye-1', confirm: 'Nona' }, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    expect(await me(cookie)).toBeNull();
    expect(await store.userByName('nona')).toBeUndefined();
    expect(await store.game('g1')).toMatchObject({ whiteId: null, whiteName: '[deleted]', blackName: 'Opp' });
    expect(await store.puzzleAttempts(nona.id)).toEqual([]);
    expect((await post('/api/signup', { username: 'Nona', password: 'hello-again' })).status).toBe(200);
  });

  it('lists only established ratings on the leaderboard, best first', async () => {
    const set = async (name: string, rating: number, deviation: number, games: number, category = 'blitz') => {
      const u = (await store.createUser(name, 'h'))!;
      await store.db.run(
        'INSERT INTO ratings (user_id, category, rating, deviation, volatility, games, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [u.id, category, rating, deviation, 0.06, games, Date.now()],
      );
    };
    await set('Strong', 2100, 60, 30);
    await set('Fine', 1800, 80, 12);
    await set('Fresh', 2400, 250, 3); // provisional
    await set('Once', 2300, 60, 1); // one game only
    await set('Solver', 1900, 70, 40, 'puzzle');
    const board = ((await (await fetch(base + '/api/leaderboard')).json()) as { leaderboard: Record<string, { username: string; rating: number }[]> })
      .leaderboard;
    expect(board.blitz!.map(r => r.username)).toEqual(['Strong', 'Fine']);
    expect(board.puzzle).toEqual([{ username: 'Solver', flair: null, rating: 1900, games: 40 }]);
    expect(board.bullet).toEqual([]);
  });
});

describe('seek rating ranges', () => {
  let store: Store;
  let h: ReturnType<typeof testHub>;
  const accounts: Record<string, Account> = {};

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    h = testHub({}, store);
    for (const [name, rating] of [
      ['Ann', 1500],
      ['Ben', 1800],
      ['Cal', 1600],
    ] as const) {
      const user = (await store.createUser(name, 'h'))!;
      const ratings: Ratings = await store.ratings(user.id);
      ratings.blitz = { glicko: { rating, deviation: 60, volatility: 0.06 }, games: 20, updatedAt: Date.now() };
      accounts[name] = { user, ratings };
    }
  });
  afterEach(async () => {
    h.hub.stop();
    await store.db.close();
  });

  const lobby = (name: string | null) => {
    const c = h.join(null, name ? accounts[name]! : null);
    c.send({ t: 'lobby', on: true });
    return c;
  };

  it('only lets players within the range accept, and never guests', () => {
    const ann = lobby('Ann');
    const ben = lobby('Ben');
    const cal = lobby('Cal');
    const guest = lobby(null);
    ann.send({ t: 'seek', tc: '5+0', color: 'random', rated: false, range: 200 });
    const seek = ben.last('lobby')!.lobby.seeks[0]!;
    expect(seek.range).toBe(200);
    ben.send({ t: 'acceptSeek', id: seek.id });
    guest.send({ t: 'acceptSeek', id: seek.id });
    expect(ben.errors()).toEqual(['Your rating is outside the range this player asked for.']);
    expect(guest.errors()).toEqual(['Your rating is outside the range this player asked for.']);
    cal.send({ t: 'acceptSeek', id: seek.id });
    expect(cal.last('started')).toBeDefined();
  });

  it('auto-pairs only when both ranges allow it, and ignores odd range values', () => {
    const ann = lobby('Ann');
    const ben = lobby('Ben');
    ann.send({ t: 'seek', tc: '3+2', color: 'random', rated: true, range: 100 });
    ben.send({ t: 'seek', tc: '3+2', color: 'random', rated: true }); // Ben accepts anyone, but Ann doesn't accept 1800
    expect(ben.last('started')).toBeUndefined();
    expect(ben.last('lobby')!.lobby.seeks).toHaveLength(2);
    const cal = lobby('Cal');
    cal.send({ t: 'seek', tc: '3+2', color: 'random', rated: true, range: 150 }); // 1600: within Ann's 100 and Ann within 150
    expect(cal.last('started')).toBeDefined();
    cal.send({ t: 'lobby', on: true });
    cal.send({ t: 'seek', tc: '1+0', color: 'random', rated: false, range: 123 });
    expect(cal.last('lobby')!.lobby.seeks.find(s => s.tc === '1+0')!.range).toBeNull();
  });
});

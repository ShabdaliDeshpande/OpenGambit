import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { checkPassword, checkUsername, hashPassword, LoginLimiter, readCookie, sessionCookie, verifyPassword } from './auth.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store } from './store.ts';

describe('passwords and input checks', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('checks usernames and passwords', () => {
    expect(checkUsername('Magnus_C')).toBeNull();
    for (const bad of ['ab', 'a'.repeat(21), '_start', 'has space', 'émile', 42]) expect(checkUsername(bad)).not.toBeNull();
    for (const reserved of ['admin', 'Guest', 'guest-12', 'guest1234']) expect(checkUsername(reserved)).toBe('That username is reserved.');
    expect(checkPassword('short')).not.toBeNull();
    expect(checkPassword('longenough')).toBeNull();
    expect(checkPassword('SameAsName', 'samEASname')).not.toBeNull();
  });

  it('reads and writes the session cookie', () => {
    expect(readCookie('a=1; ocb_session=abc%3D; b=2', 'ocb_session')).toBe('abc=');
    expect(readCookie(undefined, 'ocb_session')).toBeUndefined();
    const c = sessionCookie('tok', true, 60_000);
    expect(c).toBe('ocb_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  });

  it('blocks a key after too many failures until the window passes', () => {
    let now = 0;
    const l = new LoginLimiter(3, 1_000, () => now);
    l.fail('k');
    l.fail('k');
    expect(l.blocked('k')).toBe(false);
    l.fail('k');
    expect(l.blocked('other', 'k')).toBe(true);
    now = 1_001;
    expect(l.blocked('k')).toBe(false);
  });
});

describe('account API', () => {
  let server: Server;
  let base: string;
  let store: Store;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    const { handler } = createApi(store, { maxLoginFailures: 3, maxSignupsPerHour: 3 });
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...headers },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie?: string) => fetch(base + path, cookie ? { headers: { cookie } } : {});
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

  it('signs up, keeps the session in an HttpOnly cookie and signs out', async () => {
    const res = await post('/api/signup', { username: 'Ada', password: 'analytical' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^ocb_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    const body = (await res.json()) as { user: { username: string; ratings: Record<string, { rating: number; provisional: boolean }> } };
    expect(body.user.username).toBe('Ada');
    expect(body.user.ratings.blitz).toEqual({ rating: 1500, provisional: true, deviation: 500, games: 0 });

    const cookie = cookieOf(res);
    expect(((await (await get('/api/me', cookie)).json()) as { user: { username: string } }).user.username).toBe('Ada');
    expect(await (await get('/api/me')).json()).toEqual({ user: null });

    const out = await post('/api/logout', {}, { cookie });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await get('/api/me', cookie)).json()).toEqual({ user: null });
  });

  it('rejects bad sign-ups and taken names', async () => {
    expect((await post('/api/signup', { username: 'x', password: 'whatever1' })).status).toBe(400);
    expect((await post('/api/signup', { username: 'Grace', password: 'short' })).status).toBe(400);
    expect((await post('/api/signup', { username: 'Grace', password: 'compilers' })).status).toBe(200);
    const taken = await post('/api/signup', { username: 'grace', password: 'compilers' });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'That username is taken.' });
  });

  it('logs in, and refuses after repeated wrong passwords', async () => {
    await post('/api/signup', { username: 'Linus', password: 'penguins!' });
    expect((await post('/api/login', { username: 'linus', password: 'penguins!' })).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await post('/api/login', { username: 'Linus', password: 'nope-nope' })).status).toBe(401);
    expect((await post('/api/login', { username: 'Linus', password: 'penguins!' })).status).toBe(429);
    expect((await post('/api/login', { username: 'nobody', password: 'whatever1' })).status).toBe(401);
  });

  it('refuses writes from other sites, without Origin, or not as JSON', async () => {
    expect((await post('/api/signup', { username: 'Eve', password: 'eavesdrop' }, { origin: 'https://evil.example' })).status).toBe(403);
    const noOrigin = await fetch(base + '/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Eve', password: 'eavesdrop' }),
    });
    expect(noOrigin.status).toBe(403);
    const form = await fetch(base + '/api/signup', { method: 'POST', headers: { origin: base, 'content-type': 'text/plain' }, body: 'x' });
    expect(form.status).toBe(415);
    expect((await post('/api/signup', 'x'.repeat(5_000))).status).toBe(413);
  });

  it('limits new accounts per address', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/api/signup', { username: `user${i}`, password: 'password1' })).status).toBe(200);
    expect((await post('/api/signup', { username: 'user9', password: 'password1' })).status).toBe(429);
  });

  it('shows profiles with ratings and game history, and single games with moves', async () => {
    await post('/api/signup', { username: 'Judit', password: 'polgar123' });
    await post('/api/signup', { username: 'Susan', password: 'polgar456' });
    const [j, s] = [(await store.userByName('judit'))!, (await store.userByName('susan'))!];
    await store.finishGame({
      id: 'game1',
      whiteId: j.id,
      blackId: s.id,
      whiteName: 'Judit',
      blackName: 'Susan',
      tc: '5+0',
      category: 'blitz',
      rated: true,
      moves: ['e2e4', 'c7c5'],
      result: '1-0',
      reason: 'resign',
      startedAt: 1,
      endedAt: 2,
    });

    const profile = (await (await get('/api/users/JUDIT')).json()) as {
      user: { username: string };
      ratings: Record<string, { rating: number; games: number }>;
      totalGames: number;
      games: { id: string; white: { diff: number }; moves?: string[] }[];
    };
    expect(profile.user.username).toBe('Judit');
    expect(profile.ratings.blitz!.games).toBe(1);
    expect(profile.ratings.blitz!.rating).toBeGreaterThan(1500);
    expect(profile.totalGames).toBe(1);
    expect(profile.games[0]).toMatchObject({ id: 'game1', white: { name: 'Judit', rating: 1500 }, black: { name: 'Susan' }, plies: 2 });
    expect(profile.games[0]!.moves).toBeUndefined();

    const one = (await (await get('/api/games/game1')).json()) as { game: { moves: string[] } };
    expect(one.game.moves).toEqual(['e2e4', 'c7c5']);
    expect((await get('/api/users/nobody')).status).toBe(404);
    expect((await get('/api/games/missing')).status).toBe(404);
    expect((await get('/api/games/..%2F..')).status).toBe(404);
  });

  it('lists finished tournaments and shows one with its standings', async () => {
    await store.saveTournament({
      id: 'tour1',
      kind: 'arena',
      name: 'Night Arena',
      tc: '3+2',
      rated: true,
      createdBy: null,
      createdByName: 'someone',
      settings: { durationMin: 30 },
      startedAt: 1,
      finishedAt: 2,
      players: 2,
      winnerName: 'Ada',
      standings: [{ rank: 1, name: 'Ada', score: 4 }],
    });
    const list = (await (await get('/api/tournaments')).json()) as { tournaments: { id: string; winnerName: string; standings?: unknown }[] };
    expect(list.tournaments).toMatchObject([{ id: 'tour1', winnerName: 'Ada' }]);
    expect(list.tournaments[0]!.standings).toBeUndefined();
    const one = (await (await get('/api/tournaments/tour1')).json()) as { tournament: { standings: unknown[]; settings: unknown } };
    expect(one.tournament).toMatchObject({ standings: [{ rank: 1, name: 'Ada', score: 4 }], settings: { durationMin: 30 } });
    expect((await get('/api/tournaments/nope')).status).toBe(404);
  });
});

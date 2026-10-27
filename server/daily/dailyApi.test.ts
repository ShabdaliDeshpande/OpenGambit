import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../api.ts';
import { migrate } from '../db/db.ts';
import { openSqlite } from '../db/sqlite.ts';
import { Store } from '../store.ts';

describe('daily chess API', () => {
  let server: Server;
  let base: string;
  let store: Store;
  const cookies: Record<string, string> = {};

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    server = createServer((req, res) => createApi(store).handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const name of ['Ana', 'Ben']) {
      const res = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username: name, password: 'daily-pass1' }) });
      cookies[name] = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    }
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const post = (path: string, body: unknown, who?: string) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(who ? { cookie: cookies[who]! } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, who?: string) => fetch(`${base}${path}`, { headers: who ? { cookie: cookies[who]! } : {} });

  it('needs an account to play, but anyone may browse seeks', async () => {
    expect((await get('/api/daily/games')).status).toBe(401);
    expect((await post('/api/daily/seeks', { days: 3, color: 'w' })).status).toBe(401);
    expect((await get('/api/daily/seeks')).status).toBe(200);
    expect((await get('/api/daily/tours')).status).toBe(200);
    expect((await post('/api/daily/test-clock', { ms: 1 }, 'Ana')).status).toBe(404);
  });

  it('plays a game from a seek, with notifications', async () => {
    const { id: seek } = (await (await post('/api/daily/seeks', { days: 2, color: 'b', rated: true }, 'Ana')).json()) as { id: string };
    expect((await post('/api/daily/seeks', { days: 4, color: 'b' }, 'Ana')).status).toBe(400);
    const { game } = (await (await post(`/api/daily/seeks/${seek}/accept`, {}, 'Ben')).json()) as { game: string };
    const moved = (await (await post(`/api/daily/games/${game}/move`, { uci: 'd2d4', ply: 0 }, 'Ben')).json()) as { game: { moves: string[]; white: { name: string } } };
    expect(moved.game).toMatchObject({ moves: ['d2d4'], white: { name: 'Ben' } });
    const notes = (await (await get('/api/notifications', 'Ana')).json()) as { list: { id: string; kind: string }[]; unseen: number };
    expect(notes.list.map(n => n.kind)).toEqual(['move', 'started']);
    expect(notes.unseen).toBe(2);
    const seen = (await (await post('/api/notifications/seen', { ids: null }, 'Ana')).json()) as { unseen: number };
    expect(seen.unseen).toBe(0);
    expect((await post(`/api/daily/games/${game}/move`, { uci: 'e2e4', ply: 1 }, 'Ana')).status).toBe(400);
  });

  it('sets a flair from the allowed list and shows it on the account', async () => {
    expect((await post('/api/account/flair', { flair: '<script>' }, 'Ana')).status).toBe(400);
    expect((await post('/api/account/flair', { flair: '🦉' }, 'Ana')).status).toBe(200);
    const me = (await (await get('/api/me', 'Ana')).json()) as { user: { flair: string } };
    expect(me.user.flair).toBe('🦉');
    const profile = (await (await get('/api/users/ana')).json()) as { user: { flair: string } };
    expect(profile.user.flair).toBe('🦉');
    await post('/api/account/flair', { flair: null }, 'Ana');
    expect(((await (await get('/api/me', 'Ana')).json()) as { user: { flair: string | null } }).user.flair).toBeNull();
  });

  it('takes vacation days and refuses more than the year allows', async () => {
    const res = (await (await post('/api/account/vacation', { days: 3 }, 'Ana')).json()) as { vacation: { on: boolean; left: number } };
    expect(res.vacation).toMatchObject({ on: true, left: 11 });
    expect((await post('/api/account/vacation', { days: 2 }, 'Ana')).status).toBe(409);
    // ended straight away: the day it started on counts, since days are used whole
    expect(((await (await post('/api/account/vacation', { end: true }, 'Ana')).json()) as { vacation: { left: number } }).vacation.left).toBe(13);
    expect((await post('/api/account/vacation', { days: 15 }, 'Ana')).status).toBe(409);
  });
});

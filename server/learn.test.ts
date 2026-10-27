import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store } from './store.ts';

describe('learning progress on the account', () => {
  let server: Server;
  let base: string;
  let store: Store;
  let cookie = '';

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    server = createServer((req, res) => createApi(store).handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username: 'Lea', password: 'learning1' }) });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const post = (progress: unknown, withCookie = true) =>
    fetch(`${base}/api/learn/progress`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(withCookie ? { cookie } : {}) }, body: JSON.stringify({ progress }) });

  it('saves progress, keeping the better result of each entry', async () => {
    expect(await (await post({ 'lesson:rook-1': 2, 'drill:forks': 50_000 })).json()).toEqual({ progress: { 'lesson:rook-1': 2, 'drill:forks': 50_000 } });
    const merged = (await (await post({ 'lesson:rook-1': 1, 'drill:forks': 41_000, 'endgame:kq-k': 1, 'nonsense': 9 })).json()) as { progress: object };
    expect(merged.progress).toEqual({ 'lesson:rook-1': 2, 'drill:forks': 41_000, 'endgame:kq-k': 1 });
    const read = await (await fetch(`${base}/api/learn/progress`, { headers: { cookie } })).json();
    expect(read).toEqual(merged);
  });

  it('keeps bot results with the rest, a win beating a draw', async () => {
    await post({ 'bot:moss': 1, 'bot:summit': 4 });
    const after = (await (await post({ 'bot:moss': 2 })).json()) as { progress: object };
    expect(after.progress).toEqual({ 'bot:moss': 2 });
    expect((await (await post({ 'bot:moss': 1 })).json()) as object).toEqual({ progress: { 'bot:moss': 2 } });
  });

  it('needs an account, and a sensible request', async () => {
    expect((await post({ 'lesson:rook-1': 3 }, false)).status).toBe(401);
    expect((await fetch(`${base}/api/learn/progress`)).status).toBe(401);
    expect((await post([1, 2])).status).toBe(400);
    expect((await post(Object.fromEntries(Array.from({ length: 501 }, (_v, i) => [`lesson:l${i}`, 1])))).status).toBe(400);
  });

  it('goes with the account when it is deleted', async () => {
    await post({ 'lesson:rook-1': 3 });
    const user = (await store.userByName('lea'))!;
    await store.deleteUser(user.id);
    expect(await store.learnProgress(user.id)).toEqual({});
  });
});

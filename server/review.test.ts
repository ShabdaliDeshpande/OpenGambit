import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store } from './store.ts';
import { REVIEW_VERSION, type StoredReview } from '../src/analysis/reviewData.ts';

// 1. e4 d5 2. Qg4?? Bxg4
const MOVES = ['e2e4', 'd7d5', 'd1g4', 'c8g4'];

const review = (ms = 600, scores = ['c:20', 'c:30', 'c:10', 'c:-900', 'c:-900']): StoredReview => ({
  v: REVIEW_VERSION,
  engine: 'test-engine',
  ms,
  positions: scores.map((s, i) => ({ s, ...(i < 4 ? { b: MOVES[i]!, pv: MOVES.slice(i).join(' ') } : {}) })),
  kinds: 'SSUS',
});

describe('saved game reviews', () => {
  let server: Server;
  let base: string;
  let store: Store;
  const cookies: Record<string, string> = {};

  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const get = async <T>(path: string) => (await (await fetch(base + path)).json()) as T;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    const { handler } = createApi(store, { maxReviewWrites: 4 });
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const name of ['Vera', 'Nona', 'Maia']) {
      const res = await post('/api/signup', { username: name, password: 'menchik1906' });
      cookies[name] = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    }
    const [v, n] = [(await store.userByName('vera'))!, (await store.userByName('nona'))!];
    await store.finishGame({
      id: 'g1',
      whiteId: v.id,
      blackId: n.id,
      whiteName: 'Vera',
      blackName: 'Nona',
      tc: '5+0',
      category: 'blitz',
      rated: true,
      moves: MOVES,
      result: '0-1',
      reason: 'resign',
      startedAt: 1,
      endedAt: 2,
    });
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  it('saves a player’s review and shows its accuracy in the game history', async () => {
    const res = await post('/api/games/g1/review', { review: review() }, cookies.Vera);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; accuracy: { white: number; black: number } };
    expect(body.saved).toBe(true);
    // worked out on the server from the scores: White blundered the queen
    expect(body.accuracy.white).toBeLessThan(body.accuracy.black);

    const saved = await get<{ review: StoredReview }>('/api/games/g1/review');
    expect(saved.review).toEqual(review());
    const profile = await get<{ games: { id: string; review: { white: number; black: number } | null }[] }>('/api/users/vera');
    expect(profile.games[0]!.review).toEqual(body.accuracy);
  });

  it('shows no review until one is saved', async () => {
    expect(await get('/api/games/g1/review')).toEqual({ review: null });
    const profile = await get<{ games: { review: unknown }[] }>('/api/users/nona');
    expect(profile.games[0]!.review).toBeNull();
    expect((await fetch(`${base}/api/games/nope/review`)).status).toBe(404);
  });

  it('only accepts reviews from the players, signed in', async () => {
    expect((await post('/api/games/g1/review', { review: review() })).status).toBe(401);
    expect((await post('/api/games/g1/review', { review: review() }, cookies.Maia)).status).toBe(403);
    expect((await post('/api/games/zz/review', { review: review() }, cookies.Vera)).status).toBe(404);
    expect((await post('/api/games/g1/review', { review: review() }, cookies.Nona)).status).toBe(200);
  });

  it('refuses a review that doesn’t match the game', async () => {
    const short = { ...review(), positions: review().positions.slice(0, 4) };
    const res = await post('/api/games/g1/review', { review: short }, cookies.Vera);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The review must cover every position of the game.' });
    expect((await post('/api/games/g1/review', { review: { ...review(), kinds: 'SSU' } }, cookies.Vera)).status).toBe(400);
  });

  it('keeps the deeper of two reviews', async () => {
    await post('/api/games/g1/review', { review: review(1200) }, cookies.Vera);
    const shallow = (await (await post('/api/games/g1/review', { review: review(300, ['c:0', 'c:0', 'c:0', 'c:0', 'c:0']) }, cookies.Nona)).json()) as {
      saved: boolean;
    };
    expect(shallow.saved).toBe(false);
    expect((await get<{ review: StoredReview }>('/api/games/g1/review')).review.ms).toBe(1200);
    const deeper = (await (await post('/api/games/g1/review', { review: review(2400) }, cookies.Nona)).json()) as { saved: boolean };
    expect(deeper.saved).toBe(true);
  });

  it('limits how often a player saves reviews', async () => {
    for (let i = 0; i < 4; i++) expect((await post('/api/games/g1/review', { review: review() }, cookies.Vera)).status).toBe(200);
    expect((await post('/api/games/g1/review', { review: review() }, cookies.Vera)).status).toBe(429);
  });

  it('keeps reviews when the player who saved one deletes their account', async () => {
    await post('/api/games/g1/review', { review: review() }, cookies.Vera);
    await store.deleteUser((await store.userByName('vera'))!.id);
    expect((await store.review('g1'))?.reviewedBy).toBeNull();
  });
});

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisQueue, workerAnalyser, type Analyser, type RawPosition } from './analysisQueue.ts';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store } from './store.ts';

// 1. e4 d5 2. Qg4?? Bxg4
const MOVES = ['e2e4', 'd7d5', 'd1g4', 'c8g4'];

/** A pretend engine: fixed scores, with the queen blunder at ply 3. */
const fakeAnalyser =
  (gate?: Promise<void>): Analyser =>
  async (req, onProgress) => {
    await gate;
    const cps = [20, 30, 10, -900, -900];
    const out: RawPosition[] = req.moves.concat('').map((_m, i) => ({
      first: { cp: cps[i] ?? 0, mate: null, pv: i < req.moves.length ? [{ from: req.moves[i]!.slice(0, 2), to: req.moves[i]!.slice(2, 4) } as never] : [] },
      second: null,
    }));
    onProgress(out.length, out.length);
    return out;
  };

describe('server analysis queue', () => {
  let server: Server;
  let base: string;
  let store: Store;
  let queue: AnalysisQueue;
  let release: () => void;
  const cookies: Record<string, string> = {};

  const post = (path: string, cookie?: string) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: '{}' });
  const get = async <T>(path: string) => (await (await fetch(base + path)).json()) as T;

  const addGame = async (id: string, whiteId: string, blackId: string) =>
    store.finishGame({ id, whiteId, blackId, whiteName: 'W', blackName: 'B', tc: '5+0', category: 'blitz', rated: false, moves: MOVES, result: '0-1', reason: 'resign', startedAt: 1, endedAt: 2 });

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    const gate = new Promise<void>(resolve => (release = resolve));
    queue = new AnalysisQueue(store, fakeAnalyser(gate), { maxQueue: 2 });
    const { handler } = createApi(store, { analysis: queue });
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const name of ['Alla', 'Bea', 'Cleo']) {
      const res = await fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ username: name, password: 'kushnir1970' }),
      });
      cookies[name] = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    }
    const [a, b] = [(await store.userByName('alla'))!, (await store.userByName('bea'))!];
    for (const id of ['g1', 'g2', 'g3', 'g4']) await addGame(id, a.id, b.id);
  });

  afterEach(async () => {
    release();
    await queue.idle();
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  it('queues a player’s game, analyses it and saves the review', async () => {
    expect(await get('/api/games/g1/analysis')).toEqual({ enabled: true, status: 'none' });
    const placed = (await (await post('/api/games/g1/analysis', cookies.Alla)).json()) as { status: string };
    expect(placed.status).toBe('running');
    expect((await (await post('/api/games/g2/analysis', cookies.Bea)).json()) as object).toEqual({ status: 'queued', position: 1 });
    // asking again doesn't queue it twice
    expect((await (await post('/api/games/g2/analysis', cookies.Alla)).json()) as object).toEqual({ status: 'queued', position: 1 });
    release();
    await queue.idle();
    expect(await get('/api/games/g1/analysis')).toEqual({ enabled: true, status: 'done' });
    const saved = await store.review('g1');
    expect(saved?.review.kinds).toBe('SSUS');
    expect(saved?.review.engine).toMatch(/server/);
    expect(saved!.whiteAccuracy!).toBeLessThan(saved!.blackAccuracy!);
  });

  it('turns away guests, other players and a full queue', async () => {
    expect((await post('/api/games/g1/analysis')).status).toBe(401);
    expect((await post('/api/games/g1/analysis', cookies.Cleo)).status).toBe(403);
    expect((await post('/api/games/zz/analysis', cookies.Alla)).status).toBe(404);
    for (const id of ['g1', 'g2', 'g3']) expect((await post(`/api/games/${id}/analysis`, cookies.Alla)).status).toBe(200);
    // one running and two waiting fills a queue of 2
    expect((await post('/api/games/g4/analysis', cookies.Alla)).status).toBe(503);
  });

  it('says when the server has no analysis queue', async () => {
    const plain = createServer((req, res) => createApi(store).handler(req, res));
    await new Promise<void>(resolve => plain.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    expect(await (await fetch(`${url}/api/games/g1/analysis`)).json()).toEqual({ enabled: false, status: 'none' });
    const res = await fetch(`${url}/api/games/g1/analysis`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, cookie: cookies.Alla! }, body: '{}' });
    expect(res.status).toBe(503);
    await new Promise(resolve => plain.close(resolve));
  });
});

describe('the analysis worker thread', () => {
  it('runs the real engine over every position', async () => {
    const seen: number[] = [];
    const positions = await workerAnalyser({ moves: ['e2e4', 'e7e5'], ms: 60 }, done => seen.push(done));
    expect(positions).toHaveLength(3);
    expect(seen.at(-1)).toBe(3);
    expect(positions[0]!.first?.pv?.length).toBeGreaterThan(0);
    expect(typeof positions[0]!.first?.cp).toBe('number');
  }, 30_000);
});

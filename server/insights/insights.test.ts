import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REVIEW_VERSION, type StoredReview } from '../../src/analysis/reviewData.ts';
import { createApi } from '../api.ts';
import { migrate } from '../db/db.ts';
import { openSqlite } from '../db/sqlite.ts';
import { importOpenings } from '../explorer/importer.ts';
import { Store } from '../store.ts';
import { buildInsights, hourIn, opponentBand, validTimeZone, type InsightGame } from './insights.ts';
import { loadInsightGames } from './insightsData.ts';

const ME = 'me';
const DAY = 86_400_000;

const game = (over: Partial<InsightGame>): InsightGame => ({
  id: 'g',
  whiteId: ME,
  blackId: 'them',
  category: 'blitz',
  tc: '3+2',
  rated: true,
  moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
  clocks: null,
  result: '1-0',
  whiteRating: 1500,
  blackRating: 1600,
  whiteDiff: 10,
  blackDiff: -10,
  endedAt: Date.UTC(2026, 9, 1, 13, 0),
  ...over,
});

// 1. e4 d5 2. Qg4?? Bxg4: White blunders the queen
const blunderReview: StoredReview = {
  v: REVIEW_VERSION,
  engine: 't',
  ms: 600,
  positions: ['c:20', 'c:30', 'c:10', 'c:-900', 'c:-900'].map(s => ({ s })),
  kinds: 'SSUS',
};

describe('insights', () => {
  it('splits results by colour, speed, time control, time of day and opponent', () => {
    const games = [
      game({ id: 'a' }),
      game({ id: 'b', whiteId: 'them', blackId: ME, result: '1-0', category: 'rapid', tc: '10+0', endedAt: Date.UTC(2026, 9, 2, 22, 0) }),
      game({ id: 'c', result: '1/2-1/2', blackRating: 1250 }),
      game({ id: 'x', whiteId: 'other', blackId: 'someone' }), // not mine
    ];
    const ins = buildInsights(ME, games, 'UTC');
    expect(ins.games).toBe(3);
    expect(ins.results.byColor).toEqual([
      { label: 'White', win: 1, draw: 1, loss: 0 },
      { label: 'Black', win: 0, draw: 0, loss: 1 },
    ]);
    expect(ins.results.bySpeed[0]).toEqual({ label: 'blitz', win: 1, draw: 1, loss: 0 });
    expect(ins.results.byTimeControl.map(b => b.label)).toEqual(['3+2', '10+0']);
    expect(ins.results.byTimeOfDay.find(b => b.label === '12–16')).toMatchObject({ win: 1, draw: 1 });
    expect(ins.results.byTimeOfDay.find(b => b.label === '20–24')).toMatchObject({ loss: 1 });
    expect(ins.results.byOpponent.find(b => b.label === '100–200 higher')).toMatchObject({ win: 1 }); // exactly +100
    expect(ins.results.byOpponent.find(b => b.label === '200+ lower')).toMatchObject({ draw: 1 });
  });

  it('draws the rating history from rated games', () => {
    const ins = buildInsights(ME, [game({ id: 'a', endedAt: 2 * DAY }), game({ id: 'b', endedAt: DAY, whiteRating: 1480, whiteDiff: 20 }), game({ id: 'c', rated: false })]);
    expect(ins.rating.blitz).toEqual([
      { t: DAY, rating: 1500 },
      { t: 2 * DAY, rating: 1510 },
    ]);
  });

  it('names openings when it can, and uses the first moves otherwise', () => {
    const ins = buildInsights(ME, [game({ id: 'a', opening: { eco: 'C44', name: 'King’s Knight Opening' } }), game({ id: 'b' }), game({ id: 'c' })]);
    expect(ins.openings.map(o => o.label)).toEqual(['1. e4 e5', 'C44 King’s Knight Opening']);
  });

  it('averages accuracy, phases and errors over reviewed games only', () => {
    const moves = ['e2e4', 'd7d5', 'd1g4', 'c8g4'];
    const ins = buildInsights(ME, [game({ id: 'a', moves, review: blunderReview }), game({ id: 'b' })]);
    expect(ins.accuracy.reviewed).toBe(1);
    expect(ins.accuracy.overTime).toHaveLength(1);
    expect(ins.accuracy.average!).toBeLessThan(80);
    expect(ins.accuracy.blunders).toBe(1);
    expect(ins.accuracy.mistakes).toBe(0);
    expect(ins.accuracy.byPhase.opening).not.toBeNull();
    expect(ins.accuracy.byPhase.endgame).toBeNull();
    // seen from Black's side the same game has no errors
    const black = buildInsights(ME, [game({ id: 'a', whiteId: 'them', blackId: ME, moves, review: blunderReview })]);
    expect(black.accuracy.blunders).toBe(0);
    expect(black.accuracy.average!).toBeGreaterThan(ins.accuracy.average!);
  });

  it('works out time per move and time trouble from the clocks', () => {
    // 3+2: each side starts with 180 s; White uses 10 s and 25 s on its timed moves and falls to 12 s
    const clocks = [180_000, 180_000, 172_000, 175_000, 12_000, 170_000];
    const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'];
    const ins = buildInsights(ME, [game({ id: 'a', moves, clocks, result: '0-1' }), game({ id: 'b' })]);
    expect(ins.time.games).toBe(1);
    // White's 2nd move: 180 + 2 − 172 = 10 s; 3rd: 172 + 2 − 12 = 162 s → 86 s a move
    expect(ins.time.perMove).toEqual([{ label: 'blitz', seconds: 86, games: 1 }]);
    expect(ins.time.trouble).toMatchObject({ games: 1, loss: 1, share: 100 });
  });

  it('knows time zones and rating bands', () => {
    expect(hourIn(Date.UTC(2026, 0, 1, 23, 30), 'UTC')).toBe(23);
    expect(hourIn(Date.UTC(2026, 0, 1, 23, 30), 'Asia/Kolkata')).toBe(5);
    expect(validTimeZone('Europe/Paris')).toBe(true);
    expect(validTimeZone('Mars/Olympus')).toBe(false);
    expect(opponentBand(-250)).toBe('200+ lower');
    expect(opponentBand(0)).toBe('within 100 higher');
    expect(opponentBand(450)).toBe('200+ higher');
  });
});

describe('insights from the database', () => {
  let store: Store;
  let server: Server;
  let base: string;
  const cookies: Record<string, string> = {};

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    server = createServer((req, res) => createApi(store).handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const name of ['Ida', 'Jan']) {
      const res = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username: name, password: 'insight99' }) });
      cookies[name] = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    }
    const [ida, jan] = [(await store.userByName('ida'))!, (await store.userByName('jan'))!];
    await store.finishGame({
      id: 'g1',
      whiteId: ida.id,
      blackId: jan.id,
      whiteName: 'Ida',
      blackName: 'Jan',
      tc: '3+2',
      category: 'blitz',
      rated: true,
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      clocks: [180_000, 180_000, 175_000, 170_000],
      result: '1-0',
      reason: 'resign',
      startedAt: 1,
      endedAt: Date.UTC(2026, 9, 1),
    });
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const get = (path: string, who?: string) => fetch(base + path, who ? { headers: { cookie: cookies[who]! } } : {});

  it('saves clocks with games and names openings from the imported list', async () => {
    await importOpenings(store.db, [{ eco: 'C44', name: 'King’s Knight Opening', pgn: '1. e4 e5 2. Nf3 Nc6' }]);
    const [g] = await loadInsightGames(store.db, (await store.userByName('ida'))!.id);
    expect(g!.clocks).toEqual([180_000, 180_000, 175_000, 170_000]);
    expect(g!.opening).toEqual({ eco: 'C44', name: 'King’s Knight Opening' });
  });

  it('shows insights to the player, and to others only when made public', async () => {
    const own = (await (await get('/api/insights/ida?tz=Europe/Paris', 'Ida')).json()) as { insights: { games: number } };
    expect(own.insights.games).toBe(1);
    expect((await get('/api/insights/ida', 'Jan')).status).toBe(403);
    expect((await get('/api/insights/ida')).status).toBe(403);
    expect((await get('/api/insights/nobody')).status).toBe(404);

    const set = await fetch(`${base}/api/account/insights`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: cookies.Ida! }, body: JSON.stringify({ public: true }) });
    expect(await set.json()).toEqual({ insightsPublic: true });
    expect((await get('/api/insights/ida')).status).toBe(200);
    const me = (await (await get('/api/me', 'Ida')).json()) as { user: { insightsPublic: boolean } };
    expect(me.user.insightsPublic).toBe(true);
  });

  it('filters by speed and date, and refreshes after a new game', async () => {
    const blitz = (await (await get('/api/insights/ida?speed=blitz', 'Ida')).json()) as { insights: { games: number } };
    expect(blitz.insights.games).toBe(1);
    const rapid = (await (await get('/api/insights/ida?speed=rapid', 'Ida')).json()) as { insights: { games: number } };
    expect(rapid.insights.games).toBe(0);
    const later = (await (await get(`/api/insights/ida?since=${Date.UTC(2026, 9, 2)}`, 'Ida')).json()) as { insights: { games: number } };
    expect(later.insights.games).toBe(0);

    const ida = (await store.userByName('ida'))!;
    await store.finishGame({ id: 'g2', whiteId: null, blackId: ida.id, whiteName: 'Guest', blackName: 'Ida', tc: '3+2', category: 'blitz', rated: false, moves: ['d2d4'], result: '0-1', reason: 'resign', startedAt: 1, endedAt: Date.UTC(2026, 9, 3) });
    const again = (await (await get('/api/insights/ida', 'Ida')).json()) as { insights: { games: number } };
    expect(again.insights.games).toBe(2);
  });
});

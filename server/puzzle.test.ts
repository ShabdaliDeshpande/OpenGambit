import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_PUZZLES } from '../src/puzzles/builtin.ts';
import type { Puzzle } from '../src/puzzles/types.ts';
import { createApi } from './api.ts';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { buildDashboard } from './puzzleDashboard.ts';
import { PuzzleCatalogue, solves, themeWeight } from './puzzles.ts';
import { DEFAULT_GLICKO } from './rating/glicko2.ts';
import { Store, type PuzzleAttempt } from './store.ts';

const mateIn2 = BUILTIN_PUZZLES.find(p => p.id === 'b017')!; // Qb8+ Rxb8 Rxb8#
const mateIn1 = BUILTIN_PUZZLES.find(p => p.id === 'b001')!; // Rd8#

describe('checking a solve', () => {
  it('accepts the stored line, and any mate on the last move', () => {
    expect(solves(mateIn2, mateIn2.solution)).toBe(true);
    expect(solves(mateIn1, mateIn1.solution)).toBe(true);
    // a different final mate also counts
    const altMate: Puzzle = { ...mateIn1, fen: '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1', solution: [{ from: 'd1', to: 'd8' }] };
    expect(solves(altMate, [{ from: 'a1', to: 'a8' }])).toBe(true);
  });

  it('rejects wrong, short, long or illegal lines', () => {
    expect(solves(mateIn2, [{ from: 'b1', to: 'c1' }, ...mateIn2.solution.slice(1)])).toBe(false);
    expect(solves(mateIn2, mateIn2.solution.slice(0, 1))).toBe(false);
    expect(solves(mateIn1, [...mateIn1.solution, { from: 'g8', to: 'h8' }])).toBe(false);
    expect(solves(mateIn1, [{ from: 'e1', to: 'e8' }])).toBe(false);
  });
});

describe('theme weighting', () => {
  it('counts a themed solve for less, mates least', () => {
    expect(themeWeight(null, true)).toBe(1);
    expect(themeWeight('mateIn2', true)).toBe(0.1);
    expect(themeWeight('mateIn2', false)).toBe(0.4);
    expect(themeWeight('fork', true)).toBe(0.2);
    expect(themeWeight('endgame', false)).toBe(0.8);
  });

  it('scales the rating change in the store', async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    const store = new Store(db);
    const [a, b] = [(await store.createUser('full', 'h'))!.id, (await store.createUser('weighted', 'h'))!.id];
    const full = await store.recordPuzzle(a, { id: 'p', rating: 1500, themes: ['mateIn2'] }, true);
    const weighted = await store.recordPuzzle(b, { id: 'p', rating: 1500, themes: ['mateIn2'] }, true, 0.1);
    expect(weighted.diff).toBe(Math.round((full.diff ?? 0) * 0.1));
    await db.close();
  });
});

describe('daily puzzle', () => {
  it('is the same all day and changes every day, cycling through the whole set', () => {
    const cat = new PuzzleCatalogue();
    const day = 20_000 * 86_400_000;
    expect(cat.daily(day).id).toBe(cat.daily(day + 86_399_999).id);
    expect(cat.daily(day).id).not.toBe(cat.daily(day + 86_400_000).id);
    const seen = new Set(Array.from({ length: BUILTIN_PUZZLES.length }, (_, i) => cat.daily(day + i * 86_400_000).id));
    expect(seen.size).toBe(BUILTIN_PUZZLES.length);
  });
});

describe('puzzle rating', () => {
  let store: Store;
  let userId: string;
  let now = 1_000_000;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db, () => now);
    userId = (await store.createUser('solver', 'h'))!.id;
  });
  afterEach(() => store.db.close());

  it('rates only the first attempt at a puzzle', async () => {
    const first = await store.recordPuzzle(userId, { id: 'p1', rating: 1900, themes: ['fork'] }, true);
    expect(first.first).toBe(true);
    expect(first.diff).toBeGreaterThan(200); // a new player beating a 1900 puzzle
    now += 1000;
    const again = await store.recordPuzzle(userId, { id: 'p1', rating: 1900, themes: ['fork'] }, false);
    expect(again).toMatchObject({ first: false, diff: null });
    expect(Math.round(again.rating.rating)).toBe(Math.round(first.rating.rating));
    const miss = await store.recordPuzzle(userId, { id: 'p2', rating: 1000, themes: ['mateIn1'] }, false);
    expect(miss.diff).toBeLessThan(0);
    expect((await store.puzzleRating(userId)).games).toBe(2);
    // puzzle rating is separate from game ratings
    expect((await store.ratings(userId)).blitz.games).toBe(0);
    const list = await store.puzzleAttempts(userId);
    expect(list.map(a => [a.puzzleId, a.first, a.win])).toEqual([
      ['p2', true, false],
      ['p1', false, false],
      ['p1', true, true],
    ]);
  });
});

describe('puzzle dashboard', () => {
  const attempt = (id: string, win: boolean, themes: string[], rating = 1500, first = true, at = 0): PuzzleAttempt => ({
    puzzleId: id,
    first,
    win,
    puzzleRating: rating,
    themes,
    ratingAfter: first ? 1500 : null,
    ratingDiff: first ? 0 : null,
    createdAt: at,
  });

  it('finds strengths and areas to improve the way the rules describe', () => {
    const list: PuzzleAttempt[] = [];
    for (let i = 0; i < 4; i++) list.push(attempt(`f${i}`, true, ['fork']));
    for (let i = 0; i < 4; i++) list.push(attempt(`m${i}`, false, ['mateIn2']));
    list.push(attempt('x', true, ['endgame']));
    list.push(attempt('f0', false, ['fork'], 1500, false)); // a replay: not counted
    const d = buildDashboard(list, DEFAULT_GLICKO);
    expect(d).toMatchObject({ played: 9, firstWins: 5, successRate: 56, streak: 4 });
    expect(d.strengths.map(t => t.theme)).toEqual(['fork']);
    expect(d.improvements.map(t => t.theme)).toEqual(['mateIn2']);
    expect(d.themes.find(t => t.theme === 'fork')).toMatchObject({ played: 4, firstWins: 4, performance: 2000 });
    expect(d.history).toHaveLength(10);
  });
});

describe('puzzle API', () => {
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
    const res = await post('/api/signup', { username: 'Tal', password: 'sacrifice!' });
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

  it('rates a real solve, refuses fake ones, and counts repeats as practice', async () => {
    expect((await post('/api/puzzles/attempt', { id: mateIn2.id, win: false }, false)).status).toBe(401);
    expect((await post('/api/puzzles/attempt', { id: 'nope', win: true, moves: [] })).status).toBe(404);
    expect((await post('/api/puzzles/attempt', { id: mateIn2.id, win: true })).status).toBe(400);
    expect((await post('/api/puzzles/attempt', { id: mateIn2.id, win: true, moves: mateIn2.solution.slice(0, 1) })).status).toBe(400);

    const ok = await post('/api/puzzles/attempt', { id: mateIn2.id, win: true, moves: mateIn2.solution });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { first: boolean; diff: number; rating: { rating: number; provisional: boolean } };
    expect(body.first).toBe(true);
    expect(body.rating.rating).toBe(1500 + body.diff);
    expect(body.diff).toBeGreaterThan(0);

    const repeat = (await (await post('/api/puzzles/attempt', { id: mateIn2.id, win: true, moves: mateIn2.solution })).json()) as { first: boolean; diff: null };
    expect(repeat).toMatchObject({ first: false, diff: null });

    const me = (await (await fetch(base + '/api/me', { headers: { cookie } })).json()) as { user: { puzzleRating: { rating: number } } };
    expect(me.user.puzzleRating.rating).toBe(body.rating.rating);
    const profile = (await (await fetch(base + '/api/users/tal')).json()) as { puzzleRating: { rating: number } };
    expect(profile.puzzleRating.rating).toBe(body.rating.rating);

    const dash = (await (await fetch(base + '/api/puzzles/dashboard', { headers: { cookie } })).json()) as {
      dashboard: { played: number; firstWins: number; history: unknown[]; chart: unknown[] };
    };
    expect(dash.dashboard).toMatchObject({ played: 1, firstWins: 1 });
    expect(dash.dashboard.history).toHaveLength(2);
    expect(dash.dashboard.chart).toHaveLength(1);
    expect((await fetch(base + '/api/puzzles/dashboard')).status).toBe(401);
  });

  it('serves the daily puzzle and remembers that you solved it', async () => {
    const daily = (await (await fetch(base + '/api/puzzles/daily', { headers: { cookie } })).json()) as { id: string; date: string; solved: boolean };
    expect(daily.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daily.solved).toBe(false);
    const puzzle = BUILTIN_PUZZLES.find(p => p.id === daily.id)!;
    await post('/api/puzzles/attempt', { id: puzzle.id, win: true, moves: puzzle.solution });
    const after = (await (await fetch(base + '/api/puzzles/daily', { headers: { cookie } })).json()) as { solved: boolean };
    expect(after.solved).toBe(true);
    // guests get the same puzzle
    const guest = (await (await fetch(base + '/api/puzzles/daily')).json()) as { id: string; solved: boolean };
    expect(guest).toEqual({ id: daily.id, date: daily.date, solved: false });
  });
});

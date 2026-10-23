import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Board } from '../../src/engine/board.ts';
import { positionKey } from '../../src/explorer/key.ts';
import { createApi } from '../api.ts';
import { migrate } from '../db/db.ts';
import { openSqlite } from '../db/sqlite.ts';
import { Store, type GameRecord } from '../store.ts';
import { Explorer } from './explorerStore.ts';
import { importGames, importOpenings, parseOpeningsTsv, skipReason } from './importer.ts';
import { mainlineSans, playSan, readPgnGames } from './pgnGames.ts';

const START = new Chess().fen();
const after = (...sans: string[]) => {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
};

const PGN = `[Event "Club match"]
[White "Ann"]
[Black "Bo"]
[WhiteElo "2300"]
[BlackElo "2200"]
[Result "1-0"]

1. e4 {best by test} e5 2. Nf3 (2. f4 exf4) Nc6 3. Bb5 $1 a6 4. Ba4 Nf6 5. O-O Be7 1-0

[Event "Club match"]
[WhiteElo "2400"]
[BlackElo "2400"]
[Result "1/2-1/2"]

1. e4 c5 2. Nf3 d6 1/2-1/2

[Event "Simul"]
[WhiteElo "1500"]
[BlackElo "2500"]
[Result "0-1"]

1. e4 e5 0-1

[Event "Set up"]
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]
[Result "1-0"]

1. O-O 1-0
`;

describe('reading PGN for the explorer', () => {
  it('keeps only the main line, without comments, variations or glyphs', () => {
    expect(mainlineSans('1. e4 {a comment} e5 2. Nf3 (2. f4 exf4 (2... d5)) Nc6!? 3. Bb5 $1 a6 ; rest\n4. Ba4 1-0')).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
    expect(mainlineSans('1.e4 e5 2.Nf3', 2)).toEqual(['e4', 'e5']);
  });

  it('splits a file into games with their headers', async () => {
    const games = [];
    for await (const g of readPgnGames(PGN.split('\n'))) games.push(g);
    expect(games).toHaveLength(4);
    expect(games[0]!.headers).toMatchObject({ White: 'Ann', WhiteElo: '2300', Result: '1-0' });
    expect(games[0]!.moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']);
    expect(games[1]!.moves).toEqual(['e4', 'c5', 'Nf3', 'd6']);
  });

  it('replays SAN quickly on the engine board, matching chess.js', () => {
    const b = Board.fromFen(START);
    const ucis = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Bc5'].map(s => playSan(b, s));
    expect(ucis).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1', 'f8c5']);
    expect(positionKey(b.toFen())).toBe(positionKey(after('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Bc5')));
    // disambiguation, promotion, checks and nonsense
    const r = Board.fromFen('4k3/P7/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(playSan(r, 'Rad1')).toBe('a1d1');
    expect(playSan(r, 'Kd8')).toBeNull(); // the rook on d1 covers d8
    expect(playSan(r, 'Kf8')).toBe('e8f8');
    expect(playSan(r, 'a8=Q+')).toBe('a7a8q');
    expect(playSan(Board.fromFen(START), 'Nf6')).toBeNull();
    expect(playSan(Board.fromFen(START), 'xyz')).toBeNull();
  });

  it('leaves out games it cannot use', () => {
    expect(skipReason({ headers: { Result: '*' }, moves: ['e4'] }, 0)).toBe('no result');
    expect(skipReason({ headers: { Result: '1-0', WhiteElo: '1500', BlackElo: '2500' }, moves: ['e4'] }, 2000)).toBe('rating too low');
    expect(skipReason({ headers: { Result: '1-0', FEN: 'x' }, moves: ['e4'] }, 0)).toBe('not from the standard start');
    expect(skipReason({ headers: { Result: '1-0' }, moves: ['e4'] }, 0)).toBeNull();
  });
});

describe('explorer data', () => {
  let store: Store;
  let explorer: Explorer;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    explorer = new Explorer(db);
  });
  afterEach(() => store.db.close());

  const games = async () => {
    const out = [];
    for await (const g of readPgnGames(PGN.split('\n'))) out.push(g);
    return out;
  };

  it('imports master games with results and average ratings', async () => {
    expect(await explorer.has('masters')).toBe(false);
    const stats = await importGames(store.db, await games(), { minRating: 2000, batch: 3 });
    expect(stats).toEqual({ games: 2, skipped: 2 });
    const first = await explorer.moves('masters', START);
    expect(first).toEqual([{ uci: 'e2e4', san: 'e4', white: 1, draws: 1, black: 0, averageRating: 2325 }]);
    const replies = await explorer.moves('masters', after('e4'));
    expect(replies.map(m => m.san).sort()).toEqual(['c5', 'e5']);
    expect(await explorer.has('masters')).toBe(true);
    // importing again adds up
    await importGames(store.db, await games(), { minRating: 2000 });
    expect((await explorer.moves('masters', START))[0]).toMatchObject({ white: 2, draws: 2 });
  });

  it('marks master moves played in more than one game as book', async () => {
    await importGames(store.db, await games(), { minRating: 2000 });
    // 1. e4 is in both games; 1… e5 and 2. Nf3 in only one so far
    expect(await explorer.bookFlags(['e2e4', 'e7e5', 'g1f3'])).toEqual([true, false, false]);
    await importGames(store.db, await games(), { minRating: 2000 });
    expect(await explorer.bookFlags(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'h2h4'])).toEqual([true, true, true, true, false]);
  });

  it('names the deepest named position along the moves', async () => {
    const rows = parseOpeningsTsv('eco\tname\tpgn\nC20\tKing\x27s Pawn Game\t1. e4 e5\nC44\tKing\x27s Knight Opening\t1. e4 e5 2. Nf3 Nc6\nC20\tDuplicate\t1.e4 e5\nX00\tBroken\t1. e5\n');
    expect(await importOpenings(store.db, rows)).toEqual({ added: 2, skipped: 2 });
    expect(await explorer.opening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toEqual({ eco: 'C44', name: 'King\x27s Knight Opening', ply: 4 });
    expect(await explorer.opening(['e2e4', 'e7e5', 'g1f3'])).toMatchObject({ eco: 'C20' });
    expect(await explorer.opening(['d2d4'])).toBeNull();
    expect(() => parseOpeningsTsv('a\tb\n1\t2')).toThrow(/eco, name and pgn/);
  });

  const record = (over: Partial<GameRecord>): GameRecord => ({
    id: 'g',
    whiteId: null,
    blackId: null,
    whiteName: 'W',
    blackName: 'B',
    tc: '5+0',
    category: 'blitz',
    rated: false,
    moves: ['e2e4', 'e7e5', 'g1f3'],
    result: '1-0',
    reason: 'resign',
    startedAt: 1,
    endedAt: Date.UTC(2026, 9, 1),
    ...over,
  });

  it('adds finished games to the OpenGambit tab and to each player’s own games', async () => {
    const ann = (await store.createUser('Ann', 'hash'))!;
    await store.finishGame(record({ id: 'g1', whiteId: ann.id }));
    await store.finishGame(record({ id: 'g2', blackId: ann.id, result: '0-1', category: 'rapid', endedAt: Date.UTC(2026, 10, 5) }));
    expect(await explorer.moves('site', START)).toEqual([{ uci: 'e2e4', san: 'e4', white: 1, draws: 0, black: 1, averageRating: null }]);
    expect((await explorer.mine(ann.id, START, { color: 'w' }))[0]).toMatchObject({ uci: 'e2e4', white: 1, black: 0 });
    expect((await explorer.mine(ann.id, after('e4'), { color: 'b' }))[0]).toMatchObject({ uci: 'e7e5', black: 1 });
    // filters: speed and month range
    expect(await explorer.mine(ann.id, after('e4'), { color: 'b', speeds: ['blitz'] })).toEqual([]);
    expect(await explorer.mine(ann.id, after('e4'), { color: 'b', since: '2026-11', until: '2026-11' })).toHaveLength(1);
    expect(await explorer.mine(ann.id, after('e4'), { color: 'b', until: '2026-10' })).toEqual([]);
  });

  it('skips games it cannot replay, and rebuilds from saved games', async () => {
    await store.finishGame(record({ id: 'bad', moves: ['e2e5'] }));
    expect(await explorer.moves('site', START)).toEqual([]);
    await store.finishGame(record({ id: 'ok' }));
    await store.db.run(`DELETE FROM explorer_moves WHERE source = 'site'`);
    expect(await explorer.reindexSite()).toBe(2);
    expect((await explorer.moves('site', START))[0]).toMatchObject({ white: 1 });
  });
});

describe('explorer API', () => {
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
    const res = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username: 'Mia', password: 'sicilian1' }) });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const mia = (await store.userByName('mia'))!;
    await store.finishGame({ id: 'g1', whiteId: mia.id, blackId: null, whiteName: 'Mia', blackName: 'Guest', tc: '5+0', category: 'blitz', rated: false, moves: ['e2e4', 'c7c5'], result: '1-0', reason: 'resign', startedAt: 1, endedAt: 2 });
  });
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await store.db.close();
  });

  const get = (path: string, withCookie = false) => fetch(base + path, withCookie ? { headers: { cookie } } : {});
  const q = (fen: string) => encodeURIComponent(fen);

  it('answers per source, and keeps My games to the signed-in player', async () => {
    const site = (await (await get(`/api/explorer?source=site&fen=${q(START)}`)).json()) as { available: boolean; moves: { san: string }[] };
    expect(site.available).toBe(true);
    expect(site.moves.map(m => m.san)).toEqual(['e4']);
    expect(await (await get(`/api/explorer?source=masters&fen=${q(START)}`)).json()).toEqual({ source: 'masters', available: false, moves: [] });
    expect((await get(`/api/explorer?source=mine&fen=${q(START)}`)).status).toBe(401);
    const mine = (await (await get(`/api/explorer?source=mine&fen=${q(START)}&color=w&speeds=blitz,nonsense&since=1970-01`, true)).json()) as { moves: { uci: string }[] };
    expect(mine.moves.map(m => m.uci)).toEqual(['e2e4']);
  });

  it('checks its input', async () => {
    expect((await get('/api/explorer?source=site&fen=nonsense')).status).toBe(400);
    expect((await get(`/api/explorer?source=elsewhere&fen=${q(START)}`)).status).toBe(400);
    expect((await get('/api/opening?moves=e2e4,zz')).status).toBe(400);
  });

  it('names openings and marks book moves', async () => {
    expect(await (await get('/api/opening?moves=e2e4,c7c5')).json()).toEqual({ opening: null });
    expect(await (await get('/api/explorer/book?moves=e2e4,c7c5')).json()).toEqual({ book: [false, false] });
  });
});

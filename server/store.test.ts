import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, type Db } from './db/db.ts';
import { toPositional } from './db/postgres.ts';
import { openSqlite } from './db/sqlite.ts';
import { SESSION_TTL_MS, Store, type GameRecord } from './store.ts';

const game = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: 'g1',
  whiteId: null,
  blackId: null,
  whiteName: 'a',
  blackName: 'b',
  tc: '3+2',
  category: 'blitz',
  rated: false,
  moves: ['e2e4', 'e7e5'],
  result: '1-0',
  reason: 'resign',
  startedAt: 1_000,
  endedAt: 2_000,
  ...over,
});

/** The same checks for every engine. */
function storeSuite(name: string, open: () => Promise<Db>) {
  describe(`store on ${name}`, () => {
    let db: Db;
    let store: Store;
    let now = 1_000_000;

    beforeEach(async () => {
      db = await open();
      await migrate(db);
      store = new Store(db, () => now);
    });
    afterEach(async () => {
      await db.close();
    });

    it('applies migrations once', async () => {
      await migrate(db);
      const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_version');
      expect(Number(row!.n)).toBe(MIGRATIONS.length);
    });

    it('keeps usernames unique regardless of case', async () => {
      const alice = await store.createUser('Alice', 'hash');
      expect(alice).toMatchObject({ username: 'Alice' });
      expect(await store.createUser('alice', 'hash')).toBeNull();
      expect((await store.userByName('ALICE'))?.id).toBe(alice!.id);
      expect((await store.credentials('alice'))?.passwordHash).toBe('hash');
      expect(await store.userByName('bob')).toBeUndefined();
    });

    it('stores sessions by hash and expires them', async () => {
      const user = (await store.createUser('carol', 'h'))!;
      const token = await store.createSession(user.id);
      const stored = await db.get<{ id_hash: string }>('SELECT id_hash FROM sessions');
      expect(stored!.id_hash).not.toContain(token);
      expect((await store.userForSession(token))?.username).toBe('carol');
      expect(await store.userForSession('nope')).toBeUndefined();
      now += SESSION_TTL_MS + 1;
      expect(await store.userForSession(token)).toBeUndefined();
      await store.pruneSessions();
      expect(await db.get('SELECT * FROM sessions')).toBeUndefined();

      const again = await store.createSession(user.id);
      await store.deleteSession(again);
      expect(await store.userForSession(again)).toBeUndefined();
    });

    it('starts everyone at the default rating in every category', async () => {
      const user = (await store.createUser('dave', 'h'))!;
      const r = await store.ratings(user.id);
      expect(r.blitz).toEqual({ glicko: { rating: 1500, deviation: 500, volatility: 0.09 }, games: 0, updatedAt: 0 });
      expect(Object.keys(r).sort()).toEqual(['blitz', 'bullet', 'classical', 'rapid']);
    });

    it('scores a rated game for both players in one transaction', async () => {
      const w = (await store.createUser('white', 'h'))!;
      const b = (await store.createUser('black', 'h'))!;
      const change = await store.finishGame(game({ whiteId: w.id, blackId: b.id, rated: true }));
      expect(change!.white.after.rating).toBeGreaterThan(1500);
      expect(change!.black.after.rating).toBeLessThan(1500);
      const [rw, rb] = [await store.ratings(w.id), await store.ratings(b.id)];
      expect(rw.blitz.games).toBe(1);
      expect(rw.blitz.glicko.rating).toBeCloseTo(change!.white.after.rating, 6);
      expect(rb.blitz.glicko.rating).toBeCloseTo(change!.black.after.rating, 6);
      expect(rw.bullet.games).toBe(0);

      const saved = await store.game('g1');
      expect(saved).toMatchObject({ rated: true, whiteRating: 1500, blackRating: 1500, moves: ['e2e4', 'e7e5'] });
      expect(saved!.whiteDiff).toBe(Math.round(change!.white.after.rating) - 1500);
      expect(saved!.whiteDiff! + saved!.blackDiff!).toBe(0);
    });

    it('stores casual games without touching ratings', async () => {
      const w = (await store.createUser('white', 'h'))!;
      expect(await store.finishGame(game({ whiteId: w.id, blackName: 'Guest 1234' }))).toBeNull();
      expect((await store.ratings(w.id)).blitz.games).toBe(0);
      expect(await store.game('g1')).toMatchObject({ rated: false, whiteDiff: null, blackId: null });
    });

    it('rolls back a failed save', async () => {
      const w = (await store.createUser('white', 'h'))!;
      const b = (await store.createUser('black', 'h'))!;
      await store.finishGame(game({ whiteId: w.id, blackId: b.id, rated: true }));
      // same id again: the insert fails, so the second rating update must not stick
      await expect(store.finishGame(game({ whiteId: w.id, blackId: b.id, rated: true }))).rejects.toThrow();
      expect((await store.ratings(w.id)).blitz.games).toBe(1);
    });

    it('lists a player’s games newest first, in pages', async () => {
      const u = (await store.createUser('pat', 'h'))!;
      for (let i = 0; i < 5; i++) await store.finishGame(game({ id: `g${i}`, whiteId: u.id, endedAt: 1_000 + i }));
      await store.finishGame(game({ id: 'other', endedAt: 9_999 }));
      const first = await store.gamesOf(u.id, 3);
      expect(first.map(g => g.id)).toEqual(['g4', 'g3', 'g2']);
      const next = await store.gamesOf(u.id, 3, first.at(-1)!.endedAt);
      expect(next.map(g => g.id)).toEqual(['g1', 'g0']);
      expect(await store.countGames(u.id)).toBe(5);
    });
  });
}

storeSuite('SQLite', async () => openSqlite(':memory:'));

const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  storeSuite('PostgreSQL', async () => {
    const { openPostgres } = await import('./db/postgres.ts');
    const db = await openPostgres(pgUrl);
    // a clean schema for each test
    for (const t of ['games', 'ratings', 'sessions', 'users', 'schema_version']) await db.run(`DROP TABLE IF EXISTS ${t} CASCADE`);
    return db;
  });
} else {
  describe.skip('store on PostgreSQL (set TEST_DATABASE_URL to run)', () => {
    it('runs the same checks', () => undefined);
  });
}

it('converts ? placeholders for Postgres', () => {
  expect(toPositional('SELECT * FROM t WHERE a = ? AND b IN (?, ?)')).toBe('SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)');
});

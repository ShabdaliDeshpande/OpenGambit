import { createHash, randomBytes } from 'node:crypto';
import type { Speed } from './config.ts';
import type { Db, Queryable } from './db/db.ts';
import { afterIdle, DEFAULT_GLICKO, isProvisional, rateGame, type Glicko, type Score } from './rating/glicko2.ts';

export const CATEGORIES: readonly Speed[] = ['bullet', 'blitz', 'rapid', 'classical'];

export interface User {
  id: string;
  username: string;
  createdAt: number;
}

export interface RatingInfo {
  glicko: Glicko;
  games: number;
  updatedAt: number;
}

export type Ratings = Record<Speed, RatingInfo>;

export interface GameRecord {
  id: string;
  whiteId: string | null;
  blackId: string | null;
  whiteName: string;
  blackName: string;
  tc: string;
  category: Speed;
  rated: boolean;
  moves: string[];
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: string;
  startedAt: number;
  endedAt: number;
}

export interface StoredGame extends GameRecord {
  whiteRating: number | null;
  blackRating: number | null;
  whiteDiff: number | null;
  blackDiff: number | null;
}

export interface RatingChange {
  white: { before: Glicko; after: Glicko };
  black: { before: Glicko; after: Glicko };
}

export const SESSION_TTL_MS = 30 * 86_400_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const usernameKey = (name: string) => name.toLowerCase();

interface UserRow {
  id: string;
  username: string;
  created_at: number;
}

interface GameRow {
  id: string;
  white_id: string | null;
  black_id: string | null;
  white_name: string;
  black_name: string;
  tc: string;
  category: Speed;
  rated: number;
  moves: string;
  result: GameRecord['result'];
  reason: string;
  white_rating: number | null;
  black_rating: number | null;
  white_diff: number | null;
  black_diff: number | null;
  started_at: number;
  ended_at: number;
}

const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, createdAt: Number(r.created_at) });

const toGame = (r: GameRow): StoredGame => ({
  id: r.id,
  whiteId: r.white_id,
  blackId: r.black_id,
  whiteName: r.white_name,
  blackName: r.black_name,
  tc: r.tc,
  category: r.category,
  rated: Number(r.rated) === 1,
  moves: r.moves ? r.moves.split(' ') : [],
  result: r.result,
  reason: r.reason,
  whiteRating: r.white_rating,
  blackRating: r.black_rating,
  whiteDiff: r.white_diff,
  blackDiff: r.black_diff,
  startedAt: Number(r.started_at),
  endedAt: Number(r.ended_at),
});

/** Ratings as they stand now: deviation grown for the time since the last rated game. */
export function currentGlicko(info: RatingInfo, now: number): Glicko {
  return info.games === 0 ? info.glicko : afterIdle(info.glicko, now - info.updatedAt);
}

export const displayRating = (g: Glicko) => ({ rating: Math.round(g.rating), provisional: isProvisional(g) });

/** Accounts, sessions, ratings and finished games, in either database engine. */
export class Store {
  readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = () => Date.now()) {
    this.db = db;
    this.now = now;
  }

  async createUser(username: string, passwordHash: string): Promise<User | null> {
    const id = randomBytes(9).toString('base64url');
    const now = this.now();
    try {
      await this.db.run('INSERT INTO users (id, username, username_key, password_hash, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        username,
        usernameKey(username),
        passwordHash,
        now,
        now,
      ]);
    } catch (e) {
      if (/unique|duplicate/i.test(String((e as Error).message))) return null;
      throw e;
    }
    return { id, username, createdAt: now };
  }

  async userByName(username: string): Promise<User | undefined> {
    const row = await this.db.get<UserRow>('SELECT id, username, created_at FROM users WHERE username_key = ?', [usernameKey(username)]);
    return row && toUser(row);
  }

  async credentials(username: string): Promise<{ user: User; passwordHash: string } | undefined> {
    const row = await this.db.get<UserRow & { password_hash: string }>(
      'SELECT id, username, created_at, password_hash FROM users WHERE username_key = ?',
      [usernameKey(username)],
    );
    return row && { user: toUser(row), passwordHash: row.password_hash };
  }

  /** Creates a session and returns its secret token (only a hash is stored). */
  async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    await this.db.run('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      hashToken(token),
      userId,
      now,
      now + SESSION_TTL_MS,
    ]);
    return token;
  }

  async userForSession(token: string): Promise<User | undefined> {
    const row = await this.db.get<UserRow>(
      'SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?',
      [hashToken(token), this.now()],
    );
    if (!row) return undefined;
    await this.db.run('UPDATE users SET seen_at = ? WHERE id = ?', [this.now(), row.id]);
    return toUser(row);
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE id_hash = ?', [hashToken(token)]);
  }

  async pruneSessions(): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [this.now()]);
  }

  async ratings(userId: string, q: Queryable = this.db): Promise<Ratings> {
    const rows = await q.all<{ category: Speed; rating: number; deviation: number; volatility: number; games: number; updated_at: number }>(
      'SELECT category, rating, deviation, volatility, games, updated_at FROM ratings WHERE user_id = ?',
      [userId],
    );
    const result = Object.fromEntries(
      CATEGORIES.map(c => [c, { glicko: { ...DEFAULT_GLICKO }, games: 0, updatedAt: 0 } satisfies RatingInfo]),
    ) as Ratings;
    for (const r of rows)
      result[r.category] = {
        glicko: { rating: Number(r.rating), deviation: Number(r.deviation), volatility: Number(r.volatility) },
        games: Number(r.games),
        updatedAt: Number(r.updated_at),
      };
    return result;
  }

  /**
   * Saves a finished game. For a rated game between two accounts it also
   * applies Glicko-2 to both players, in the same transaction, and returns
   * the change.
   */
  async finishGame(game: GameRecord): Promise<RatingChange | null> {
    return this.db.transaction(async tx => {
      let change: RatingChange | null = null;
      if (game.rated && game.whiteId && game.blackId) {
        const now = this.now();
        const [w, b] = [(await this.ratings(game.whiteId, tx))[game.category], (await this.ratings(game.blackId, tx))[game.category]];
        const before = { white: currentGlicko(w, now), black: currentGlicko(b, now) };
        const score: Score = game.result === '1-0' ? 1 : game.result === '0-1' ? 0 : 0.5;
        const after = rateGame(before.white, before.black, score);
        for (const [id, info, g] of [
          [game.whiteId, w, after.white],
          [game.blackId, b, after.black],
        ] as const)
          await tx.run(
            `INSERT INTO ratings (user_id, category, rating, deviation, volatility, games, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, category) DO UPDATE SET rating = excluded.rating, deviation = excluded.deviation,
               volatility = excluded.volatility, games = excluded.games, updated_at = excluded.updated_at`,
            [id, game.category, g.rating, g.deviation, g.volatility, info.games + 1, now],
          );
        change = { white: { before: before.white, after: after.white }, black: { before: before.black, after: after.black } };
      }
      const diff = (side: 'white' | 'black') => (change ? Math.round(change[side].after.rating) - Math.round(change[side].before.rating) : null);
      await tx.run(
        `INSERT INTO games (id, white_id, black_id, white_name, black_name, tc, category, rated, moves, result, reason,
           white_rating, black_rating, white_diff, black_diff, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          game.id,
          game.whiteId,
          game.blackId,
          game.whiteName,
          game.blackName,
          game.tc,
          game.category,
          game.rated ? 1 : 0,
          game.moves.join(' '),
          game.result,
          game.reason,
          change ? Math.round(change.white.before.rating) : null,
          change ? Math.round(change.black.before.rating) : null,
          diff('white'),
          diff('black'),
          game.startedAt,
          game.endedAt,
        ],
      );
      return change;
    });
  }

  async game(id: string): Promise<StoredGame | undefined> {
    const row = await this.db.get<GameRow>('SELECT * FROM games WHERE id = ?', [id]);
    return row && toGame(row);
  }

  /** A player's games, newest first; pass the oldest `endedAt` seen to get the next page. */
  async gamesOf(userId: string, limit = 20, before = Number.MAX_SAFE_INTEGER): Promise<StoredGame[]> {
    const rows = await this.db.all<GameRow>(
      'SELECT * FROM games WHERE (white_id = ? OR black_id = ?) AND ended_at < ? ORDER BY ended_at DESC LIMIT ?',
      [userId, userId, before, limit],
    );
    return rows.map(toGame);
  }

  async countGames(userId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM games WHERE white_id = ? OR black_id = ?', [userId, userId]);
    return Number(row?.n ?? 0);
  }
}

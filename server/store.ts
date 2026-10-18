import { createHash, randomBytes } from 'node:crypto';
import type { Speed } from './config.ts';
import type { Db, Queryable } from './db/db.ts';
import { afterIdle, capped, DEFAULT_GLICKO, isProvisional, rateGame, ratePeriod, type Glicko, type Score } from './rating/glicko2.ts';

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
  tournamentId?: string | null;
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
  tournament_id: string | null;
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
  tournamentId: r.tournament_id ?? null,
});

/** Puzzles are treated as fixed-strength opponents with this rating deviation. */
export const PUZZLE_DEVIATION = 80;

export interface PuzzleResult {
  /** False when the player had tried this puzzle before (not rated). */
  first: boolean;
  rating: Glicko;
  diff: number | null;
}

export interface PuzzleAttempt {
  puzzleId: string;
  first: boolean;
  win: boolean;
  puzzleRating: number;
  themes: string[];
  ratingAfter: number | null;
  ratingDiff: number | null;
  createdAt: number;
}

export interface TournamentRecord {
  id: string;
  kind: 'arena' | 'swiss';
  name: string;
  tc: string;
  rated: boolean;
  createdBy: string | null;
  createdByName: string;
  settings: Record<string, unknown>;
  startedAt: number;
  finishedAt: number;
  players: number;
  winnerName: string | null;
  /** Final standings as shown on the tournament page. */
  standings: unknown[];
}

interface TournamentRow {
  id: string;
  kind: 'arena' | 'swiss';
  name: string;
  tc: string;
  rated: number;
  created_by: string | null;
  created_by_name: string;
  settings: string;
  started_at: number;
  finished_at: number;
  players: number;
  winner_name: string | null;
  standings: string;
}

const toTournament = (r: TournamentRow): TournamentRecord => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  tc: r.tc,
  rated: Number(r.rated) === 1,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  settings: JSON.parse(r.settings) as Record<string, unknown>,
  startedAt: Number(r.started_at),
  finishedAt: Number(r.finished_at),
  players: Number(r.players),
  winnerName: r.winner_name,
  standings: JSON.parse(r.standings) as unknown[],
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

  async passwordHash(userId: string): Promise<string | undefined> {
    return (await this.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [userId]))?.password_hash;
  }

  /** Sets a new password and signs out every other session (the one in `keepToken` stays). */
  async setPassword(userId: string, passwordHash: string, keepToken: string | null): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
      await tx.run('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?', [userId, keepToken ? hashToken(keepToken) : '']);
    });
  }

  /**
   * Deletes an account: sign-in, sessions, ratings and puzzle history go.
   * Finished games stay for the opponents, with this player's name replaced.
   */
  async deleteUser(userId: string): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.run("UPDATE games SET white_name = '[deleted]' WHERE white_id = ?", [userId]);
      await tx.run("UPDATE games SET black_name = '[deleted]' WHERE black_id = ?", [userId]);
      await tx.run("UPDATE tournaments SET created_by_name = '[deleted]' WHERE created_by = ?", [userId]);
      await tx.run('DELETE FROM users WHERE id = ?', [userId]);
    });
  }

  /**
   * The top players for a speed category or 'puzzle'. Only established
   * ratings (not provisional, at least 2 rated games) are listed.
   */
  async leaderboard(category: Speed | 'puzzle', limit = 10): Promise<{ username: string; rating: number; games: number }[]> {
    const rows = await this.db.all<{ username: string; rating: number; deviation: number; volatility: number; games: number; updated_at: number }>(
      `SELECT u.username, r.rating, r.deviation, r.volatility, r.games, r.updated_at
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.category = ? AND r.games >= 2 ORDER BY r.rating DESC LIMIT ?`,
      [category, limit * 5],
    );
    const now = this.now();
    return rows
      .map(r => ({
        username: r.username,
        games: Number(r.games),
        glicko: currentGlicko(
          {
            glicko: { rating: Number(r.rating), deviation: Number(r.deviation), volatility: Number(r.volatility) },
            games: Number(r.games),
            updatedAt: Number(r.updated_at),
          },
          now,
        ),
      }))
      .filter(r => !isProvisional(r.glicko))
      .sort((a, b) => b.glicko.rating - a.glicko.rating)
      .slice(0, limit)
      .map(r => ({ username: r.username, rating: Math.round(r.glicko.rating), games: r.games }));
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
      if (CATEGORIES.includes(r.category))
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
           white_rating, black_rating, white_diff, black_diff, started_at, ended_at, tournament_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          game.tournamentId ?? null,
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

  async saveTournament(t: TournamentRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO tournaments (id, kind, name, tc, rated, created_by, created_by_name, settings, started_at, finished_at, players, winner_name, standings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.kind,
        t.name,
        t.tc,
        t.rated ? 1 : 0,
        t.createdBy,
        t.createdByName,
        JSON.stringify(t.settings),
        t.startedAt,
        t.finishedAt,
        t.players,
        t.winnerName,
        JSON.stringify(t.standings),
      ],
    );
  }

  async tournament(id: string): Promise<TournamentRecord | undefined> {
    const row = await this.db.get<TournamentRow>('SELECT * FROM tournaments WHERE id = ?', [id]);
    return row && toTournament(row);
  }

  /** Recently finished tournaments, newest first (without standings). */
  async recentTournaments(limit = 20): Promise<Omit<TournamentRecord, 'standings'>[]> {
    const rows = await this.db.all<TournamentRow>(
      `SELECT id, kind, name, tc, rated, created_by, created_by_name, settings, started_at, finished_at, players, winner_name, '[]' AS standings
       FROM tournaments ORDER BY finished_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(r => {
      const { standings: _, ...rest } = toTournament(r);
      return rest;
    });
  }

  /** The puzzle rating (its own Glicko-2 pool, stored as category 'puzzle'). */
  async puzzleRating(userId: string, q: Queryable = this.db): Promise<RatingInfo> {
    const r = await q.get<{ rating: number; deviation: number; volatility: number; games: number; updated_at: number }>(
      "SELECT rating, deviation, volatility, games, updated_at FROM ratings WHERE user_id = ? AND category = 'puzzle'",
      [userId],
    );
    return r
      ? { glicko: { rating: Number(r.rating), deviation: Number(r.deviation), volatility: Number(r.volatility) }, games: Number(r.games), updatedAt: Number(r.updated_at) }
      : { glicko: { ...DEFAULT_GLICKO }, games: 0, updatedAt: 0 };
  }

  /**
   * Records a puzzle attempt. Only a player's first attempt at a puzzle is
   * rated: Glicko-2 against the puzzle's own rating, as one game.
   */
  async recordPuzzle(
    userId: string,
    puzzle: { id: string; rating: number; themes: string[] },
    win: boolean,
    /** 0..1: how much of the full rating change applies (less when training a theme that hints at the answer). */
    weight = 1,
  ): Promise<PuzzleResult> {
    return this.db.transaction(async tx => {
      const now = this.now();
      const seen = await tx.get('SELECT 1 AS x FROM puzzle_attempts WHERE user_id = ? AND puzzle_id = ?', [userId, puzzle.id]);
      const info = await this.puzzleRating(userId, tx);
      const before = currentGlicko(info, now);
      let after = before;
      if (!seen) {
        const full = capped(ratePeriod(before, [{ opponent: { rating: puzzle.rating, deviation: PUZZLE_DEVIATION, volatility: 0.06 }, score: win ? 1 : 0 }]), before);
        const mix = (a: number, b: number) => a + (b - a) * Math.max(0, Math.min(1, weight));
        after = { rating: mix(before.rating, full.rating), deviation: mix(before.deviation, full.deviation), volatility: mix(before.volatility, full.volatility) };
        await tx.run(
          `INSERT INTO ratings (user_id, category, rating, deviation, volatility, games, updated_at) VALUES (?, 'puzzle', ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, category) DO UPDATE SET rating = excluded.rating, deviation = excluded.deviation,
             volatility = excluded.volatility, games = excluded.games, updated_at = excluded.updated_at`,
          [userId, after.rating, after.deviation, after.volatility, info.games + 1, now],
        );
      }
      const diff = seen ? null : Math.round(after.rating) - Math.round(before.rating);
      await tx.run(
        `INSERT INTO puzzle_attempts (user_id, puzzle_id, first, win, puzzle_rating, themes, rating_after, rating_diff, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, puzzle.id, seen ? 0 : 1, win ? 1 : 0, puzzle.rating, puzzle.themes.join(' '), seen ? null : Math.round(after.rating), diff, now],
      );
      return { first: !seen, rating: after, diff };
    });
  }

  /** A player's puzzle attempts, newest first. */
  async puzzleAttempts(userId: string, limit = 3000): Promise<PuzzleAttempt[]> {
    const rows = await this.db.all<{
      puzzle_id: string;
      first: number;
      win: number;
      puzzle_rating: number;
      themes: string;
      rating_after: number | null;
      rating_diff: number | null;
      created_at: number;
    }>('SELECT * FROM puzzle_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
    return rows.map(r => ({
      puzzleId: r.puzzle_id,
      first: Number(r.first) === 1,
      win: Number(r.win) === 1,
      puzzleRating: Number(r.puzzle_rating),
      themes: r.themes ? r.themes.split(' ') : [],
      ratingAfter: r.rating_after === null ? null : Number(r.rating_after),
      ratingDiff: r.rating_diff === null ? null : Number(r.rating_diff),
      createdAt: Number(r.created_at),
    }));
  }

  async countGames(userId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM games WHERE white_id = ? OR black_id = ?', [userId, userId]);
    return Number(row?.n ?? 0);
  }
}

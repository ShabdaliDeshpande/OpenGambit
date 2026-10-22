// A small database interface with two engines behind it: SQLite (a local
// file, built into Node) and PostgreSQL (when DATABASE_URL is set). All SQL
// in this project uses `?` placeholders and the subset both engines accept.

export type Param = string | number | null;

export interface Queryable {
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
}

export interface Db extends Queryable {
  readonly engine: 'sqlite' | 'postgres';
  /** Runs `fn` atomically; it is rolled back if `fn` throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Schema changes, applied in order and recorded in schema_version. Never edit
 * one that has shipped; add a new one instead.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    seen_at BIGINT NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE ratings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    rating DOUBLE PRECISION NOT NULL,
    deviation DOUBLE PRECISION NOT NULL,
    volatility DOUBLE PRECISION NOT NULL,
    games INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, category)
  );
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    white_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    black_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    white_name TEXT NOT NULL,
    black_name TEXT NOT NULL,
    tc TEXT NOT NULL,
    category TEXT NOT NULL,
    rated INTEGER NOT NULL,
    moves TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT NOT NULL,
    white_rating INTEGER,
    black_rating INTEGER,
    white_diff INTEGER,
    black_diff INTEGER,
    started_at BIGINT NOT NULL,
    ended_at BIGINT NOT NULL
  );
  CREATE INDEX games_white ON games(white_id, ended_at);
  CREATE INDEX games_black ON games(black_id, ended_at);`,
  `ALTER TABLE games ADD COLUMN tournament_id TEXT;
  CREATE TABLE tournaments (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    tc TEXT NOT NULL,
    rated INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT NOT NULL,
    settings TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT NOT NULL,
    players INTEGER NOT NULL,
    winner_name TEXT,
    standings TEXT NOT NULL
  );
  CREATE INDEX tournaments_finished ON tournaments(finished_at);`,
  `CREATE TABLE puzzle_attempts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    puzzle_id TEXT NOT NULL,
    first INTEGER NOT NULL,
    win INTEGER NOT NULL,
    puzzle_rating INTEGER NOT NULL,
    themes TEXT NOT NULL,
    rating_after INTEGER,
    rating_diff INTEGER,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX puzzle_attempts_user ON puzzle_attempts(user_id, created_at);
  CREATE INDEX puzzle_attempts_puzzle ON puzzle_attempts(user_id, puzzle_id);`,
  `CREATE TABLE puzzle_runs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX puzzle_runs_user ON puzzle_runs(user_id, mode, score);`,
];

/** Splits a migration into statements (no semicolons appear inside our SQL strings). */
const statements = (sql: string) =>
  sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

export async function migrate(db: Db): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = await db.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_version');
  const current = Number(row?.version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.transaction(async tx => {
      for (const s of statements(MIGRATIONS[v]!)) await tx.run(s);
      await tx.run('INSERT INTO schema_version (version) VALUES (?)', [v + 1]);
    });
  }
}

/** Opens Postgres when DATABASE_URL is set, otherwise the SQLite file (default data/chess.db). */
export async function openDatabase(env: Record<string, string | undefined> = process.env): Promise<Db> {
  const db = env.DATABASE_URL
    ? await (await import('./postgres.ts')).openPostgres(env.DATABASE_URL)
    : (await import('./sqlite.ts')).openSqlite(env.SQLITE_PATH ?? 'data/chess.db');
  await migrate(db);
  return db;
}

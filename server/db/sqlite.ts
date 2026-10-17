import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db, Param, Queryable } from './db.ts';

/**
 * SQLite through Node's built-in driver. The driver is synchronous, so every
 * operation goes through one queue: a transaction holds the queue until it
 * finishes, and nothing else can run inside it by accident.
 */
export function openSqlite(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL');

  const direct: Queryable = {
    all: async <T>(sql: string, params: Param[] = []) => sqlite.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: Param[] = []) => sqlite.prepare(sql).get(...params) as T | undefined,
    run: async (sql: string, params: Param[] = []) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    engine: 'sqlite',
    all: (sql, params) => enqueue(() => direct.all(sql, params)),
    get: (sql, params) => enqueue(() => direct.get(sql, params)),
    run: (sql, params) => enqueue(() => direct.run(sql, params)),
    transaction: fn =>
      enqueue(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          sqlite.exec('COMMIT');
          return result;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      }),
    close: () => enqueue(async () => sqlite.close()),
  };
}

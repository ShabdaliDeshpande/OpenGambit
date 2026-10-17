import pg from 'pg';
import type { Db, Param, Queryable } from './db.ts';

// BIGINT (int8) columns come back as strings by default; our values fit in a double.
pg.types.setTypeParser(20, v => Number(v));

/** Turns `?` placeholders into Postgres's `$1, $2, …`. */
export function toPositional(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  const query = (sql: string, params: Param[] = []) => client.query(toPositional(sql), params);
  return {
    all: async <T>(sql: string, params?: Param[]) => (await query(sql, params)).rows as T[],
    get: async <T>(sql: string, params?: Param[]) => (await query(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params?: Param[]) => ({ changes: (await query(sql, params)).rowCount ?? 0 }),
  };
}

export async function openPostgres(url: string): Promise<Db> {
  // hosted databases (Neon, Render, Supabase…) require TLS; local ones usually don't
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  const pool = new pg.Pool({ connectionString: url, max: 5, ...(local ? {} : { ssl: { rejectUnauthorized: true } }) });
  await pool.query('SELECT 1');
  const direct = wrap(pool);
  return {
    engine: 'postgres',
    ...direct,
    transaction: async fn => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

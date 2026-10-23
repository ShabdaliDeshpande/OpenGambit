import type { Server } from 'node:http';
import { AnalysisQueue } from './analysisQueue.ts';
import { createApi } from './api.ts';
import { openDatabase } from './db/db.ts';
import { Store } from './store.ts';
import { attachGameServer } from './transport.ts';

export interface Backend {
  store: Store;
  /** Handles /api/* and passes everything else to `next`. */
  api: ReturnType<typeof createApi>['handler'];
  /** Adds the game WebSocket to an HTTP server. */
  attach: (http: Server, options?: { maxConnsPerIp?: number }) => void;
}

/**
 * Opens the database (Postgres if DATABASE_URL is set, otherwise SQLite) and
 * builds the API and game server on top of it. Used by `npm run dev` (through
 * the Vite plugin) and by `npm start`.
 */
export async function startBackend(env: Record<string, string | undefined> = process.env): Promise<Backend> {
  const db = await openDatabase(env);
  const store = new Store(db);
  await store.pruneSessions();
  const trustProxy = env.TRUST_PROXY === '1';
  // server-side analysis is opt-in: it keeps a CPU core busy while games are queued
  const analysis = env.ANALYSIS_QUEUE === '1' ? new AnalysisQueue(store, undefined, { ms: Number(env.ANALYSIS_MS) || 600 }) : null;
  if (analysis) console.log(`Server analysis: on (${analysis.ms} ms per position)`);
  const { handler, identify } = createApi(store, { trustProxy, analysis });
  console.log(`Database: ${db.engine === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : `SQLite (${env.SQLITE_PATH ?? 'data/chess.db'})`}`);
  return {
    store,
    api: handler,
    attach: (http, options = {}) => {
      attachGameServer(http, {}, { trustProxy, store, identify, ...options });
      http.on('close', () => void db.close());
    },
  };
}

// Loads what a player's insights need, and caches the result until they
// finish another game or save another review.
import type { Db, Param } from '../db/db.ts';
import type { StoredReview } from '../../src/analysis/reviewData.ts';
import { EXPLORER_PLIES, positionKeys } from '../explorer/explorerStore.ts';
import { buildInsights, type InsightGame, type Insights } from './insights.ts';

export interface InsightQuery {
  /** Only this speed (bullet, blitz, rapid, classical). */
  speed?: string;
  /** Only games that ended at or after this time (ms). */
  since?: number;
}

/** At most this many recent games are looked at. */
export const MAX_INSIGHT_GAMES = 2000;

interface Row {
  id: string;
  white_id: string | null;
  black_id: string | null;
  category: string;
  tc: string;
  rated: number;
  moves: string;
  clocks: string | null;
  result: InsightGame['result'];
  white_rating: number | null;
  black_rating: number | null;
  white_diff: number | null;
  black_diff: number | null;
  ended_at: number | string;
  review_data: string | null;
}

export async function loadInsightGames(db: Db, userId: string, q: InsightQuery = {}): Promise<InsightGame[]> {
  const where = ['(g.white_id = ? OR g.black_id = ?)'];
  const params: Param[] = [userId, userId];
  if (q.speed) {
    where.push('g.category = ?');
    params.push(q.speed);
  }
  if (q.since) {
    where.push('g.ended_at >= ?');
    params.push(q.since);
  }
  const rows = await db.all<Row>(
    `SELECT g.id, g.white_id, g.black_id, g.category, g.tc, g.rated, g.moves, g.clocks, g.result, g.white_rating, g.black_rating,
       g.white_diff, g.black_diff, g.ended_at, r.data AS review_data
     FROM games g LEFT JOIN game_reviews r ON r.game_id = g.id WHERE ${where.join(' AND ')} ORDER BY g.ended_at DESC LIMIT ?`,
    [...params, MAX_INSIGHT_GAMES],
  );
  const games: InsightGame[] = rows.map(r => ({
    id: r.id,
    whiteId: r.white_id,
    blackId: r.black_id,
    category: r.category,
    tc: r.tc,
    rated: Number(r.rated) === 1,
    moves: r.moves ? r.moves.split(' ') : [],
    clocks: r.clocks ? r.clocks.split(' ').map(Number) : null,
    result: r.result,
    whiteRating: r.white_rating === null ? null : Number(r.white_rating),
    blackRating: r.black_rating === null ? null : Number(r.black_rating),
    whiteDiff: r.white_diff === null ? null : Number(r.white_diff),
    blackDiff: r.black_diff === null ? null : Number(r.black_diff),
    endedAt: Number(r.ended_at),
    review: r.review_data ? (JSON.parse(r.review_data) as StoredReview) : null,
  }));
  await nameOpenings(db, games);
  return games;
}

/** Fills in each game's opening name: the deepest named position in its first moves. */
async function nameOpenings(db: Db, games: InsightGame[]): Promise<void> {
  if (!(await db.get('SELECT 1 AS one FROM openings LIMIT 1'))) return;
  const keysOf = new Map(games.map(g => [g.id, positionKeys(g.moves.slice(0, EXPLORER_PLIES))]));
  const all = [...new Set([...keysOf.values()].flat())];
  const names = new Map<string, { eco: string; name: string }>();
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const rows = await db.all<{ key: string; eco: string; name: string }>(`SELECT key, eco, name FROM openings WHERE key IN (${chunk.map(() => '?').join(', ')})`, chunk);
    for (const r of rows) names.set(r.key, { eco: r.eco, name: r.name });
  }
  for (const g of games) {
    const keys = keysOf.get(g.id) ?? [];
    for (let k = keys.length - 1; k >= 0; k--) {
      const found = names.get(keys[k]!);
      if (found) {
        g.opening = found;
        break;
      }
    }
  }
}

/** Builds insights, reusing the last result while nothing has changed. */
export class InsightsService {
  private readonly db: Db;
  private readonly cache = new Map<string, { stamp: string; data: Insights }>();

  constructor(db: Db) {
    this.db = db;
  }

  async get(userId: string, q: InsightQuery, timeZone: string): Promise<Insights> {
    const stamp = await this.stamp(userId);
    const key = `${userId}|${q.speed ?? ''}|${q.since ?? ''}|${timeZone}`;
    const hit = this.cache.get(key);
    if (hit && hit.stamp === stamp) return hit.data;
    const data = buildInsights(userId, await loadInsightGames(this.db, userId, q), timeZone);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { stamp, data });
    return data;
  }

  /** Changes whenever the player finishes a game or a review of theirs is saved. */
  private async stamp(userId: string): Promise<string> {
    const row = await this.db.get<{ games: number | string; last: number | string | null; reviews: number | string; reviewed: number | string | null }>(
      `SELECT COUNT(*) AS games, MAX(g.ended_at) AS last, COUNT(r.game_id) AS reviews, MAX(r.created_at) AS reviewed
       FROM games g LEFT JOIN game_reviews r ON r.game_id = g.id WHERE g.white_id = ? OR g.black_id = ?`,
      [userId, userId],
    );
    return `${row?.games}|${row?.last}|${row?.reviews}|${row?.reviewed}`;
  }
}

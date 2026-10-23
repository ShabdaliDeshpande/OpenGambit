// The opening explorer's data: move counts per position from imported master
// games ("masters") and from games played here ("site"), each player's own
// games ("My games"), and opening names. See docs/lila-feature-map.md §15.
import { Chess } from 'chess.js';
import type { Db, Param, Queryable } from '../db/db.ts';
import { isStandardStart, monthOf, positionKey } from '../../src/explorer/key.ts';

/** Moves per game that the explorer keeps (positions deeper than this aren't opening theory). */
export const EXPLORER_PLIES = 30;

export type Source = 'masters' | 'site';
export type Result = '1-0' | '0-1' | '1/2-1/2';

export interface MoveCount {
  key: string;
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  ratingSum: number;
  ratedGames: number;
}

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  /** Average rating of the players in these games, when known. */
  averageRating: number | null;
}

export interface MineFilter {
  color: 'w' | 'b';
  speeds?: readonly string[];
  /** "YYYY-MM", inclusive. */
  since?: string;
  until?: string;
}

export interface OpeningName {
  eco: string;
  name: string;
  /** How many moves deep the named position is. */
  ply: number;
}

export const resultCounts = (result: Result) => ({
  white: result === '1-0' ? 1 : 0,
  draws: result === '1/2-1/2' ? 1 : 0,
  black: result === '0-1' ? 1 : 0,
});

/** Adds move counts (an upsert, so imports and new games accumulate). */
export async function addMoves(q: Queryable, source: Source, counts: Iterable<MoveCount>): Promise<void> {
  for (const c of counts)
    await q.run(
      `INSERT INTO explorer_moves (source, key, uci, san, white, draws, black, rating_sum, rated_games) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, key, uci) DO UPDATE SET white = explorer_moves.white + excluded.white, draws = explorer_moves.draws + excluded.draws,
         black = explorer_moves.black + excluded.black, rating_sum = explorer_moves.rating_sum + excluded.rating_sum,
         rated_games = explorer_moves.rated_games + excluded.rated_games`,
      [source, c.key, c.uci, c.san, c.white, c.draws, c.black, Math.round(c.ratingSum), c.ratedGames],
    );
}

/** The first plies of a game from the standard start: each position's key and the move played there. */
export function gameEntries(moves: readonly string[], plies = EXPLORER_PLIES): { key: string; uci: string; san: string }[] | null {
  const chess = new Chess();
  const out: { key: string; uci: string; san: string }[] = [];
  try {
    for (const uci of moves.slice(0, plies)) {
      const key = positionKey(chess.fen());
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
      out.push({ key, uci: m.from + m.to + (m.promotion ?? ''), san: m.san });
    }
  } catch {
    return null;
  }
  return out;
}

export interface IndexedGame {
  whiteId: string | null;
  blackId: string | null;
  category: string;
  moves: readonly string[];
  result: Result;
  endedAt: number;
}

/** Adds a finished game to the OpenGambit explorer and to each signed-in player's own games. */
export async function indexGame(q: Queryable, game: IndexedGame, ratings: { white: number | null; black: number | null }): Promise<void> {
  const entries = gameEntries(game.moves);
  if (!entries || entries.length === 0) return;
  const counts = resultCounts(game.result);
  const rated = ratings.white !== null && ratings.black !== null;
  await addMoves(
    q,
    'site',
    entries.map(e => ({ ...e, ...counts, ratingSum: rated ? (ratings.white! + ratings.black!) / 2 : 0, ratedGames: rated ? 1 : 0 })),
  );
  const month = monthOf(game.endedAt);
  for (const [color, userId] of [
    ['w', game.whiteId],
    ['b', game.blackId],
  ] as const) {
    if (!userId) continue;
    for (const e of entries)
      await q.run(
        `INSERT INTO explorer_mine (user_id, key, uci, san, color, speed, month, white, draws, black) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, key, uci, color, speed, month) DO UPDATE SET white = explorer_mine.white + excluded.white,
           draws = explorer_mine.draws + excluded.draws, black = explorer_mine.black + excluded.black`,
        [userId, e.key, e.uci, e.san, color, game.category, month, counts.white, counts.draws, counts.black],
      );
  }
}

interface MoveRow {
  uci: string;
  san: string;
  white: number | string;
  draws: number | string;
  black: number | string;
  rating_sum?: number | string;
  rated_games?: number | string;
}

// PostgreSQL returns sums and big integers as strings
const toMove = (r: MoveRow): ExplorerMove => {
  const rated = Number(r.rated_games ?? 0);
  return {
    uci: r.uci,
    san: r.san,
    white: Number(r.white),
    draws: Number(r.draws),
    black: Number(r.black),
    averageRating: rated > 0 ? Math.round(Number(r.rating_sum) / rated) : null,
  };
};

const byGames = (a: ExplorerMove, b: ExplorerMove) => b.white + b.draws + b.black - (a.white + a.draws + a.black);

export class Explorer {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** Whether a source has any data (masters needs an import first). */
  async has(source: Source): Promise<boolean> {
    return !!(await this.db.get('SELECT 1 AS one FROM explorer_moves WHERE source = ? LIMIT 1', [source]));
  }

  async moves(source: Source, fen: string, limit = 20): Promise<ExplorerMove[]> {
    const rows = await this.db.all<MoveRow>(
      `SELECT uci, san, white, draws, black, rating_sum, rated_games FROM explorer_moves WHERE source = ? AND key = ?
       ORDER BY white + draws + black DESC LIMIT ?`,
      [source, positionKey(fen), limit],
    );
    return rows.map(toMove);
  }

  async mine(userId: string, fen: string, filter: MineFilter, limit = 20): Promise<ExplorerMove[]> {
    const where = ['user_id = ?', 'key = ?', 'color = ?'];
    const params: Param[] = [userId, positionKey(fen), filter.color];
    if (filter.speeds?.length) {
      where.push(`speed IN (${filter.speeds.map(() => '?').join(', ')})`);
      params.push(...filter.speeds);
    }
    if (filter.since) {
      where.push('month >= ?');
      params.push(filter.since);
    }
    if (filter.until) {
      where.push('month <= ?');
      params.push(filter.until);
    }
    const rows = await this.db.all<MoveRow>(
      `SELECT uci, san, SUM(white) AS white, SUM(draws) AS draws, SUM(black) AS black FROM explorer_mine WHERE ${where.join(' AND ')}
       GROUP BY uci, san`,
      params,
    );
    return rows.map(toMove).sort(byGames).slice(0, limit);
  }

  /** The name of the deepest named position along these moves (UCI, from the standard start). */
  async opening(moves: readonly string[]): Promise<OpeningName | null> {
    const keys = positionKeys(moves);
    if (keys.length === 0) return null;
    const rows = await this.db.all<{ key: string; eco: string; name: string; ply: number }>(
      `SELECT key, eco, name, ply FROM openings WHERE key IN (${keys.map(() => '?').join(', ')})`,
      keys,
    );
    let best: OpeningName | null = null;
    let depth = -1;
    for (const r of rows) {
      const at = keys.lastIndexOf(r.key);
      if (at > depth) {
        depth = at;
        best = { eco: r.eco, name: r.name, ply: Number(r.ply) };
      }
    }
    return best;
  }

  /** For each move of a game, whether it's a master move played in more than one game (book). */
  async bookFlags(moves: readonly string[]): Promise<boolean[]> {
    const keys = positionKeys(moves.slice(0, EXPLORER_PLIES)).slice(0, -1);
    const flags = moves.map(() => false);
    if (keys.length === 0) return flags;
    const rows = await this.db.all<{ key: string; uci: string; games: number | string }>(
      `SELECT key, uci, white + draws + black AS games FROM explorer_moves WHERE source = 'masters' AND key IN (${keys.map(() => '?').join(', ')})`,
      keys,
    );
    const known = new Set(rows.filter(r => Number(r.games) > 1).map(r => `${r.key}|${r.uci}`));
    keys.forEach((key, i) => {
      flags[i] = known.has(`${key}|${moves[i]}`);
    });
    return flags;
  }

  /** Rebuilds the OpenGambit and "My games" data from every saved game. */
  async reindexSite(onProgress?: (games: number) => void): Promise<number> {
    await this.db.run(`DELETE FROM explorer_moves WHERE source = 'site'`);
    await this.db.run('DELETE FROM explorer_mine');
    let done = 0;
    for (let offset = 0; ; offset += 200) {
      const rows = await this.db.all<{
        white_id: string | null;
        black_id: string | null;
        category: string;
        moves: string;
        result: Result;
        ended_at: number | string;
        white_rating: number | null;
        black_rating: number | null;
      }>('SELECT white_id, black_id, category, moves, result, ended_at, white_rating, black_rating FROM games ORDER BY ended_at, id LIMIT 200 OFFSET ?', [offset]);
      if (rows.length === 0) break;
      await this.db.transaction(async tx => {
        for (const r of rows)
          await indexGame(
            tx,
            { whiteId: r.white_id, blackId: r.black_id, category: r.category, moves: r.moves ? r.moves.split(' ') : [], result: r.result, endedAt: Number(r.ended_at) },
            { white: r.white_rating, black: r.black_rating },
          );
      });
      done += rows.length;
      onProgress?.(done);
    }
    return done;
  }
}

/** Keys of the start position and of the position after each move (stopping at an illegal move). */
export function positionKeys(moves: readonly string[], startFen?: string): string[] {
  const chess = new Chess(startFen);
  if (startFen && !isStandardStart(startFen)) return [];
  const keys = [positionKey(chess.fen())];
  for (const uci of moves) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
    } catch {
      break;
    }
    keys.push(positionKey(chess.fen()));
  }
  return keys;
}

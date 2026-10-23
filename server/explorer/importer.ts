// Imports master games and opening names from files the user downloaded,
// into the explorer tables. Used by `npm run explorer:import` and
// `npm run openings:import`; kept apart from the scripts so it can be tested.
import type { Db } from '../db/db.ts';
import { Board } from '../../src/engine/board.ts';
import { positionKey } from '../../src/explorer/key.ts';
import { addMoves, EXPLORER_PLIES, resultCounts, type MoveCount, type Result } from './explorerStore.ts';
import { mainlineSans, playSan, type PgnGame } from './pgnGames.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ImportOptions {
  /** Skip games unless both players are rated at least this. */
  minRating?: number;
  /** Moves kept from each game. */
  plies?: number;
  /** Move counts kept in memory before they're written. */
  batch?: number;
  onProgress?: (stats: ImportStats) => void;
}

export interface ImportStats {
  games: number;
  skipped: number;
}

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);

/** Why a game is left out, or null to keep it. */
export function skipReason(g: PgnGame, minRating: number): string | null {
  const h = g.headers;
  if (h.FEN || h.SetUp === '1' || (h.Variant && h.Variant.toLowerCase() !== 'standard')) return 'not from the standard start';
  if (!RESULTS.has(h.Result ?? '')) return 'no result';
  if (minRating > 0 && !(Number(h.WhiteElo) >= minRating && Number(h.BlackElo) >= minRating)) return 'rating too low';
  if (g.moves.length === 0) return 'no moves';
  return null;
}

/** Adds master games to the explorer, a batch at a time. */
export async function importGames(db: Db, games: AsyncIterable<PgnGame> | Iterable<PgnGame>, opts: ImportOptions = {}): Promise<ImportStats> {
  const plies = opts.plies ?? EXPLORER_PLIES;
  const minRating = opts.minRating ?? 0;
  const batch = opts.batch ?? 50_000;
  const stats: ImportStats = { games: 0, skipped: 0 };
  let pending = new Map<string, MoveCount>();

  const flush = async () => {
    if (pending.size === 0) return;
    const rows = [...pending.values()];
    pending = new Map();
    await db.transaction(tx => addMoves(tx, 'masters', rows));
  };

  for await (const g of games) {
    if (skipReason(g, minRating)) {
      stats.skipped++;
      continue;
    }
    const counts = resultCounts(g.headers.Result as Result);
    const [we, be] = [Number(g.headers.WhiteElo), Number(g.headers.BlackElo)];
    const rated = we > 0 && be > 0;
    const board = Board.fromFen(START);
    for (const san of g.moves.slice(0, plies)) {
      const key = positionKey(board.toFen());
      const uci = playSan(board, san);
      if (!uci) break; // an illegal or unreadable move ends what we can use of this game
      const id = `${key}|${uci}`;
      const c = pending.get(id) ?? { key, uci, san: san.replace(/[+#]+$/, ''), white: 0, draws: 0, black: 0, ratingSum: 0, ratedGames: 0 };
      c.white += counts.white;
      c.draws += counts.draws;
      c.black += counts.black;
      if (rated) {
        c.ratingSum += (we + be) / 2;
        c.ratedGames++;
      }
      pending.set(id, c);
    }
    stats.games++;
    if (pending.size >= batch) await flush();
    if (stats.games % 1000 === 0) opts.onProgress?.(stats);
  }
  await flush();
  opts.onProgress?.(stats);
  return stats;
}

export interface OpeningRow {
  eco: string;
  name: string;
  /** The moves, as SAN with or without move numbers ("1. e4 e5 2. Nf3"). */
  pgn: string;
}

/** Reads a TSV of opening names with eco, name and pgn columns (a header row names them). */
export function parseOpeningsTsv(text: string): OpeningRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = (lines.shift() ?? '').split('\t').map(h => h.trim().toLowerCase());
  const [ie, iname, ipgn] = ['eco', 'name', 'pgn'].map(h => header.indexOf(h));
  if (ie! < 0 || iname! < 0 || ipgn! < 0) throw new Error('expected a header row with eco, name and pgn columns');
  return lines.flatMap(l => {
    const cols = l.split('\t');
    const [eco, name, pgn] = [cols[ie!]?.trim(), cols[iname!]?.trim(), cols[ipgn!]?.trim()];
    return eco && name && pgn ? [{ eco, name, pgn }] : [];
  });
}

/** Stores opening names by position; when two names reach the same position, the first one read is kept. */
export async function importOpenings(db: Db, rows: readonly OpeningRow[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  await db.transaction(async tx => {
    for (const r of rows) {
      const board = Board.fromFen(START);
      const sans = mainlineSans(r.pgn);
      if (sans.length === 0 || sans.some(s => !playSan(board, s))) {
        skipped++;
        continue;
      }
      const res = await tx.run('INSERT INTO openings (key, eco, name, ply) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO NOTHING', [
        positionKey(board.toFen()),
        r.eco,
        r.name,
        sans.length,
      ]);
      if (res.changes > 0) added++;
      else skipped++;
    }
  });
  return { added, skipped };
}

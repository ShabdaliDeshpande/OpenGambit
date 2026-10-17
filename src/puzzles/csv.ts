// No runtime imports: this module is shared with scripts/import-puzzles.ts,
// which Node runs directly with type stripping.
import type { Puzzle } from './types';
import type { UciMove } from '../engine/search';

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function parseUci(s: string): UciMove | null {
  const m = UCI.exec(s.trim());
  if (!m) return null;
  return { from: m[1], to: m[2], ...(m[3] ? { promotion: m[3] } : {}) } as UciMove;
}

const FEN_SHAPE = /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+$/;

/**
 * Parses one row of a puzzle CSV in the widely used column layout
 * `id,fen,moves,rating,…,themes,…`, where `moves` are space-separated UCI
 * moves and the first move is the opponent's (it sets the puzzle up).
 * Returns null for the header row or any malformed row.
 */
export function parseCsvRow(line: string): Puzzle | null {
  const cols = line.split(',');
  if (cols.length < 4) return null;
  const [id, fen, movesText, ratingText] = cols;
  const themesText = cols[7] ?? '';
  if (!id || !fen || !movesText || !FEN_SHAPE.test(fen.trim())) return null;
  const moves = movesText.trim().split(/\s+/).map(parseUci);
  if (moves.length < 2 || moves.some(m => m === null)) return null;
  const rating = Number(ratingText);
  if (!Number.isFinite(rating)) return null;
  const [setup, ...solution] = moves as UciMove[];
  return {
    id: `imp-${id.trim()}`,
    fen: fen.trim(),
    setup: setup!,
    solution,
    rating: Math.round(rating),
    themes: themesText.trim() ? themesText.trim().split(/\s+/) : [],
    source: 'imported',
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { BUILTIN_PUZZLES } from '../src/puzzles/builtin.ts';
import type { Puzzle, UciMove } from '../src/puzzles/types.ts';

/**
 * The puzzles the server can rate: the built-in set, plus an imported set
 * (public/puzzles/imported.json or dist/puzzles/imported.json) if one exists.
 */
export class PuzzleCatalogue {
  private readonly byId = new Map<string, Puzzle>();

  constructor(extra: readonly Puzzle[] = []) {
    for (const p of [...BUILTIN_PUZZLES, ...extra]) this.byId.set(p.id, p);
  }

  static load(root = process.cwd()): PuzzleCatalogue {
    for (const dir of ['dist', 'public']) {
      const file = join(root, dir, 'puzzles', 'imported.json');
      if (!existsSync(file)) continue;
      try {
        const list = JSON.parse(readFileSync(file, 'utf8')) as Puzzle[];
        return new PuzzleCatalogue(list.filter(p => p && typeof p.id === 'string' && typeof p.fen === 'string' && Array.isArray(p.solution)));
      } catch (err) {
        console.error(`Could not read ${file}:`, err);
      }
    }
    return new PuzzleCatalogue();
  }

  get(id: string): Puzzle | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /** Today's puzzle (UTC), the same for everyone: the built-in set in a fixed shuffled order. */
  daily(now: number): Puzzle {
    const day = Math.floor(now / 86_400_000);
    const list = BUILTIN_PUZZLES;
    // a fixed permutation: step through the set by a number coprime to its size
    const stride = coprimeStride(list.length);
    return list[(day * stride) % list.length]!;
  }
}

function coprimeStride(n: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  for (let s = 37; s < 37 + n; s++) if (gcd(s, n) === 1) return s;
  return 1;
}

/**
 * How much of a rating change counts when the player trained one theme: the
 * theme gives part of the answer away. No theme (a mix) counts fully.
 */
export function themeWeight(theme: string | null, win: boolean): number {
  if (!theme) return 1;
  // mates: knowing it's a mate makes the solution obvious
  if (/^mateIn\d$/.test(theme)) return win ? 0.1 : 0.4;
  // the game phase alone doesn't hint at the move
  if (theme === 'endgame') return win ? 0.7 : 0.8;
  // tactical motifs (fork, sacrifice, promotion, win material…) hint at it
  return win ? 0.2 : 0.7;
}

const same = (a: UciMove, b: UciMove) => a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

/**
 * Whether `moves` (everything played after the setup move) solves the puzzle:
 * the stored line exactly, except that any checkmate also counts on the last move.
 */
export function solves(puzzle: Puzzle, moves: readonly UciMove[]): boolean {
  if (moves.length !== puzzle.solution.length) return false;
  const chess = new Chess(puzzle.fen);
  try {
    if (puzzle.setup) chess.move(puzzle.setup);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      const expected = puzzle.solution[i]!;
      const last = i === moves.length - 1;
      chess.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
      if (!same(m, expected) && !(last && chess.isCheckmate())) return false;
    }
  } catch {
    return false;
  }
  return true;
}

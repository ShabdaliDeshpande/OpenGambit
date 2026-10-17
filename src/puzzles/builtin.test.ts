import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { BUILTIN_PUZZLES } from './builtin';
import { checkPuzzle } from './derive';

describe('built-in puzzles', () => {
  it('has a reasonable, varied set with unique ids and positions', () => {
    expect(BUILTIN_PUZZLES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BUILTIN_PUZZLES.map(p => p.id)).size).toBe(BUILTIN_PUZZLES.length);
    expect(new Set(BUILTIN_PUZZLES.map(p => p.fen.split(' ').slice(0, 4).join(' '))).size).toBe(BUILTIN_PUZZLES.length);
    const themes = new Set(BUILTIN_PUZZLES.flatMap(p => p.themes));
    for (const t of ['mateIn1', 'mateIn2', 'advantage']) expect(themes).toContain(t);
    expect(BUILTIN_PUZZLES.some(p => new Chess(p.fen).turn() === 'b')).toBe(true);
  });

  // Every solver move must be the engine's clear choice and the line must end
  // in mate or a material win. Catches any puzzle broken by an engine change.
  it.each(BUILTIN_PUZZLES.map(p => [p.id, p] as const))('%s is sound', (_id, p) => {
    expect(checkPuzzle(p).problems).toEqual([]);
  });
});

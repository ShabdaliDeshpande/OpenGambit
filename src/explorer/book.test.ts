import { describe, expect, it } from 'vitest';
import { bookApplies, BOOK_MIN_LEVEL, BOOK_PLIES, pickBookMove } from './book';

const move = (uci: string, games: number) => ({ uci, white: games, draws: 0, black: 0 });

describe('opening book', () => {
  it('picks moves in proportion to how often masters played them', () => {
    const moves = [move('e2e4', 6), move('d2d4', 3), move('g1f3', 1)];
    // r runs from 0 to 9 over the 9 counted games (g1f3 has too few)
    expect(pickBookMove(moves, () => 0)).toBe('e2e4');
    expect(pickBookMove(moves, () => 5.9 / 9)).toBe('e2e4');
    expect(pickBookMove(moves, () => 6.1 / 9)).toBe('d2d4');
    expect(pickBookMove(moves, () => 0.999)).toBe('d2d4');
  });

  it('has nothing to say without two games for a move', () => {
    expect(pickBookMove([move('e2e4', 1)])).toBeNull();
    expect(pickBookMove([])).toBeNull();
  });

  it('applies only early, from the standard start, at stronger levels', () => {
    expect(bookApplies(BOOK_MIN_LEVEL, 0, true)).toBe(true);
    expect(bookApplies(BOOK_MIN_LEVEL - 1, 0, true)).toBe(false);
    expect(bookApplies(8, BOOK_PLIES, true)).toBe(false);
    expect(bookApplies(8, 2, false)).toBe(false);
  });
});

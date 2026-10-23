import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { isStandardStart, monthOf, positionKey, START_KEY } from './key';

describe('explorer position keys', () => {
  it('drops the move counters', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(START_KEY);
    expect(positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 30')).toBe(START_KEY);
  });

  it('keeps the en-passant square only when a capture is possible', () => {
    const a = new Chess();
    a.move('e4'); // chess.js leaves "-" here, but other tools write e3
    expect(positionKey(a.fen().replace(' - ', ' e3 '))).toBe(positionKey(a.fen()));
    // 1. e4 a6 2. e5 d5: exd6 is possible, so d6 stays
    const b = new Chess();
    for (const m of ['e4', 'a6', 'e5', 'd5']) b.move(m);
    expect(positionKey(b.fen()).endsWith(' d6')).toBe(true);
  });

  it('gives transpositions the same key', () => {
    const a = new Chess();
    for (const m of ['Nf3', 'd5', 'd4']) a.move(m);
    const b = new Chess();
    for (const m of ['d4', 'd5', 'Nf3']) b.move(m);
    expect(positionKey(a.fen())).toBe(positionKey(b.fen()));
  });

  it('knows the standard start and the month of a game', () => {
    expect(isStandardStart(new Chess().fen())).toBe(true);
    expect(isStandardStart('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe(false);
    expect(monthOf(Date.UTC(2026, 9, 23))).toBe('2026-10');
  });
});

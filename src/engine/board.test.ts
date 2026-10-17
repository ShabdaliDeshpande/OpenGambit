import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Board } from './board';

function perft(b: Board, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of b.generate()) {
    if (!b.make(m)) continue;
    n += perft(b, depth - 1);
    b.unmake();
  }
  return n;
}

// Reference node counts are the standard published perft results.
describe('engine move generator (perft)', () => {
  it.each([
    ['start position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197_281],
    ['castling and pins', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97_862],
    ['en passant and checks', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43_238],
    ['promotions', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9_467],
  ])('%s', (_name, fen, depth, nodes) => {
    expect(perft(Board.fromFen(fen), depth)).toBe(nodes);
  });

  it('agrees with chess.js on legal move counts', () => {
    for (const fen of [
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
      'k7/2K5/1Q6/8/8/8/8/8 b - - 0 1',
    ])
      expect(Board.fromFen(fen).legalMoves()).toHaveLength(new Chess(fen).moves().length);
  });

  it('keeps the incremental hash in sync and restores state on unmake', () => {
    const b = Board.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const before = Array.from(b.sq);
    for (const m of b.generate()) {
      const h = b.hash;
      if (!b.make(m)) continue;
      expect(b.hashesConsistent()).toBe(true);
      b.unmake();
      expect(b.hash).toBe(h);
    }
    expect(Array.from(b.sq)).toEqual(before);
  });

  it('detects repetition', () => {
    const b = Board.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const [f, t] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1']] as const) b.playUci(f, t);
    expect(b.isRepetition()).toBe(false);
    b.playUci('f6', 'g8');
    expect(b.isRepetition()).toBe(true);
  });
});

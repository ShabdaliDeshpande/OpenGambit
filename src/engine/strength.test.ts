import { describe, expect, it } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { analyse, evaluateBoard, evaluateWhite } from './search';
import { Board } from './board';

const fakeNow = () => {
  let t = 0;
  return () => (t += 1);
};
const best = (fen: string, depth: number) => {
  const line = analyse(fen, [], { maxDepth: depth, now: fakeNow(), maxMs: 1e12 })!.lines[0]!;
  return { move: line.pv[0]!.from + line.pv[0]!.to + (line.pv[0]!.promotion ?? ''), line };
};

describe('engine search (Phase 12)', () => {
  it('only searches the first moves it is given', () => {
    const info = analyse(DEFAULT_POSITION, [], { multiPv: 3, maxDepth: 3, now: fakeNow(), maxMs: 1e12, rootMoves: [{ from: 'a2', to: 'a3' }, { from: 'h2', to: 'h4' }] })!;
    expect(info.lines.map(l => l.pv[0]!.from + l.pv[0]!.to).sort()).toEqual(['a2a3', 'h2h4']);
  });

  it('wins material with a knight fork', () => {
    // Nc7+ forks king and rook (an original position)
    expect(best('r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 w - - 0 1', 4).move).toBe('d5c7');
  });

  it('finds a mate in two that starts with a quiet move', () => {
    // 1. Ra7 (or Rb7) Kg8 2. Rb8# — the first move gives no check, which pruning must not miss
    const { move, line } = best('7k/8/8/8/8/8/8/RR4K1 w - - 0 1', 5);
    expect(line.mate).toBe(2);
    expect(['a1a7', 'b1b7']).toContain(move);
  });

  it('defends against a back-rank mate threat', () => {
    // Black threatens ...Rd1#; White must make luft or cover d1
    const { move } = best('3r2k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1', 5);
    expect(['h2h3', 'g2g3', 'h2h4', 'g2g4', 'f2f3', 'f2f4', 'c1d1', 'c1c8', 'g1f1']).toContain(move);
  });

  it('pushes a passed pawn home in a pawn race', () => {
    expect(best('8/P7/8/8/8/8/7p/K6k w - - 0 1', 3).move).toBe('a7a8q');
  });
});

describe('engine evaluation (Phase 12)', () => {
  const evalOf = (fen: string) => evaluateWhite(new Chess(fen));

  it('values a passed pawn above a blocked one', () => {
    const passed = evalOf('4k3/8/8/3P4/8/8/8/4K3 w - - 0 1');
    const blocked = evalOf('4k3/3p4/8/3P4/8/8/8/4K3 w - - 0 1');
    expect(passed).toBeGreaterThan(blocked + 100 - 20); // more than the extra black pawn alone
  });

  it('likes the bishop pair and dislikes doubled pawns', () => {
    expect(evalOf('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1')).toBeGreaterThan(evalOf('4k3/8/8/8/8/8/8/2N1KB2 w - - 0 1'));
    expect(evalOf('4k3/8/8/8/8/3P4/3P4/4K3 w - - 0 1')).toBeLessThan(evalOf('4k3/8/8/8/8/4P3/3P4/4K3 w - - 0 1'));
  });

  it('knows a lone minor piece cannot win', () => {
    expect(evalOf('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1')).toBeLessThanOrEqual(0);
    expect(evalOf('4k3/8/8/8/8/8/8/2R1K3 w - - 0 1')).toBeGreaterThan(300);
  });

  it('is symmetric apart from the move', () => {
    const b = Board.fromFen(DEFAULT_POSITION);
    expect(Math.abs(evaluateBoard(b))).toBeLessThan(30);
  });
});

describe('null move', () => {
  it('passes the turn and restores everything', () => {
    const b = Board.fromFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2');
    const [hash, hash2, ep] = [b.hash, b.hash2, b.ep];
    b.makeNull();
    expect(b.side).toBe(-1);
    expect(b.ep).toBe(-1);
    expect(b.hashesConsistent()).toBe(true);
    b.unmakeNull();
    expect([b.hash, b.hash2, b.ep, b.side]).toEqual([hash, hash2, ep, 1]);
  });

  it('knows which sides have pieces besides pawns', () => {
    const b = Board.fromFen('4k3/pppp4/8/8/8/8/8/2N1K3 w - - 0 1');
    expect(b.hasPieces(1)).toBe(true);
    expect(b.hasPieces(-1)).toBe(false);
  });
});

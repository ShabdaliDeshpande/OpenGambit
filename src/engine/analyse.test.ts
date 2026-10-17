import { describe, expect, it } from 'vitest';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { analyse, type AnalysisInfo } from './search';

/** A fake clock so depth, not wall time, bounds the tests. */
const fakeNow = () => {
  let t = 0;
  return () => (t += 1);
};

describe('engine analysis', () => {
  it('returns several distinct lines, best first, with legal principal variations', () => {
    const info = analyse(DEFAULT_POSITION, [], { multiPv: 3, maxDepth: 4, now: fakeNow(), maxMs: 1e9 })!;
    expect(info.depth).toBe(4);
    expect(info.lines).toHaveLength(3);
    const firsts = info.lines.map(l => `${l.pv[0]!.from}${l.pv[0]!.to}`);
    expect(new Set(firsts).size).toBe(3);
    const cps = info.lines.map(l => l.cp!);
    expect([...cps].sort((a, b) => b - a)).toEqual(cps); // White to move: best = highest
    for (const line of info.lines) {
      const chess = new Chess();
      for (const m of line.pv) expect(() => chess.move(m)).not.toThrow();
      expect(line.pv.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('reports scores from White’s point of view', () => {
    // Black to move and a queen up
    const info = analyse('4k3/8/8/8/8/8/8/q3K3 b - - 0 1', [], { maxDepth: 3, now: fakeNow(), maxMs: 1e9 })!;
    expect(info.lines[0]!.cp).toBeLessThan(-500);
    // Black to move, a queen down: best for Black is the least bad, i.e. the highest-for-Black score
    const lost = analyse('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1', [], { multiPv: 2, maxDepth: 3, now: fakeNow(), maxMs: 1e9 })!;
    expect(lost.lines[0]!.cp).toBeGreaterThan(500);
    expect(lost.lines[0]!.cp!).toBeLessThanOrEqual(lost.lines[1]!.cp!);
  });

  it('finds mate in two and reports it as mate, not centipawns', () => {
    const info = analyse('r5k1/5ppp/8/8/8/8/1Q6/1R4K1 w - - 0 1', [], { maxDepth: 6, now: fakeNow(), maxMs: 1e9 })!;
    expect(info.lines[0]).toMatchObject({ cp: null, mate: 2 });
    expect(info.lines[0]!.pv.map(m => m.from + m.to)).toEqual(['b2b8', 'a8b8', 'b1b8']);
  });

  it('reports a mate by Black as a negative mate count', () => {
    // Black to move plays Ra1#
    const info = analyse('r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', [], { maxDepth: 4, now: fakeNow(), maxMs: 1e9 })!;
    expect(info.lines[0]).toMatchObject({ cp: null, mate: -1 });
    expect(info.lines[0]!.pv[0]).toMatchObject({ from: 'a8', to: 'a1' });
  });

  it('returns null when there are no legal moves', () => {
    expect(analyse('k7/2K5/1Q6/8/8/8/8/8 b - - 0 1', [], { maxDepth: 2, now: fakeNow() })).toBeNull();
  });

  it('streams an update after every depth', () => {
    const seen: AnalysisInfo[] = [];
    analyse(DEFAULT_POSITION, [], { maxDepth: 3, now: fakeNow(), maxMs: 1e9, onInfo: i => seen.push(i) });
    expect(seen.map(i => i.depth)).toEqual([1, 2, 3]);
  });

  it('stops at the time limit and keeps the last completed depth', () => {
    const info = analyse(DEFAULT_POSITION, [], { maxDepth: 30, maxMs: 300 })!;
    expect(info.depth).toBeGreaterThanOrEqual(2);
    expect(info.depth).toBeLessThan(30);
  });

  it('analyses the position reached by a move list', () => {
    const info = analyse(DEFAULT_POSITION, [{ from: 'e2', to: 'e4' }], { maxDepth: 2, now: fakeNow(), maxMs: 1e9 })!;
    // Black to move: every principal variation starts with a black move
    const chess = new Chess();
    chess.move('e4');
    for (const line of info.lines) expect(chess.get(line.pv[0]!.from)?.color).toBe('b');
  });
});

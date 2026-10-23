import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { availableThreads, checkSettings, DEFAULT_SETTINGS, limitText, searchLimits } from './engineSettings';
import { lineValue, mergeInfos, splitRootMoves, threatFen } from './rootSplit';
import type { AnalysisInfo } from '../engine/search';

describe('engine settings', () => {
  it('fills in defaults and clamps what was stored', () => {
    expect(checkSettings(undefined, 4)).toEqual(DEFAULT_SETTINGS);
    const s = checkSettings({ lines: 9, seconds: 7, depth: 0, threads: 12, by: 'depth', arrows: { best: false } }, 4);
    expect(s).toMatchObject({ lines: 5, seconds: DEFAULT_SETTINGS.seconds, depth: 1, threads: 4, by: 'depth' });
    expect(s.arrows).toEqual({ best: false, threat: true, drawn: true });
    expect(checkSettings({ threads: 3 }, 1).threads).toBe(1);
  });

  it('turns settings into engine limits', () => {
    expect(searchLimits({ ...DEFAULT_SETTINGS, seconds: 8 })).toEqual({ maxMs: 8000, maxDepth: 60 });
    expect(searchLimits({ ...DEFAULT_SETTINGS, by: 'depth', depth: 12 }).maxDepth).toBe(12);
    expect(searchLimits({ ...DEFAULT_SETTINGS, infinite: true }).maxMs).toBeGreaterThan(3_600_000);
    expect(limitText({ ...DEFAULT_SETTINGS, infinite: true })).toBe('∞');
    expect(limitText({ ...DEFAULT_SETTINGS, by: 'depth', depth: 18 })).toBe('depth 18');
  });

  it('leaves one core for the page', () => {
    expect(availableThreads(8)).toBe(7);
    expect(availableThreads(1)).toBe(1);
    expect(availableThreads(64)).toBe(8);
  });
});

describe('sharing the root between workers', () => {
  const START = new Chess().fen();

  it('deals every legal move to exactly one worker', () => {
    const shares = splitRootMoves(START, 3);
    expect(shares).toHaveLength(3);
    const all = shares.flat().map(m => m.from + m.to);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
    // never more workers than moves
    expect(splitRootMoves('7k/8/8/8/8/8/6PP/7K w - - 0 1', 8).flat()).toHaveLength(splitRootMoves('7k/8/8/8/8/8/6PP/7K w - - 0 1', 8).length);
  });

  it('merges lines best first for the side to move', () => {
    const info = (depth: number, ...lines: [number | null, number | null][]): AnalysisInfo => ({
      depth,
      nodes: 100,
      elapsedMs: depth * 10,
      lines: lines.map(([cp, mate], i) => ({ pv: [{ from: 'a2', to: `a${3 + i}` }] as never, cp, mate })),
    });
    const merged = mergeInfos([info(9, [30, null], [-10, null]), info(7, [50, null]), null], 2, 'w')!;
    expect(merged.lines.map(l => l.cp)).toEqual([50, 30]);
    expect(merged.depth).toBe(7);
    expect(merged.nodes).toBe(200);
    // for Black, lower is better, and a mate for Black beats everything
    const black = mergeInfos([info(5, [30, null]), info(5, [null, -3], [-40, null])], 3, 'b')!;
    expect(black.lines.map(l => l.mate ?? l.cp)).toEqual([-3, -40, 30]);
    expect(mergeInfos([null, undefined], 3, 'w')).toBeNull();
  });

  it('ranks mates by distance', () => {
    expect(lineValue({ cp: null, mate: 2 }, 'w')).toBeGreaterThan(lineValue({ cp: null, mate: 5 }, 'w'));
    expect(lineValue({ cp: null, mate: -2 }, 'w')).toBeLessThan(lineValue({ cp: -900, mate: null }, 'w'));
  });
});

describe('threat position', () => {
  it('gives the move to the other side', () => {
    const after = new Chess();
    after.move('e4');
    expect(threatFen(after.fen())).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });

  it('is not available in check', () => {
    expect(threatFen('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1')).toBeNull();
  });
});

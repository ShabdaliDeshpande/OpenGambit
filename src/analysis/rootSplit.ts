// Analysis with several engine workers: each searches a share of the first
// moves, and their lines are merged. Workers can't share memory without
// cross-origin isolation, so splitting the root is how "threads" work here.
// Also the "threat" position: the same position with the other side to move.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import type { AnalysisInfo, AnalysisLine, UciMove } from '../engine/search';

/** Legal first moves dealt out to `n` workers in turn (captures and checks first, so each share gets some). */
export function splitRootMoves(fen: string, n: number): UciMove[][] {
  const moves = new Chess(fen).moves({ verbose: true });
  const forcing = (m: (typeof moves)[number]) => (m.captured ? 2 : 0) + (m.san.includes('+') ? 1 : 0);
  moves.sort((a, b) => forcing(b) - forcing(a));
  const shares = Math.max(1, Math.min(n, moves.length));
  const out: UciMove[][] = Array.from({ length: shares }, () => []);
  moves.forEach((m, i) => out[i % shares]!.push({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }));
  return out.filter(s => s.length > 0);
}

/** A line's value for the side to move: mates first (sooner is better), then centipawns. */
export function lineValue(line: Pick<AnalysisLine, 'cp' | 'mate'>, turn: Color): number {
  const sign = turn === 'w' ? 1 : -1;
  if (line.mate !== null) {
    const mine = line.mate * sign > 0;
    return mine ? 1_000_000 - Math.abs(line.mate) : -1_000_000 + Math.abs(line.mate);
  }
  return (line.cp ?? 0) * sign;
}

/**
 * The combined result of several workers: the best `multiPv` lines from all
 * of them, at the depth every reporting worker has completed.
 */
export function mergeInfos(infos: readonly (AnalysisInfo | null | undefined)[], multiPv: number, turn: Color): AnalysisInfo | null {
  const got = infos.filter((i): i is AnalysisInfo => !!i);
  if (got.length === 0) return null;
  const lines = got.flatMap(i => i.lines).sort((a, b) => lineValue(b, turn) - lineValue(a, turn));
  return {
    depth: Math.min(...got.map(i => i.depth)),
    lines: lines.slice(0, multiPv),
    nodes: got.reduce((s, i) => s + i.nodes, 0),
    elapsedMs: Math.max(...got.map(i => i.elapsedMs)),
  };
}

/**
 * The position as if the side to move passed, which shows what the opponent
 * threatens. Null when the side to move is in check (passing isn't possible).
 */
export function threatFen(fen: string): string | null {
  const chess = new Chess(fen);
  if (chess.inCheck() || chess.isGameOver()) return null;
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  try {
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

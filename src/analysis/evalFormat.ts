import { Chess } from 'chess.js';
import type { AnalysisLine, UciMove } from '../engine/search';

/** "+0.4", "−1.3", "#3", "#−2" (always from White's point of view). */
export function formatEval(line: Pick<AnalysisLine, 'cp' | 'mate'>): string {
  if (line.mate !== null) return line.mate > 0 ? `#${line.mate}` : `#−${-line.mate}`;
  const pawns = (line.cp ?? 0) / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
}

const STEEPNESS = 0.004;

/** White's share of the eval bar, 0..1, using a logistic curve so big leads saturate. */
export function whiteShare(line: Pick<AnalysisLine, 'cp' | 'mate'> | null | undefined): number {
  if (!line) return 0.5;
  if (line.mate !== null) return line.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-STEEPNESS * (line.cp ?? 0)));
}

/** A principal variation in SAN with move numbers, e.g. "12... Nf6 13. Bg5 h6". */
export function pvToSan(fen: string, pv: readonly UciMove[], maxMoves = 12): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  for (const [i, m] of pv.slice(0, maxMoves).entries()) {
    const white = chess.turn() === 'w';
    const n = chess.moveNumber();
    let san: string;
    try {
      san = chess.move(m).san;
    } catch {
      break;
    }
    parts.push(white ? `${n}. ${san}` : i === 0 ? `${n}... ${san}` : san);
  }
  return parts.join(' ');
}

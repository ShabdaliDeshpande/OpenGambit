// Game review: judges each move from the engine's evaluation before and after
// it. Bad moves follow lila's rules (inaccuracy, mistake and blunder by the
// drop in winning chances, special cases for forced mates); good moves are
// split into best, excellent and good. Pure functions, easy to test.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import type { AnalysisLine } from '../engine/search';

/** An evaluation from White's point of view. `mated` is a finished game: that side is checkmated. */
export type Score = { cp: number } | { mate: number } | { mated: Color };

export type Kind = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const KINDS: readonly Kind[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

export const KIND_LABEL: Record<Kind, string> = {
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};

/** Short marks shown next to moves. */
export const KIND_MARK: Record<Kind, string> = {
  best: '★',
  excellent: '✓✓',
  good: '✓',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** A finished position the engine can't search: checkmate, or a draw. */
export function finalScore(fen: string): Score {
  const chess = new Chess(fen);
  return chess.isCheckmate() ? { mated: chess.turn() } : { cp: 0 };
}

/** The score of a position from the engine's best line (or the final result when there are no moves). */
export function scoreOf(line: Pick<AnalysisLine, 'cp' | 'mate'> | undefined, fen: string): Score {
  if (!line) return finalScore(fen);
  return line.mate !== null ? { mate: line.mate } : { cp: line.cp ?? 0 };
}

/** Centipawns for `pov` (mates count as ±1000, a finished mate as ±1000 too). */
export function povCp(score: Score, pov: Color): number {
  const sign = pov === 'w' ? 1 : -1;
  if ('cp' in score) return sign * score.cp;
  if ('mate' in score) return sign * (score.mate > 0 ? 1000 : -1000);
  return score.mated === pov ? -1000 : 1000;
}

/** Winning chances for `pov` between −1 and 1 (the logistic curve lila uses). */
export function winningChances(score: Score, pov: Color): number {
  if ('mated' in score) return score.mated === pov ? -1 : 1;
  if ('mate' in score) return (score.mate > 0) === (pov === 'w') ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, povCp(score, pov)));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

/** Whether `pov` has a forced mate (or has just delivered one). */
const hasMate = (score: Score, pov: Color) =>
  ('mate' in score && (score.mate > 0) === (pov === 'w')) || ('mated' in score && score.mated !== pov);

export interface Judgement {
  kind: Kind;
  /** Drop in the mover's winning chances (0 to 2). */
  loss: number;
  /** 0–100, from the drop in win percentage (lila's accuracy curve). */
  accuracy: number;
}

/** Judges a move by `mover` that turned `before` into `after`. `playedBest`: it was the engine's top choice. */
export function judge(before: Score, after: Score, mover: Color, playedBest: boolean): Judgement {
  const cb = winningChances(before, mover);
  const ca = winningChances(after, mover);
  const loss = Math.max(0, cb - ca);
  const winDrop = Math.max(0, (50 + 50 * cb) - (50 + 50 * ca));
  const accuracy = Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * winDrop) - 3.166924740191411));

  // forced mates, as lila judges them
  const mateCreated = !hasMate(before, other(mover)) && hasMate(after, other(mover));
  const mateLost = hasMate(before, mover) && !hasMate(after, mover);
  let kind: Kind;
  if (mateCreated) {
    const was = povCp(before, mover);
    kind = was < -999 ? 'inaccuracy' : was < -700 ? 'mistake' : 'blunder';
  } else if (mateLost) {
    const now = 'cp' in after ? povCp(after, mover) : 0;
    kind = now > 999 ? 'inaccuracy' : now > 700 ? 'mistake' : 'blunder';
  } else if (loss >= 0.3) kind = 'blunder';
  else if (loss >= 0.2) kind = 'mistake';
  else if (loss >= 0.1) kind = 'inaccuracy';
  else if (playedBest || loss <= 0.01) kind = 'best';
  else if (loss < 0.04) kind = 'excellent';
  else kind = 'good';
  return { kind, loss, accuracy };
}

export interface SideSummary {
  counts: Record<Kind, number>;
  /** Average of the arithmetic and harmonic means of the move accuracies; null with no moves. */
  accuracy: number | null;
}

/** Totals per side, from the judged moves. */
export function summarize(moves: readonly { color: Color; judgement: Judgement }[]): Record<Color, SideSummary> {
  const side = (c: Color): SideSummary => {
    const mine = moves.filter(m => m.color === c).map(m => m.judgement);
    const counts = Object.fromEntries(KINDS.map(k => [k, mine.filter(j => j.kind === k).length])) as Record<Kind, number>;
    if (mine.length === 0) return { counts, accuracy: null };
    const accs = mine.map(j => Math.max(1, j.accuracy));
    const mean = accs.reduce((s, a) => s + a, 0) / accs.length;
    const harmonic = accs.length / accs.reduce((s, a) => s + 1 / a, 0);
    return { counts, accuracy: Math.round(((mean + harmonic) / 2) * 10) / 10 };
  };
  return { w: side('w'), b: side('b') };
}

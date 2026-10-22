// Puts a game review together: classifies every main-line move from the
// engine's evaluations, then works out accuracy, estimated performance, the
// split into opening / middlegame / endgame, and the key moments. Pure.

import type { Color } from 'chess.js';
import { averageCpl, gameAccuracy, whiteWinPercent } from './accuracy';
import { divide, phaseOf, PHASES, type Division, type GamePhase } from './divider';
import { materialOffered, type UciLike } from './material';
import { estimatePerformance } from './performance';
import { BAD_KINDS, classify, KINDS, type Judgement, type Kind, type Score } from './review';

/** What the engine found in one position. */
export interface PositionEval {
  score: Score;
  /** The engine's choice (null when the game is over). */
  best: UciLike | null;
  /** The score of its second choice, when there was one. */
  second: Score | null;
  /** Its main line from here, starting with `best`. */
  pv: UciLike[];
}

/** A main-line move; `ply` counts from 1. */
export interface GameMove {
  ply: number;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  uci: UciLike;
  san: string;
}

export interface ReviewedMove extends GameMove {
  judgement: Judgement;
  before: PositionEval;
  after: PositionEval;
  playedBest: boolean;
  phase: GamePhase;
}

export interface ReviewOptions {
  /** Whether a move is opening theory (Phase 13 imported data); none is until then. */
  isBook?: (fenBefore: string, move: UciLike) => boolean;
}

const sameMove = (a: UciLike | null, b: UciLike) => !!a && a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

// the sacrifice check builds many boards, and the review is recomputed as each position comes in
const offeredCache = new Map<string, number>();
function offeredBy(fen: string, move: UciLike): number {
  const key = `${fen}|${move.from}${move.to}${move.promotion ?? ''}`;
  let v = offeredCache.get(key);
  if (v === undefined) {
    v = materialOffered(fen, move);
    if (offeredCache.size > 4000) offeredCache.clear();
    offeredCache.set(key, v);
  }
  return v;
}

/** The game's FENs, index = ply. */
export const fensOf = (moves: readonly GameMove[]) => (moves.length ? [moves[0]!.fenBefore, ...moves.map(m => m.fenAfter)] : []);

/**
 * Classifies every move whose positions before and after have been analysed.
 * `evals[i]` is the evaluation after ply i (index 0 = the start position).
 */
export function reviewMoves(moves: readonly GameMove[], evals: readonly (PositionEval | undefined)[], opts: ReviewOptions = {}): ReviewedMove[] {
  const division = divide(fensOf(moves));
  const out: ReviewedMove[] = [];
  let previous: Kind | null = null;
  moves.forEach((m, i) => {
    const [before, after] = [evals[i], evals[i + 1]];
    if (!before || !after) {
      previous = null;
      return;
    }
    const playedBest = sameMove(before.best, m.uci);
    const judgement = classify({
      before: before.score,
      after: after.score,
      mover: m.color,
      playedBest,
      second: before.second,
      previous,
      book: opts.isBook?.(m.fenBefore, m.uci) ?? false,
      offered: () => offeredBy(m.fenBefore, m.uci),
    });
    out.push({ ...m, judgement, before, after, playedBest, phase: phaseOf(m.ply, division) });
    previous = judgement.kind;
  });
  return out;
}

export interface PhaseStats {
  accuracy: number | null;
  moves: number;
  /** Inaccuracies, mistakes, misses and blunders. */
  errors: number;
}

export interface SideReview {
  accuracy: number | null;
  acpl: number | null;
  /** A rough estimate, see performance.ts. */
  performance: number | null;
  counts: Record<Kind, number>;
  phases: Record<GamePhase, PhaseStats>;
}

export interface ReviewSummary {
  sides: Record<Color, SideReview>;
  division: Division;
  /** Up to 6 turning points, in game order. */
  keyMoments: ReviewedMove[];
  /** Every move has been judged. */
  complete: boolean;
}

/** The longest run of analysed positions from the start. */
function analysedPrefix(evals: readonly (PositionEval | undefined)[], total: number): Score[] {
  const out: Score[] = [];
  for (let i = 0; i <= total; i++) {
    const e = evals[i];
    if (!e) break;
    out.push(e.score);
  }
  return out;
}

export function summarizeReview(
  moves: readonly GameMove[],
  reviewed: readonly ReviewedMove[],
  evals: readonly (PositionEval | undefined)[],
  ratings: Record<Color, number | null> = { w: null, b: null },
): ReviewSummary {
  const division = divide(fensOf(moves));
  const firstMover: Color = moves[0]?.color ?? 'w';
  const scores = analysedPrefix(evals, moves.length);
  const win = scores.map(whiteWinPercent);
  const accuracy = gameAccuracy(win, firstMover);
  const acpl = averageCpl(scores, firstMover);

  const phaseAccuracy = (phase: GamePhase): Record<Color, number | null> => {
    const plies = moves.filter(m => m.ply < win.length && phaseOf(m.ply, division) === phase).map(m => m.ply);
    if (plies.length === 0) return { w: null, b: null };
    const [first, last] = [plies[0]!, plies[plies.length - 1]!];
    return gameAccuracy(win.slice(first - 1, last + 1), moves[first - 1]!.color);
  };
  const byPhase = Object.fromEntries(PHASES.map(p => [p, phaseAccuracy(p)])) as Record<GamePhase, Record<Color, number | null>>;

  const side = (c: Color): SideReview => {
    const mine = reviewed.filter(m => m.color === c);
    const counts = Object.fromEntries(KINDS.map(k => [k, mine.filter(m => m.judgement.kind === k).length])) as Record<Kind, number>;
    const phases = Object.fromEntries(
      PHASES.map(p => {
        const inPhase = mine.filter(m => m.phase === p);
        return [p, { accuracy: byPhase[p][c], moves: inPhase.length, errors: inPhase.filter(m => BAD_KINDS.includes(m.judgement.kind)).length }];
      }),
    ) as Record<GamePhase, PhaseStats>;
    const opponent = ratings[c === 'w' ? 'b' : 'w'];
    return { accuracy: accuracy[c], acpl: acpl[c], performance: estimatePerformance(accuracy[c], mine.length, opponent), counts, phases };
  };

  return { sides: { w: side('w'), b: side('b') }, division, keyMoments: keyMoments(reviewed), complete: reviewed.length === moves.length };
}

/** The biggest errors (a drop of 0.1 or more), plus brilliant and great moves; at most 6, in game order. */
export function keyMoments(reviewed: readonly ReviewedMove[], max = 6): ReviewedMove[] {
  const good = reviewed.filter(m => m.judgement.kind === 'brilliant' || m.judgement.kind === 'great');
  const bad = reviewed
    .filter(m => BAD_KINDS.includes(m.judgement.kind) && m.judgement.loss >= 0.1)
    .sort((a, b) => b.judgement.loss - a.judgement.loss);
  const picked = [...good.slice(0, 2), ...bad].slice(0, max);
  return picked.sort((a, b) => a.ply - b.ply);
}

export const PHASE_LABEL: Record<GamePhase, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

/** Move number text for a ply: "12." for White, "12…" for Black. */
export const moveNumber = (m: Pick<GameMove, 'ply' | 'color' | 'fenBefore'>) => {
  const full = Number(m.fenBefore.split(' ')[5] ?? '1');
  return m.color === 'w' ? `${full}.` : `${full}…`;
};

/** One sentence per side about its phases: where it played best, and its biggest error. */
export function phaseSummary(summary: ReviewSummary, reviewed: readonly ReviewedMove[], names: Record<Color, string>): string[] {
  return (['w', 'b'] as const).flatMap(c => {
    const phases = PHASES.filter(p => summary.sides[c].phases[p].accuracy !== null && summary.sides[c].phases[p].moves >= 3);
    if (phases.length === 0) return [];
    const best = phases.reduce((a, b) => (summary.sides[c].phases[b].accuracy! > summary.sides[c].phases[a].accuracy! ? b : a));
    const worst = reviewed
      .filter(m => m.color === c && BAD_KINDS.includes(m.judgement.kind))
      .sort((a, b) => b.judgement.loss - a.judgement.loss)[0];
    const first = `${names[c]} played the ${best} best (${Math.round(summary.sides[c].phases[best].accuracy!)}%)`;
    if (!worst) return [`${first}, with no inaccuracies or worse.`];
    return [`${first}; the costliest move was ${moveNumber(worst)} ${worst.san} in the ${worst.phase}.`];
  });
}

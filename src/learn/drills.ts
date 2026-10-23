// Timed drills: short sets of one-move answers against the clock. The
// positions come from the app's own built-in puzzles, which were derived and
// checked by the engine (src/puzzles/builtin.ts). Pure.

import { BUILTIN_PUZZLES } from '../puzzles/builtin';
import type { UciMove } from '../puzzles/types';

export interface DrillPosition {
  id: string;
  fen: string;
  answer: UciMove;
}

export interface Drill {
  id: string;
  title: string;
  description: string;
  positions: DrillPosition[];
  /** How many positions one run uses. */
  size: number;
}

/** Seconds added for each wrong answer. */
export const PENALTY_MS = 5_000;

const pick = (test: (themes: string[], length: number) => boolean): DrillPosition[] =>
  BUILTIN_PUZZLES.filter(p => !p.setup && test(p.themes, p.solution.length)).map(p => ({ id: p.id, fen: p.fen, answer: p.solution[0]! }));

export const DRILLS: readonly Drill[] = [
  {
    id: 'mate-in-one',
    title: 'Mate in one',
    description: 'Find the checkmate, as fast as you can.',
    positions: pick((t, n) => n === 1 && t.includes('mateIn1')),
    size: 10,
  },
  {
    id: 'win-material',
    title: 'Win material',
    description: 'Each position has one move that wins material. Spot it quickly.',
    positions: pick((t, n) => n === 1 && t.includes('advantage')),
    size: 10,
  },
  {
    id: 'forks',
    title: 'Find the fork',
    description: 'Find the move that attacks two things at once.',
    positions: pick(t => t.includes('fork')),
    size: 8,
  },
];

export interface DrillRun {
  drill: Drill;
  /** Indices into drill.positions, in the order of this run. */
  order: number[];
  index: number;
  correct: number;
  wrong: number;
  startedAt: number;
  finishedAt: number | null;
  /** The answer to the position just played, shown briefly. */
  last: { ok: boolean; answer: UciMove } | null;
}

export function startDrill(drill: Drill, now: number, rng: () => number = Math.random): DrillRun {
  const order = drill.positions.map((_p, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { drill, order: order.slice(0, Math.min(drill.size, order.length)), index: 0, correct: 0, wrong: 0, startedAt: now, finishedAt: null, last: null };
}

export const currentPosition = (r: DrillRun): DrillPosition | null => (r.finishedAt === null ? (r.drill.positions[r.order[r.index]!] ?? null) : null);

const same = (a: UciMove, uci: string) => a.from + a.to + (a.promotion ?? '') === uci;

/** Answers the current position; a wrong move costs PENALTY_MS and moves on. */
export function drillMove(r: DrillRun, uci: string, now: number): DrillRun {
  const pos = currentPosition(r);
  if (!pos) return r;
  // a promotion counts with any piece only if the answer isn't a promotion; otherwise it must match
  const ok = same(pos.answer, uci) || (!pos.answer.promotion && same(pos.answer, uci.slice(0, 4)));
  const index = r.index + 1;
  return {
    ...r,
    index,
    correct: r.correct + (ok ? 1 : 0),
    wrong: r.wrong + (ok ? 0 : 1),
    finishedAt: index >= r.order.length ? now : null,
    last: { ok, answer: pos.answer },
  };
}

/** The run's score: time taken plus penalties (lower is better). */
export const drillTime = (r: DrillRun, now: number) => (r.finishedAt ?? now) - r.startedAt + r.wrong * PENALTY_MS;

/** "1:05.3". */
export function timeText(ms: number): string {
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

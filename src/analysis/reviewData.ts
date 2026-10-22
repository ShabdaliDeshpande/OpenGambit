// The saved form of a game review, shared by the browser (which runs the
// engine and posts it) and the server (which checks it and stores it with the
// game). Only `.ts` imports with no browser APIs, so Node can run it too.

import { gameAccuracy, whiteWinPercent, type Score, type Side } from './accuracy.ts';
import { estimatePerformance } from './performance.ts';

export const REVIEW_VERSION = 1;

/** One letter per move class. */
export const KIND_CODE = {
  brilliant: 'B',
  great: 'G',
  best: 'S',
  excellent: 'E',
  good: 'O',
  book: 'K',
  inaccuracy: 'I',
  mistake: 'M',
  miss: 'X',
  blunder: 'U',
} as const;

export type KindName = keyof typeof KIND_CODE;

const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, c]) => [c, k])) as Record<string, KindName>;

export const kindOfCode = (code: string): KindName | null => CODE_KIND[code] ?? null;

export interface UciText {
  from: string;
  to: string;
  promotion?: string;
}

/** One analysed position: score, best move, second-best score, main line (UCI, space-separated). */
export interface StoredPosition {
  s: string;
  b?: string;
  s2?: string;
  pv?: string;
}

export interface StoredReview {
  v: typeof REVIEW_VERSION;
  /** Which engine and settings produced it. */
  engine: string;
  /** Engine time per position, in milliseconds. */
  ms: number;
  /** One per position, the first before any move. */
  positions: StoredPosition[];
  /** One class letter per move. */
  kinds: string;
}

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export const encodeUci = (m: UciText) => m.from + m.to + (m.promotion ?? '');

export function decodeUci(text: string): UciText | null {
  if (!UCI.test(text)) return null;
  return { from: text.slice(0, 2), to: text.slice(2, 4), ...(text[4] ? { promotion: text[4] } : {}) };
}

/** "c:34" (centipawns), "m:-3" (mate in 3 for Black), "x:w" (White is checkmated). */
export function encodeScore(s: Score): string {
  if ('cp' in s) return `c:${Math.round(s.cp)}`;
  if ('mate' in s) return `m:${s.mate}`;
  return `x:${s.mated}`;
}

export function decodeScore(text: string): Score | null {
  const m = /^(c|m|x):(-?\d{1,6}|w|b)$/.exec(text);
  if (!m) return null;
  if (m[1] === 'x') return m[2] === 'w' || m[2] === 'b' ? { mated: m[2] } : null;
  const n = Number(m[2]);
  if (!Number.isInteger(n)) return null;
  if (m[1] === 'm') return n === 0 || Math.abs(n) > 500 ? null : { mate: n };
  return Math.abs(n) > 100_000 ? null : { cp: n };
}

const MAX_PV = 10;

/** Checks a posted review against the stored game's length; returns it cleaned, or why it's refused. */
export function checkReview(value: unknown, plies: number): StoredReview | string {
  if (!value || typeof value !== 'object') return 'A review must be an object.';
  const r = value as Record<string, unknown>;
  if (r.v !== REVIEW_VERSION) return 'Unknown review version.';
  if (typeof r.engine !== 'string' || r.engine.length === 0 || r.engine.length > 40) return 'Say which engine made the review.';
  if (!Number.isInteger(r.ms) || (r.ms as number) < 50 || (r.ms as number) > 600_000) return 'Engine time per position is out of range.';
  if (!Array.isArray(r.positions) || r.positions.length !== plies + 1) return 'The review must cover every position of the game.';
  if (typeof r.kinds !== 'string' || r.kinds.length !== plies || [...r.kinds].some(c => !kindOfCode(c))) return 'The review must classify every move.';
  const positions: StoredPosition[] = [];
  for (const p of r.positions as unknown[]) {
    if (!p || typeof p !== 'object') return 'Each position must be an object.';
    const q = p as Record<string, unknown>;
    if (typeof q.s !== 'string' || !decodeScore(q.s)) return 'A position has no valid score.';
    const out: StoredPosition = { s: q.s };
    if (q.b !== undefined) {
      if (typeof q.b !== 'string' || !decodeUci(q.b)) return 'A best move isn’t valid.';
      out.b = q.b;
    }
    if (q.s2 !== undefined) {
      if (typeof q.s2 !== 'string' || !decodeScore(q.s2)) return 'A second score isn’t valid.';
      out.s2 = q.s2;
    }
    if (q.pv !== undefined) {
      const moves = typeof q.pv === 'string' ? q.pv.split(' ').filter(Boolean) : null;
      if (!moves || moves.length > MAX_PV || moves.some(m => !decodeUci(m))) return 'A line isn’t valid.';
      out.pv = moves.join(' ');
    }
    positions.push(out);
  }
  return { v: REVIEW_VERSION, engine: r.engine, ms: r.ms as number, positions, kinds: r.kinds };
}

/** Accuracy and estimated performance per side, worked out from the review's scores. */
export function reviewStats(review: StoredReview, firstMover: Side = 'w', ratings: Record<Side, number | null> = { w: null, b: null }) {
  const scores = review.positions.map(p => decodeScore(p.s)!);
  const accuracy = gameAccuracy(scores.map(whiteWinPercent), firstMover);
  const plies = review.kinds.length;
  const movesOf = (side: Side) => Math.floor((plies + (side === firstMover ? 1 : 0)) / 2);
  const performance = {
    w: estimatePerformance(accuracy.w, movesOf('w'), ratings.b),
    b: estimatePerformance(accuracy.b, movesOf('b'), ratings.w),
  };
  return { accuracy, performance };
}

/** Counts of each class per side, from the class letters. */
export function kindCounts(kinds: string, firstMover: Side = 'w'): Record<Side, Partial<Record<KindName, number>>> {
  const out: Record<Side, Partial<Record<KindName, number>>> = { w: {}, b: {} };
  [...kinds].forEach((c, i) => {
    const kind = kindOfCode(c);
    if (!kind) return;
    const side: Side = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b';
    out[side][kind] = (out[side][kind] ?? 0) + 1;
  });
  return out;
}

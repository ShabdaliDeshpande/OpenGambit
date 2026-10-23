// Turns a finished review into the saved form posted to the server, and back.

import type { PositionEval, ReviewedMove } from './gameReview.ts';
import { decodeScore, decodeUci, encodeScore, encodeUci, KIND_CODE, REVIEW_VERSION, type StoredPosition, type StoredReview } from './reviewData.ts';
import type { UciLike } from './material.ts';

const encodePosition = (e: PositionEval): StoredPosition => ({
  s: encodeScore(e.score),
  ...(e.best ? { b: encodeUci(e.best) } : {}),
  ...(e.second ? { s2: encodeScore(e.second) } : {}),
  ...(e.pv.length ? { pv: e.pv.slice(0, 10).map(encodeUci).join(' ') } : {}),
});

/** The saved form of a complete review: one evaluation per position and one class per move. */
export function toStoredReview(evals: readonly PositionEval[], reviewed: readonly ReviewedMove[], engine: string, ms: number): StoredReview {
  return {
    v: REVIEW_VERSION,
    engine,
    ms,
    positions: evals.map(encodePosition),
    kinds: reviewed.map(m => KIND_CODE[m.judgement.kind]).join(''),
  };
}

/** The evaluations of a saved review, ready to seed the review hook. */
export function fromStoredReview(review: StoredReview): PositionEval[] {
  return review.positions.map(p => ({
    score: decodeScore(p.s) ?? { cp: 0 },
    best: p.b ? decodeUci(p.b) : null,
    second: p.s2 ? decodeScore(p.s2) : null,
    pv: (p.pv ?? '')
      .split(' ')
      .map(decodeUci)
      .filter((m): m is UciLike => m !== null),
  }));
}

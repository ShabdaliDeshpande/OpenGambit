import { Chess } from 'chess.js';
import type { Score } from '../analysis/accuracy';
import { scoreOf } from '../analysis/review';
import type { EngineRequest, EngineResponse } from '../engine/protocol';
import type { UciMove } from '../engine/search';
import { createEngineWorker } from './useEngine';

export interface OnceResult {
  score: Score;
  /** The engine's main line from the position (empty when the game is over). */
  pv: UciMove[];
  /** The score of the engine's second choice, when more than one line was asked for and there was one. */
  second: Score | null;
}

/** Analyses one position (reached by `moves` from `startFen`) with a fresh engine worker, then closes it. */
export function analyseOnce(startFen: string, moves: readonly UciMove[], maxMs: number, multiPv = 1): { promise: Promise<OnceResult>; cancel: () => void } {
  // the position itself, to score a finished game
  const chess = new Chess(startFen);
  for (const m of moves) chess.move(m);
  const fen = chess.fen();
  const worker = createEngineWorker();
  let settle: (r: OnceResult) => void = () => {};
  const promise = new Promise<OnceResult>(resolve => {
    settle = resolve;
  });
  worker.onmessage = (e: MessageEvent<EngineResponse>) => {
    const msg = e.data;
    if (msg.id !== 1 || (msg.type !== 'done' && msg.type !== 'error')) return;
    worker.terminate();
    const [line, next] = msg.type === 'done' ? (msg.info?.lines ?? []) : [];
    settle({ score: scoreOf(line, fen), pv: line?.pv ?? [], second: next ? scoreOf(next, fen) : null });
  };
  const req: EngineRequest = { type: 'analyse', id: 1, startFen, moves: [...moves], multiPv, maxDepth: 30, maxMs };
  worker.postMessage(req);
  return { promise, cancel: () => worker.terminate() };
}

/** Evaluates one position with a fresh engine worker, then closes it. */
export function evaluateOnce(fen: string, maxMs: number): { promise: Promise<Score>; cancel: () => void } {
  const job = analyseOnce(fen, [], maxMs);
  return { promise: job.promise.then(r => r.score), cancel: job.cancel };
}

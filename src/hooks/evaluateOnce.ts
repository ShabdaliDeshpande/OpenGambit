import type { Score } from '../analysis/accuracy';
import { scoreOf } from '../analysis/review';
import type { EngineRequest, EngineResponse } from '../engine/protocol';
import { createEngineWorker } from './useEngine';

/** Evaluates one position with a fresh engine worker, then closes it. */
export function evaluateOnce(fen: string, maxMs: number): { promise: Promise<Score>; cancel: () => void } {
  const worker = createEngineWorker();
  let settle: (s: Score) => void = () => {};
  const promise = new Promise<Score>(resolve => {
    settle = resolve;
  });
  worker.onmessage = (e: MessageEvent<EngineResponse>) => {
    const msg = e.data;
    if (msg.id !== 1 || (msg.type !== 'done' && msg.type !== 'error')) return;
    worker.terminate();
    settle(scoreOf(msg.type === 'done' ? msg.info?.lines[0] : undefined, fen));
  };
  const req: EngineRequest = { type: 'analyse', id: 1, startFen: fen, moves: [], multiPv: 1, maxDepth: 16, maxMs };
  worker.postMessage(req);
  return { promise, cancel: () => worker.terminate() };
}

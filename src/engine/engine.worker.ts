import { Chess } from 'chess.js';
import { analyse, chooseMove } from './search';
import type { EngineRequest, EngineResponse } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<EngineRequest>) => void) | null;
  postMessage(msg: EngineResponse): void;
}

const scope = self as unknown as WorkerScope;

// Searches run synchronously, so a search cannot be interrupted by a message;
// the main thread stops one by terminating the worker.
scope.onmessage = e => {
  const req = e.data;
  try {
    if (req.type === 'move') {
      const chess = new Chess(req.startFen);
      for (const m of req.moves) chess.move(m);
      scope.postMessage({ type: 'move', id: req.id, move: chooseMove(chess, req.level) });
    } else {
      const info = analyse(req.startFen, req.moves, {
        multiPv: req.multiPv,
        maxDepth: req.maxDepth,
        maxMs: req.maxMs,
        onInfo: i => scope.postMessage({ type: 'info', id: req.id, info: i }),
      });
      scope.postMessage({ type: 'done', id: req.id, info });
    }
  } catch (err) {
    scope.postMessage({ type: 'error', id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};

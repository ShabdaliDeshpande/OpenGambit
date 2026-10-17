import { useCallback, useEffect, useRef } from 'react';
import type { EngineResponse, MoveRequest } from '../engine/protocol';
import type { EngineMove } from '../engine/search';

/** Minimum time before an engine move is shown, so replies never feel instant. */
const MIN_REPLY_MS = 350;

type Pending = { resolve: (m: EngineMove | null) => void; reject: (e: Error) => void };

export const createEngineWorker = () =>
  new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' });

/**
 * Owns one engine Web Worker for play. `requestMove` resolves with the
 * engine's move; `cancel` drops any outstanding request (its promise never settles).
 */
export function useEngine() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = createEngineWorker();
      worker.onmessage = (e: MessageEvent<EngineResponse>) => {
        const msg = e.data;
        const p = pending.current.get(msg.id);
        if (!p) return;
        if (msg.type === 'move') p.resolve(msg.move);
        else if (msg.type === 'error') p.reject(new Error(msg.error));
        else return;
        pending.current.delete(msg.id);
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.current.clear();
    },
    [],
  );

  const requestMove = useCallback(
    (req: Omit<MoveRequest, 'id' | 'type'>): Promise<EngineMove | null> => {
      const id = nextId.current++;
      const started = performance.now();
      const reply = new Promise<EngineMove | null>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        getWorker().postMessage({ ...req, type: 'move', id } satisfies MoveRequest);
      });
      return reply.then(
        move =>
          new Promise(resolve =>
            setTimeout(() => resolve(move), Math.max(0, MIN_REPLY_MS - (performance.now() - started))),
          ),
      );
    },
    [getWorker],
  );

  /** Forget outstanding requests. A search already running finishes in the background and is ignored. */
  const cancel = useCallback(() => pending.current.clear(), []);

  return { requestMove, cancel };
}

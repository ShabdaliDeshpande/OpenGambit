import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { PositionEval } from '../analysis/gameReview';
import { finalScore, scoreOf } from '../analysis/review';
import { movesAlong, type TreeNode } from '../analysis/tree';
import type { EngineRequest, EngineResponse } from '../engine/protocol';
import { createEngineWorker } from './useEngine';

export type { PositionEval } from '../analysis/gameReview';

/** Engine time per position in a review. */
export const REVIEW_MS = 600;

/** Names the engine settings saved with a review. */
export const REVIEW_ENGINE = 'opengambit-1 multipv2';

/** Moves kept from each engine line (enough for explanations). */
const PV_KEEP = 8;

export interface ReviewPosition {
  /** Path ids joined by spaces ('' = start position). */
  key: string;
  path: string[];
  node: TreeNode;
}

/** The start position and every position along the main line. */
export function mainlinePositions(root: TreeNode): ReviewPosition[] {
  const out: ReviewPosition[] = [{ key: '', path: [], node: root }];
  let node = root;
  let path: string[] = [];
  while (node.children[0]) {
    node = node.children[0];
    path = [...path, node.id];
    out.push({ key: path.join(' '), path, node });
  }
  return out;
}

/**
 * Runs the engine over every position of the main line, a few in parallel,
 * with two lines each (the second tells "only moves" apart), and keeps the
 * results keyed by start position and path, so a reloaded or extended game
 * reuses what was already analysed.
 */
export function useGameReview(root: TreeNode) {
  const [evals, setEvals] = useState<ReadonlyMap<string, PositionEval>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workers = useRef<Worker[]>([]);
  const base = root.fen;

  const stop = useCallback(() => {
    for (const w of workers.current) w.terminate();
    workers.current = [];
    setProgress(null);
  }, []);

  useEffect(() => stop, [stop]);

  const keyOf = useCallback((p: ReviewPosition) => `${base}|${p.key}`, [base]);

  const start = useCallback(() => {
    stop();
    const positions = mainlinePositions(root);
    const found = new Map(evals);
    const todo: ReviewPosition[] = [];
    for (const p of positions) {
      if (found.has(keyOf(p))) continue;
      const chess = new Chess(p.node.fen);
      if (chess.moves().length === 0) found.set(keyOf(p), { score: finalScore(p.node.fen), best: null, second: null, pv: [] });
      else todo.push(p);
    }
    setEvals(found);
    if (todo.length === 0) return;

    let done = 0;
    const total = todo.length;
    setProgress({ done, total });
    const queue = [...todo];
    const size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 2) - 1, queue.length));
    let nextId = 1;

    const runNext = (w: Worker) => {
      const p = queue.shift();
      if (!p) {
        w.terminate();
        workers.current = workers.current.filter(x => x !== w);
        if (workers.current.length === 0) setProgress(null);
        return;
      }
      const id = nextId++;
      w.onmessage = (e: MessageEvent<EngineResponse>) => {
        const msg = e.data;
        if (msg.id !== id || (msg.type !== 'done' && msg.type !== 'error')) return;
        const [first, second] = msg.type === 'done' ? (msg.info?.lines ?? []) : [];
        const result: PositionEval = {
          score: scoreOf(first, p.node.fen),
          best: first?.pv[0] ?? null,
          second: second ? scoreOf(second, p.node.fen) : null,
          pv: first?.pv.slice(0, PV_KEEP) ?? [],
        };
        setEvals(prev => new Map(prev).set(keyOf(p), result));
        setProgress({ done: ++done, total });
        runNext(w);
      };
      const req: EngineRequest = { type: 'analyse', id, startFen: base, moves: movesAlong(root, p.path), multiPv: 2, maxDepth: 16, maxMs: REVIEW_MS };
      w.postMessage(req);
    };

    for (let i = 0; i < size; i++) {
      const w = createEngineWorker();
      workers.current.push(w);
      runNext(w);
    }
  }, [root, base, evals, keyOf, stop]);

  /** Loads evaluations saved earlier (one per main-line position, in order). */
  const seed = useCallback(
    (saved: readonly PositionEval[]) => {
      const positions = mainlinePositions(root);
      if (saved.length !== positions.length) return false;
      setEvals(prev => {
        const next = new Map(prev);
        positions.forEach((p, i) => next.set(keyOf(p), saved[i]!));
        return next;
      });
      return true;
    },
    [root, keyOf],
  );

  const evalAt = useCallback((p: ReviewPosition) => evals.get(keyOf(p)), [evals, keyOf]);

  return { evalAt, progress, start, stop, seed };
}

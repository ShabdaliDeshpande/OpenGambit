import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { finalScore, scoreOf, type Score } from '../analysis/review';
import { movesAlong, type TreeNode } from '../analysis/tree';
import type { EngineRequest, EngineResponse } from '../engine/protocol';
import type { UciMove } from '../engine/search';
import { createEngineWorker } from './useEngine';

/** Engine time per position in a review. */
const REVIEW_MS = 600;

export interface PositionEval {
  score: Score;
  /** The engine's choice in this position (null when the game is over). */
  best: UciMove | null;
}

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
 * and keeps the results (keyed by start position and path, so a reloaded or
 * extended game reuses what was already analysed).
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
      if (chess.moves().length === 0) found.set(keyOf(p), { score: finalScore(p.node.fen), best: null });
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
        const line = msg.type === 'done' ? msg.info?.lines[0] : undefined;
        const result: PositionEval = { score: scoreOf(line, p.node.fen), best: line?.pv[0] ?? null };
        setEvals(prev => new Map(prev).set(keyOf(p), result));
        setProgress({ done: ++done, total });
        runNext(w);
      };
      const req: EngineRequest = { type: 'analyse', id, startFen: base, moves: movesAlong(root, p.path), multiPv: 1, maxDepth: 16, maxMs: REVIEW_MS };
      w.postMessage(req);
    };

    for (let i = 0; i < size; i++) {
      const w = createEngineWorker();
      workers.current.push(w);
      runNext(w);
    }
  }, [root, base, evals, keyOf, stop]);

  const evalAt = useCallback((p: ReviewPosition) => evals.get(keyOf(p)), [evals, keyOf]);

  return { evalAt, progress, start, stop };
}

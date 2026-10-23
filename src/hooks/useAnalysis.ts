import { useEffect, useState } from 'react';
import type { Color } from 'chess.js';
import type { AnalyseRequest, EngineResponse } from '../engine/protocol';
import type { AnalysisInfo, UciMove } from '../engine/search';
import { mergeInfos, splitRootMoves } from '../analysis/rootSplit';
import { createEngineWorker } from './useEngine';

export interface AnalysisState {
  info: AnalysisInfo | null;
  running: boolean;
  error: string | null;
}

export interface AnalysisTarget {
  startFen: string;
  moves: UciMove[];
  /** The position reached, needed to share the first moves between workers. */
  fen: string;
  /** Changes whenever the analysed position changes. */
  key: string;
}

const IDLE: AnalysisState = { info: null, running: false, error: null };

/**
 * Streams engine analysis for `target` while `enabled`. Each new position
 * gets fresh workers; the previous ones are terminated, which is the only way
 * to stop a synchronous search. With several `threads`, each worker searches a
 * share of the first moves and the lines are merged.
 */
export function useAnalysis(
  target: AnalysisTarget,
  enabled: boolean,
  { multiPv = 3, maxDepth = 30, maxMs = 15_000, threads = 1 } = {},
): AnalysisState {
  const [state, setState] = useState<AnalysisState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    setState({ info: null, running: true, error: null });
    const turn: Color = target.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    // one worker searches everything when there's nothing to share (or no moves at all)
    const split = threads > 1 ? splitRootMoves(target.fen, threads) : [];
    const shares = split.length > 1 ? split : [null];
    const infos: (AnalysisInfo | null)[] = shares.map(() => null);
    const done = shares.map(() => false);
    const workers = shares.map((share, i) => {
      const worker = createEngineWorker();
      worker.onmessage = (e: MessageEvent<EngineResponse>) => {
        const msg = e.data;
        if (msg.type === 'error') return setState(s => ({ ...s, running: false, error: msg.error }));
        if (msg.type !== 'info' && msg.type !== 'done') return;
        if (msg.info) infos[i] = msg.info;
        if (msg.type === 'done') done[i] = true;
        const running = done.some(d => !d);
        setState(s => ({ info: mergeInfos(infos, multiPv, turn) ?? s.info, running, error: null }));
      };
      worker.postMessage({
        type: 'analyse',
        id: 1,
        startFen: target.startFen,
        moves: target.moves,
        multiPv,
        maxDepth,
        maxMs,
        ...(share ? { rootMoves: share } : {}),
      } satisfies AnalyseRequest);
      return worker;
    });
    return () => workers.forEach(w => w.terminate());
    // `key` identifies the position; startFen/moves/fen are derived from it
  }, [target.key, enabled, multiPv, maxDepth, maxMs, threads]);

  return state;
}

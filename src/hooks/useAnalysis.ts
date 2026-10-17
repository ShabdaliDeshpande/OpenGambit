import { useEffect, useState } from 'react';
import type { AnalyseRequest, EngineResponse } from '../engine/protocol';
import type { AnalysisInfo, UciMove } from '../engine/search';
import { createEngineWorker } from './useEngine';

export interface AnalysisState {
  info: AnalysisInfo | null;
  running: boolean;
  error: string | null;
}

export interface AnalysisTarget {
  startFen: string;
  moves: UciMove[];
  /** Changes whenever the analysed position changes. */
  key: string;
}

const IDLE: AnalysisState = { info: null, running: false, error: null };

/**
 * Streams engine analysis for `target` while `enabled`. Each new position
 * gets a fresh worker; the previous one is terminated, which is the only way
 * to stop a synchronous search.
 */
export function useAnalysis(
  target: AnalysisTarget,
  enabled: boolean,
  { multiPv = 3, maxDepth = 30, maxMs = 15_000 } = {},
): AnalysisState {
  const [state, setState] = useState<AnalysisState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    setState({ info: null, running: true, error: null });
    const worker = createEngineWorker();
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const msg = e.data;
      if (msg.type === 'info') setState({ info: msg.info, running: true, error: null });
      else if (msg.type === 'done') setState(s => ({ info: msg.info ?? s.info, running: false, error: null }));
      else if (msg.type === 'error') setState(s => ({ ...s, running: false, error: msg.error }));
    };
    worker.postMessage({
      type: 'analyse',
      id: 1,
      startFen: target.startFen,
      moves: target.moves,
      multiPv,
      maxDepth,
      maxMs,
    } satisfies AnalyseRequest);
    return () => worker.terminate();
    // `key` identifies the position; startFen/moves are derived from it
  }, [target.key, enabled, multiPv, maxDepth, maxMs]);

  return state;
}

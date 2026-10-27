import type { AnalysisInfo, EngineMove, Level, UciMove } from './search.ts';

/** Ask for a move to play (vs Computer). */
export interface MoveRequest {
  type: 'move';
  id: number;
  startFen: string;
  moves: UciMove[];
  level: number;
  /** Custom settings (a bot's strength and style) instead of a numbered level. */
  settings?: Level;
}

/** Analyse a position; the worker streams `info` after each depth, then `done`. */
export interface AnalyseRequest {
  type: 'analyse';
  id: number;
  startFen: string;
  moves: UciMove[];
  multiPv: number;
  maxDepth: number;
  maxMs: number;
  /** Only search these first moves (this worker's share when several share the analysis). */
  rootMoves?: UciMove[];
}

export type EngineRequest = MoveRequest | AnalyseRequest;

export type EngineResponse =
  | { type: 'move'; id: number; move: EngineMove | null }
  | { type: 'info'; id: number; info: AnalysisInfo }
  | { type: 'done'; id: number; info: AnalysisInfo | null }
  | { type: 'error'; id: number; error: string };

import type { UciMove } from '../engine/search';
import {
  addMove,
  deleteAt,
  emptyTree,
  lineEnd,
  makeMainline,
  nodeAt,
  promoteVariation,
  setComment,
  toggleNag,
  type GameTree,
} from './tree';

export interface AnalysisState {
  tree: GameTree;
  /** Path of the node shown on the board. */
  path: string[];
}

export type AnalysisAction =
  | { type: 'load'; tree: GameTree }
  | { type: 'play'; moves: (UciMove | string)[] }
  | { type: 'goto'; path: string[] }
  | { type: 'prev' }
  | { type: 'next' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'delete' }
  | { type: 'promote' }
  | { type: 'mainline' }
  | { type: 'comment'; text: string }
  | { type: 'nag'; nag: number };

export const initialAnalysis = (): AnalysisState => ({ tree: emptyTree(), path: [] });

const withRoot = (s: AnalysisState, root: GameTree['root']): AnalysisState =>
  root === s.tree.root ? s : { ...s, tree: { ...s.tree, root } };

export function analysisReducer(s: AnalysisState, a: AnalysisAction): AnalysisState {
  const { root } = s.tree;
  switch (a.type) {
    case 'load':
      return { tree: a.tree, path: [] };
    case 'play': {
      let r = root;
      let path = s.path;
      try {
        for (const m of a.moves) ({ root: r, path } = addMove(r, path, m));
      } catch {
        return s; // illegal move: ignore
      }
      return { tree: { ...s.tree, root: r }, path };
    }
    case 'goto':
      return nodeAt(root, a.path) ? { ...s, path: [...a.path] } : s;
    case 'prev':
      return s.path.length ? { ...s, path: s.path.slice(0, -1) } : s;
    case 'next': {
      const next = nodeAt(root, s.path)?.children[0];
      return next ? { ...s, path: [...s.path, next.id] } : s;
    }
    case 'first':
      return { ...s, path: [] };
    case 'last':
      return { ...s, path: lineEnd(root, s.path) };
    case 'delete':
      if (!s.path.length) return s;
      return { tree: { ...s.tree, root: deleteAt(root, s.path) }, path: s.path.slice(0, -1) };
    case 'promote':
      return withRoot(s, promoteVariation(root, s.path));
    case 'mainline':
      return withRoot(s, makeMainline(root, s.path));
    case 'comment':
      return withRoot(s, setComment(root, s.path, a.text));
    case 'nag':
      return s.path.length ? withRoot(s, toggleNag(root, s.path, a.nag)) : s;
  }
}

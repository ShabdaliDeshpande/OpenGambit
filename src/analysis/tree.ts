import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { UciMove } from '../engine/search';

/**
 * Immutable move tree with variations. A node's id is its move in UCI form
 * ("e2e4", "e7e8q"), which is unique among siblings, so a path from the root
 * is simply the list of ids. The first child is the main line.
 */
export interface TreeNode {
  id: string;
  /** Ply after this move; the root holds the ply of the starting position. */
  ply: number;
  san: string;
  uci: UciMove | null;
  /** Position after this move (the start position for the root). */
  fen: string;
  comment: string;
  /** Numeric Annotation Glyphs, e.g. 1 = "!", 2 = "?". */
  nags: number[];
  children: TreeNode[];
}

export interface GameTree {
  root: TreeNode;
  headers: Record<string, string>;
}

export type Path = readonly string[];

export const uciId = (m: UciMove) => `${m.from}${m.to}${m.promotion ?? ''}`;

export function plyOfFen(fen: string): number {
  const [, turn = 'w', , , , full = '1'] = fen.split(' ');
  return (Math.max(1, Number(full) || 1) - 1) * 2 + (turn === 'b' ? 1 : 0);
}

export function createRoot(fen: string = DEFAULT_POSITION): TreeNode {
  return { id: '', ply: plyOfFen(fen), san: '', uci: null, fen, comment: '', nags: [], children: [] };
}

export const emptyTree = (fen?: string): GameTree => ({ root: createRoot(fen), headers: {} });

/** Move number shown for a node (1 for White's and Black's first moves). */
export const moveNumber = (node: TreeNode) => Math.floor((node.ply + 1) / 2);
export const isWhiteMove = (node: TreeNode) => node.ply % 2 === 1;

export function nodeAt(root: TreeNode, path: Path): TreeNode | null {
  let node: TreeNode | undefined = root;
  for (const id of path) {
    node = node.children.find(c => c.id === id);
    if (!node) return null;
  }
  return node;
}

/** Root followed by every node along `path`. */
export function nodesAlong(root: TreeNode, path: Path): TreeNode[] {
  const out = [root];
  let node = root;
  for (const id of path) {
    const next = node.children.find(c => c.id === id);
    if (!next) break;
    out.push(next);
    node = next;
  }
  return out;
}

/** The moves from the root to `path`, for replaying (e.g. by the engine). */
export const movesAlong = (root: TreeNode, path: Path): UciMove[] =>
  nodesAlong(root, path)
    .slice(1)
    .map(n => n.uci!);

function updateAt(node: TreeNode, path: Path, fn: (n: TreeNode) => TreeNode): TreeNode {
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path;
  let found = false;
  const children = node.children.map(c => {
    if (c.id !== head) return c;
    found = true;
    return updateAt(c, rest, fn);
  });
  return found ? { ...node, children } : node;
}

/** A child node for playing `move` from `parent`; throws if the move is illegal. */
export function makeChild(parent: TreeNode, move: UciMove | string): TreeNode {
  const chess = new Chess(parent.fen);
  const m = chess.move(move); // throws on illegal input
  const uci: UciMove = { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) };
  return { id: uciId(uci), ply: parent.ply + 1, san: m.san, uci, fen: m.after, comment: '', nags: [], children: [] };
}

/**
 * Plays `move` after the node at `path`. An existing child with the same move
 * is reused; otherwise the move becomes a new variation (or the main line if
 * there were no moves yet). Returns the new root and the path to the move.
 */
export function addMove(root: TreeNode, path: Path, move: UciMove | string): { root: TreeNode; path: string[] } {
  const parent = nodeAt(root, path);
  if (!parent) throw new Error('Path not found');
  const child = makeChild(parent, move);
  const newPath = [...path, child.id];
  if (parent.children.some(c => c.id === child.id)) return { root, path: newPath };
  return { root: updateAt(root, path, n => ({ ...n, children: [...n.children, child] })), path: newPath };
}

/** Removes the node at `path` and everything after it. */
export function deleteAt(root: TreeNode, path: Path): TreeNode {
  if (path.length === 0) return { ...root, children: [] };
  const parentPath = path.slice(0, -1);
  const id = path[path.length - 1];
  return updateAt(root, parentPath, n => ({ ...n, children: n.children.filter(c => c.id !== id) }));
}

const moveToFront = (n: TreeNode, id: string): TreeNode => {
  const i = n.children.findIndex(c => c.id === id);
  if (i <= 0) return n;
  const children = [...n.children];
  const [c] = children.splice(i, 1);
  return { ...n, children: [c!, ...children] };
};

/** Index of the deepest step on `path` that is not already the first child. */
function deepestVariationStep(root: TreeNode, path: Path): number {
  const nodes = nodesAlong(root, path);
  for (let i = path.length - 1; i >= 0; i--) if (nodes[i]!.children[0]?.id !== path[i]) return i;
  return -1;
}

/** Moves the variation containing `path` up one level (it becomes the preferred line at its branch). */
export function promoteVariation(root: TreeNode, path: Path): TreeNode {
  const i = deepestVariationStep(root, path);
  return i < 0 ? root : updateAt(root, path.slice(0, i), n => moveToFront(n, path[i]!));
}

/** Makes `path` the main line all the way from the root. */
export function makeMainline(root: TreeNode, path: Path): TreeNode {
  let r = root;
  for (let i = 0; i < path.length; i++) r = updateAt(r, path.slice(0, i), n => moveToFront(n, path[i]!));
  return r;
}

/** True if every step of `path` follows the first child. */
export const isMainline = (root: TreeNode, path: Path) => deepestVariationStep(root, path) < 0;

/** `path` extended along first children to the end of its line. */
export function lineEnd(root: TreeNode, path: Path): string[] {
  const out = [...path];
  let node = nodeAt(root, path);
  while (node?.children[0]) {
    node = node.children[0];
    out.push(node.id);
  }
  return out;
}

export const setComment = (root: TreeNode, path: Path, comment: string) =>
  updateAt(root, path, n => ({ ...n, comment }));

/** Move-quality glyphs ($1–$6) and position glyphs ($10–$19) are each mutually exclusive. */
const NAG_GROUPS = [
  [1, 2, 3, 4, 5, 6],
  [10, 13, 14, 15, 16, 17, 18, 19],
];

export function toggleNag(root: TreeNode, path: Path, nag: number): TreeNode {
  return updateAt(root, path, n => {
    if (n.nags.includes(nag)) return { ...n, nags: n.nags.filter(x => x !== nag) };
    const group = NAG_GROUPS.find(g => g.includes(nag)) ?? [nag];
    return { ...n, nags: [...n.nags.filter(x => !group.includes(x)), nag].sort((a, b) => a - b) };
  });
}

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
};

/** Builds a main-line-only tree from a start position and a list of moves. */
export function treeFromMoves(startFen: string, moves: readonly (UciMove | string)[], headers: Record<string, string> = {}): GameTree {
  let root = createRoot(startFen);
  let path: string[] = [];
  for (const m of moves) ({ root, path } = addMove(root, path, m));
  return { root, headers };
}

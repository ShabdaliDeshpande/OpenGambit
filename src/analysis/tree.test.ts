import { describe, expect, it } from 'vitest';
import {
  addMove,
  createRoot,
  deleteAt,
  isMainline,
  lineEnd,
  makeMainline,
  movesAlong,
  nodeAt,
  plyOfFen,
  promoteVariation,
  setComment,
  toggleNag,
  treeFromMoves,
  type TreeNode,
} from './tree';

const sansOf = (n: TreeNode) => n.children.map(c => c.san);

function play(root: TreeNode, path: string[], sans: string[]) {
  let r = root;
  let p = path;
  for (const san of sans) ({ root: r, path: p } = addMove(r, p, san));
  return { root: r, path: p };
}

describe('move tree', () => {
  it('builds a main line and computes plies', () => {
    const { root } = treeFromMoves(createRoot().fen, ['e4', 'e5', 'Nf3']);
    expect(lineEnd(root, [])).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(nodeAt(root, ['e2e4', 'e7e5'])).toMatchObject({ san: 'e5', ply: 2 });
    expect(plyOfFen('4k3/8/8/8/8/8/8/4K3 b - - 0 12')).toBe(23);
  });

  it('reuses an existing move instead of duplicating it', () => {
    const a = play(createRoot(), [], ['e4', 'e5']);
    const b = addMove(a.root, ['e2e4'], 'e5');
    expect(b.root).toBe(a.root);
    expect(b.path).toEqual(['e2e4', 'e7e5']);
  });

  it('adds a different move as a variation, keeping the main line first', () => {
    const main = play(createRoot(), [], ['e4', 'e5', 'Nf3']);
    const v = addMove(main.root, ['e2e4'], 'c5');
    expect(sansOf(nodeAt(v.root, ['e2e4'])!)).toEqual(['e5', 'c5']);
    expect(v.path).toEqual(['e2e4', 'c7c5']);
    expect(isMainline(v.root, v.path)).toBe(false);
    expect(isMainline(v.root, ['e2e4', 'e7e5'])).toBe(true);
  });

  it('rejects illegal moves', () => {
    expect(() => addMove(createRoot(), [], 'e5')).toThrow();
  });

  it('deletes a move and everything after it', () => {
    const t = play(createRoot(), [], ['e4', 'e5', 'Nf3', 'Nc6']);
    const r = deleteAt(t.root, ['e2e4', 'e7e5', 'g1f3']);
    expect(lineEnd(r, [])).toEqual(['e2e4', 'e7e5']);
  });

  it('promotes a variation one level and makes a line the main line', () => {
    let r = play(createRoot(), [], ['e4', 'e5', 'Nf3']).root;
    r = addMove(r, [], 'd4').root; // 1. d4 as alternative to 1. e4
    r = play(r, ['d2d4'], ['d5', 'c4']).root;
    r = addMove(r, ['d2d4', 'd7d5'], 'Nf3').root; // 2. Nf3 as alternative to 2. c4
    const deep = ['d2d4', 'd7d5', 'g1f3'];

    // promote: the deepest branch moves up first
    const p1 = promoteVariation(r, deep);
    expect(sansOf(nodeAt(p1, ['d2d4', 'd7d5'])!)).toEqual(['Nf3', 'c4']);
    expect(sansOf(p1)).toEqual(['e4', 'd4']);
    const p2 = promoteVariation(p1, deep);
    expect(sansOf(p2)).toEqual(['d4', 'e4']);
    expect(isMainline(p2, deep)).toBe(true);

    // make main line does all levels at once
    const m = makeMainline(r, deep);
    expect(lineEnd(m, [])).toEqual(deep);
    expect(promoteVariation(m, deep)).toBe(m); // already main line: unchanged
  });

  it('edits comments and toggles exclusive glyphs', () => {
    const t = play(createRoot(), [], ['e4']);
    let r = setComment(t.root, ['e2e4'], 'Best by test');
    r = toggleNag(r, ['e2e4'], 1);
    r = toggleNag(r, ['e2e4'], 3); // !! replaces !
    r = toggleNag(r, ['e2e4'], 16); // a position glyph coexists
    expect(nodeAt(r, ['e2e4'])).toMatchObject({ comment: 'Best by test', nags: [3, 16] });
    r = toggleNag(r, ['e2e4'], 3);
    expect(nodeAt(r, ['e2e4'])!.nags).toEqual([16]);
    expect(nodeAt(t.root, ['e2e4'])!.nags).toEqual([]); // original untouched
  });

  it('lists the moves along a path for the engine', () => {
    const t = play(createRoot(), [], ['e4', 'e5', 'Nf3']);
    expect(movesAlong(t.root, t.path)).toEqual([
      { from: 'e2', to: 'e4' },
      { from: 'e7', to: 'e5' },
      { from: 'g1', to: 'f3' },
    ]);
  });

  it('records promotions in the node id', () => {
    const t = addMove(createRoot('8/P7/8/8/8/8/8/k6K w - - 0 1'), [], { from: 'a7', to: 'a8', promotion: 'n' });
    expect(t.path).toEqual(['a7a8n']);
    expect(nodeAt(t.root, t.path)!.san).toBe('a8=N');
  });
});

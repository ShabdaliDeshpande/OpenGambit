import { describe, expect, it } from 'vitest';
import { createGame, exportPgn, type GameSetup } from '../chess/game';
import { playSan } from '../chess/testUtils';
import { readPgn, writePgn } from './pgn';
import { lineEnd, nodeAt, type TreeNode } from './tree';

/** A compact, comparable picture of a tree: SAN, NAGs and comments, with variations. */
function shape(n: TreeNode): unknown {
  return n.children.map(c => [c.san, c.nags, c.comment, shape(c)]);
}

const sample = `[Event "Study"]
[White "A"]
[Black "B"]
[Result "1-0"]

{ An opening survey } 1. e4 $1 e5 (1... c5 { Sicilian } 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 Nc6
3. Bb5!? a6 { Morphy } 4. Ba4 Nf6 1-0`;

describe('tree PGN', () => {
  it('reads variations, nested variations, comments and NAGs', () => {
    const tree = readPgn(sample);
    expect(tree.headers).toMatchObject({ Event: 'Study', White: 'A', Result: '1-0' });
    expect(tree.root.comment).toBe('An opening survey');
    const e4 = nodeAt(tree.root, ['e2e4'])!;
    expect(e4.nags).toEqual([1]);
    expect(e4.children.map(c => c.san)).toEqual(['e5', 'c5']);
    const c5 = nodeAt(tree.root, ['e2e4', 'c7c5'])!;
    expect(c5.comment).toBe('Sicilian');
    expect(c5.children[0]!.children.map(c => c.san)).toEqual(['d6']);
    expect(c5.children.map(c => c.san)).toEqual(['Nf3', 'c3']);
    expect(nodeAt(tree.root, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])!.nags).toEqual([5]); // "!?" suffix
    expect(lineEnd(tree.root, []).length).toBe(8);
  });

  it('round-trips write → read without losing anything', () => {
    const tree = readPgn(sample);
    const text = writePgn(tree);
    const back = readPgn(text);
    expect(shape(back.root)).toEqual(shape(tree.root));
    expect(back.root.comment).toBe(tree.root.comment);
    // the writer fills in the PGN seven-tag roster ("?" for unknown values)
    expect(back.headers).toMatchObject(tree.headers);
    expect(back.headers.Site).toBe('?');
    expect(writePgn(back)).toBe(text); // stable
  });

  it('writes move numbers correctly around variations and comments', () => {
    const text = writePgn(readPgn(sample)).replace(/\s+/g, ' '); // ignore line wrapping
    expect(text).toContain('1. e4 $1 e5 (1... c5 { Sicilian } 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 Nc6 3. Bb5 $5 a6');
    expect(text).toContain('{ Morphy } 4. Ba4 Nf6 1-0');
  });

  it('keeps a custom start position and starts with Black to move', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 7';
    const text = `[SetUp "1"]\n[FEN "${fen}"]\n\n7... Kd7 8. e4 Ke6 *`;
    const tree = readPgn(text);
    expect(tree.root.fen).toBe(fen);
    expect(lineEnd(tree.root, [])).toEqual(['e8d7', 'e2e4', 'd7e6']);
    const out = writePgn(tree);
    expect(out).toContain(`[FEN "${fen}"]`);
    expect(out).toContain('7... Kd7 8. e4 Ke6 *');
  });

  it('imports a game exported by the play screen', () => {
    const setup: GameSetup = { mode: 'local', humanColor: 'w', level: 1, timeControlId: '3+2' };
    const game = playSan(createGame(setup), ['f3', 'e5', 'g4', 'Qh4#']);
    const tree = readPgn(exportPgn(game));
    expect(lineEnd(tree.root, []).map(id => id)).toEqual(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(tree.headers.Result).toBe('0-1');
    expect(tree.headers.TimeControl).toBe('180+2');
  });

  it('reports illegal moves and unbalanced variations', () => {
    expect(() => readPgn('1. e4 e5 2. Ke3')).toThrow(/Illegal move "Ke3" after 1... e5/);
    expect(() => readPgn('1. e4 (1. d4')).toThrow(/Unclosed/);
    expect(() => readPgn('1. e4 )')).toThrow(/Unbalanced/);
  });

  it('reads only the first of several games', () => {
    const tree = readPgn('[Event "1"]\n\n1. e4 *\n\n[Event "2"]\n\n1. d4 *');
    expect(tree.headers.Event).toBe('1');
    expect(lineEnd(tree.root, [])).toEqual(['e2e4']);
  });

  it('accepts PGN without headers or results, and ; comments', () => {
    const tree = readPgn('1.d4 d5 ; solid\n2.c4');
    expect(lineEnd(tree.root, [])).toEqual(['d2d4', 'd7d5', 'c2c4']);
    expect(nodeAt(tree.root, ['d2d4', 'd7d5'])!.comment).toBe('solid');
  });
});

import { describe, expect, it } from 'vitest';
import { brushFor, joinComment, shapesCommand, splitComment, toggleShape, type Shape } from './shapes';
import { readPgn, writePgn } from './pgn';
import { analysisReducer, initialAnalysis } from './analysisState';

const keys = (k: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...k,
});

describe('drawn shapes', () => {
  it('picks a colour from the modifier keys', () => {
    expect(brushFor(keys())).toBe('green');
    expect(brushFor(keys({ shiftKey: true }))).toBe('red');
    expect(brushFor(keys({ altKey: true }))).toBe('blue');
    expect(brushFor(keys({ ctrlKey: true }))).toBe('yellow');
    expect(brushFor(keys({ metaKey: true }))).toBe('yellow');
  });

  it('adds, recolours and removes shapes', () => {
    const arrow: Shape = { orig: 'e2', dest: 'e4', brush: 'green' };
    let s = toggleShape([], arrow);
    expect(s).toEqual([arrow]);
    s = toggleShape(s, { ...arrow, brush: 'red' });
    expect(s).toEqual([{ ...arrow, brush: 'red' }]);
    s = toggleShape(s, { ...arrow, brush: 'red' });
    expect(s).toEqual([]);
    // an arrow that starts and ends on one square is a circle
    expect(toggleShape([], { orig: 'd4', dest: 'd4', brush: 'blue' })).toEqual([{ orig: 'd4', brush: 'blue' }]);
  });

  it('reads and writes the PGN comment commands', () => {
    const shapes: Shape[] = [
      { orig: 'e2', dest: 'e4', brush: 'green' },
      { orig: 'd4', brush: 'red' },
      { orig: 'g1', dest: 'f3', brush: 'yellow' },
    ];
    expect(shapesCommand(shapes)).toBe('[%csl Rd4][%cal Ge2e4,Yg1f3]');
    expect(joinComment('central control', shapes)).toBe('[%csl Rd4][%cal Ge2e4,Yg1f3] central control');
    expect(splitComment('[%cal Ge2e4,Yg1f3] central [%csl Rd4] control')).toEqual({
      text: 'central control',
      shapes: [shapes[0], shapes[2], shapes[1]],
    });
    // other commands and bad entries are left alone or skipped
    expect(splitComment('[%clk 0:03:00] [%cal Zz9z9,Bb1c3]')).toEqual({ text: '[%clk 0:03:00]', shapes: [{ orig: 'b1', dest: 'c3', brush: 'blue' }] });
  });

  it('keeps shapes through a PGN round trip, separate from the comment text', () => {
    const tree = readPgn('1. e4 { [%cal Gg1f3] develop next } e5 { [%csl Re5] } 2. Nf3 *');
    const e4 = tree.root.children[0]!;
    expect(e4.comment).toBe('develop next');
    expect(e4.shapes).toEqual([{ orig: 'g1', dest: 'f3', brush: 'green' }]);
    expect(e4.children[0]!.comment).toBe('');
    expect(e4.children[0]!.shapes).toEqual([{ orig: 'e5', brush: 'red' }]);
    const again = writePgn(tree);
    expect(again).toContain('1. e4 { [%cal Gg1f3] develop next } 1... e5 { [%csl Re5] } 2. Nf3');
    expect(readPgn(again).root.children[0]!.children[0]!.shapes).toEqual([{ orig: 'e5', brush: 'red' }]);
  });

  it('stores shapes on the current move through the board reducer', () => {
    let s = analysisReducer(initialAnalysis(), { type: 'play', moves: ['e4'] });
    s = analysisReducer(s, { type: 'shapes', shapes: [{ orig: 'd7', dest: 'd5', brush: 'blue' }] });
    expect(s.tree.root.children[0]!.shapes).toEqual([{ orig: 'd7', dest: 'd5', brush: 'blue' }]);
    s = analysisReducer(s, { type: 'shapes', shapes: [] });
    expect(s.tree.root.children[0]!.shapes).toBeUndefined();
  });
});

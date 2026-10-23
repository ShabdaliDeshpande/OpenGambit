// Arrows and circles drawn on the analysis board. They're kept per move and
// stored in PGN comments with the common [%cal …] (arrows) and [%csl …]
// (squares) commands, e.g. "[%cal Ge2e4,Rd7d5][%csl Gd4]".

import type { Square } from 'chess.js';

export type Brush = 'green' | 'red' | 'blue' | 'yellow';

export const BRUSHES: readonly Brush[] = ['green', 'red', 'blue', 'yellow'];

const BRUSH_CODE: Record<Brush, string> = { green: 'G', red: 'R', blue: 'B', yellow: 'Y' };
const CODE_BRUSH: Record<string, Brush> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' };

/** An arrow from `orig` to `dest`, or a circle on `orig` when there's no `dest`. */
export interface Shape {
  orig: Square;
  dest?: Square;
  brush: Brush;
}

/** The brush for a modifier key: none = green, Shift = red, Alt = blue, Ctrl (or ⌘) = yellow. */
export function brushFor(keys: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Brush {
  if (keys.shiftKey) return 'red';
  if (keys.altKey) return 'blue';
  if (keys.ctrlKey || keys.metaKey) return 'yellow';
  return 'green';
}

const sameSpot = (a: Shape, b: Shape) => a.orig === b.orig && (a.dest ?? a.orig) === (b.dest ?? b.orig);

/** Drawing a shape that's already there removes it; in another colour, recolours it. */
export function toggleShape(shapes: readonly Shape[], s: Shape): Shape[] {
  const shape: Shape = s.dest && s.dest !== s.orig ? s : { orig: s.orig, brush: s.brush };
  const found = shapes.find(x => sameSpot(x, shape));
  if (!found) return [...shapes, shape];
  if (found.brush === shape.brush) return shapes.filter(x => x !== found);
  return shapes.map(x => (x === found ? shape : x));
}

const SQUARE = /^[a-h][1-8]$/;
const COMMAND = /\[%(cal|csl)\s+([^\]]*)\]/g;

/** A comment split into its text and the shapes its [%cal] and [%csl] commands describe. */
export function splitComment(comment: string): { text: string; shapes: Shape[] } {
  const shapes: Shape[] = [];
  const text = comment.replace(COMMAND, (_all, kind: string, body: string) => {
    for (const item of body.split(',').map(x => x.trim())) {
      const brush = CODE_BRUSH[item[0] ?? ''];
      const orig = item.slice(1, 3);
      const dest = item.slice(3, 5);
      if (!brush || !SQUARE.test(orig)) continue;
      if (kind === 'cal' && SQUARE.test(dest) && dest !== orig) shapes.push({ orig: orig as Square, dest: dest as Square, brush });
      else if (kind === 'csl' && item.length === 3) shapes.push({ orig: orig as Square, brush });
    }
    return ' ';
  });
  return { text: text.replace(/\s+/g, ' ').trim(), shapes };
}

/** The [%csl …][%cal …] commands for some shapes ('' when there are none). */
export function shapesCommand(shapes: readonly Shape[]): string {
  const circles = shapes.filter(s => !s.dest).map(s => BRUSH_CODE[s.brush] + s.orig);
  const arrows = shapes.filter(s => s.dest).map(s => BRUSH_CODE[s.brush] + s.orig + s.dest);
  return (circles.length ? `[%csl ${circles.join(',')}]` : '') + (arrows.length ? `[%cal ${arrows.join(',')}]` : '');
}

/** A comment's full PGN text: shape commands first, then the words. */
export const joinComment = (text: string, shapes: readonly Shape[] = []) => [shapesCommand(shapes), text.trim()].filter(Boolean).join(' ');

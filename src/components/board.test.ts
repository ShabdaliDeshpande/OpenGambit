import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_PREMOVES, type Premove } from '../chess/premove';
import { Board } from './Board';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const noop = () => {};

/** The markup of one square. */
const square = (html: string, sq: string) => {
  // from the square's opening tag (its classes come first) to the next square
  const start = html.lastIndexOf('<div', html.indexOf(`data-square="${sq}"`));
  return html.slice(start, html.indexOf('data-square=', html.indexOf(`data-square="${sq}"`) + 10));
};

const render = (premoves: Premove[]) =>
  renderToStaticMarkup(createElement(Board, { fen: AFTER_E4, orientation: 'w', movableColor: null, lastMove: null, onMove: noop, premoveColor: 'w', premoves, onPremove: noop, onCancelPremove: noop }));

describe('board premoves', () => {
  it('draws queued premoves as made and marks their squares', () => {
    const html = render([{ from: 'g1', to: 'f3' }, { from: 'f1', to: 'c4' }]);
    expect(square(html, 'g1')).not.toContain('piece');
    expect(square(html, 'f3')).toContain('piece white');
    expect(square(html, 'c4')).toContain('piece white');
    expect(square(html, 'f3')).toContain('premove');
    expect(square(html, 'e4')).not.toContain('premove');
  });

  it('stops offering targets once the queue is full', () => {
    const full = Array.from({ length: MAX_PREMOVES }, (_v, i): Premove => (i % 2 ? { from: 'f3', to: 'g1' } : { from: 'g1', to: 'f3' }));
    // the real position is unchanged, and nothing more can be queued (no square is a target)
    expect(render(full)).not.toContain('dest');
  });
});

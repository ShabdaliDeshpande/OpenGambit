import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExplorerPanel } from './ExplorerPanel';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const noop = () => {};

describe('explorer panel', () => {
  it('offers the three sources, with My games only for signed-in players', () => {
    const guest = renderToStaticMarkup(createElement(ExplorerPanel, { fen: START, standard: true, signedIn: false, onPlay: noop }));
    expect(guest).toContain('Masters');
    expect(guest).toContain('OpenGambit');
    expect(guest).toMatch(/<button[^>]*disabled=""[^>]*>My games<\/button>/);
    const member = renderToStaticMarkup(createElement(ExplorerPanel, { fen: START, standard: true, signedIn: true, onPlay: noop }));
    expect(member).not.toMatch(/disabled=""[^>]*>My games/);
  });

  it('explains that only games from the standard start are covered', () => {
    const html = renderToStaticMarkup(createElement(ExplorerPanel, { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', standard: false, signedIn: false, onPlay: noop }));
    expect(html).toContain('standard starting position only');
  });
});

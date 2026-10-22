import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel } from './ReviewPanel';
import { reviewMoves, summarizeReview } from '../../analysis/gameReview';
import { explainMove } from '../../analysis/explain';
import { startRetry } from '../../analysis/retry';
import { winningChances } from '../../analysis/review';
import { at, gameOf } from '../../analysis/reviewFixtures';

const moves = gameOf(['e4', 'd5', 'Qg4', 'Bxg4']);
const evals = [at({ cp: 20 }, ['e2e4']), at({ cp: 30 }, ['d7d5']), at({ cp: 10 }, ['e4d5', 'd8d5']), at({ cp: -900 }, ['c8g4']), at({ cp: -900 }, ['g1f3'])];
const reviewed = reviewMoves(moves, evals);
const summary = summarizeReview(moves, reviewed, evals);
const noop = () => {};

const render = (extra: object = {}) =>
  renderToStaticMarkup(
    createElement(ReviewPanel, {
      moves: 4,
      progress: null,
      summary,
      phaseNotes: [],
      reviewed,
      names: { w: 'Ann', b: 'Bo' },
      current: { move: reviewed[2]!, before: '+0.1', after: '−9.0', bestSan: 'exd5', explanation: explainMove(reviewed[2]!) },
      graph: { points: evals.map(e => winningChances(e.score, 'w')), kinds: new Map(reviewed.map(m => [m.ply, m.judgement.kind])), division: summary.division, ply: 3 },
      retryCounts: { w: 1, b: 0 },
      retry: null,
      savedNote: 'Saved with the game.',
      onStart: noop,
      onStop: noop,
      onJump: noop,
      onShowBest: noop,
      onGoto: noop,
      onRetry: noop,
      onRetryAction: noop,
      ...extra,
    }),
  );

describe('review panel', () => {
  it('shows accuracy, every class, key moments, the explanation and the graph', () => {
    const html = render();
    expect(html).toContain('Accuracy');
    expect(html).toContain('Est. performance');
    for (const label of ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder']) expect(html).toContain(label);
    expect(html).toContain('Key moments');
    expect(html).toContain('It leaves your queen on g4 hanging');
    expect(html).toContain('class="eval-graph"');
    expect(html).toContain('Retry Ann’s mistakes (1)');
    expect(html).toContain('Saved with the game.');
    // a finished review has nothing left to start
    expect(html).not.toContain('Review game');
  });

  it('shows the retry box instead while retrying', () => {
    const html = render({ retry: startRetry(reviewed, 'w') });
    expect(html).toContain('Find a better move for Ann.');
    expect(html).toContain('Mistake 1 of 1');
    expect(html).not.toContain('Key moments');
  });
});

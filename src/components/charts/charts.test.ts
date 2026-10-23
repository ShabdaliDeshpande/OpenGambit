import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LineChart } from './LineChart';
import { ResultBars } from './ResultBars';

const DAY = 86_400_000;

describe('line chart', () => {
  it('draws each series with a legend, end labels and a table view', () => {
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        title: 'Rating',
        series: [
          { id: 'blitz', label: 'Blitz', color: 'var(--viz-2)', points: [{ t: 0, v: 1500 }, { t: DAY, v: 1520 }] },
          { id: 'rapid', label: 'Rapid', color: 'var(--viz-3)', points: [{ t: DAY, v: 1400 }] },
        ],
      }),
    );
    expect(html).toContain('<polyline');
    expect(html).toContain('aria-label="Legend"');
    expect(html).toContain('Blitz');
    expect(html).toContain('1520');
    expect(html).toContain('Show the numbers');
    expect(html).toContain('aria-label="Rating. Use the arrow keys to read values."');
  });

  it('needs no legend for one series, and draws nothing without points', () => {
    const one = renderToStaticMarkup(createElement(LineChart, { title: 'Accuracy', series: [{ id: 'a', label: 'Accuracy', color: 'red', points: [{ t: 0, v: 80 }, { t: DAY, v: 90 }] }] }));
    expect(one).not.toContain('aria-label="Legend"');
    expect(renderToStaticMarkup(createElement(LineChart, { title: 'x', series: [{ id: 'a', label: 'a', color: 'red', points: [] }] }))).toBe('');
  });
});

describe('result bars', () => {
  it('shows wins, draws and losses with the number of games', () => {
    const html = renderToStaticMarkup(
      createElement(ResultBars, {
        title: 'By colour',
        rows: [
          { label: 'White', win: 3, draw: 1, loss: 1 },
          { label: 'Black', win: 0, draw: 0, loss: 0 },
        ],
      }),
    );
    expect(html).toContain('White: 3 won, 1 drawn, 1 lost (5 games)');
    expect(html).toContain('60%');
    expect(html).not.toContain('Black'); // empty rows are left out unless asked for
    expect(html).toContain('Wins');
  });

  it('keeps empty rows when asked and says when there is nothing', () => {
    const html = renderToStaticMarkup(createElement(ResultBars, { title: 't', rows: [{ label: '00–04', win: 0, draw: 0, loss: 0 }], keepEmpty: true }));
    expect(html).toContain('no games');
    expect(renderToStaticMarkup(createElement(ResultBars, { title: 't', rows: [] }))).toContain('No games yet');
  });
});

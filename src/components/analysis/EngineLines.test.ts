import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EngineLines, SettingsForm } from './EngineLines';
import { DEFAULT_SETTINGS } from '../../analysis/engineSettings';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const noop = () => {};
const analysis = {
  info: { depth: 12, nodes: 50_000, elapsedMs: 100, lines: [{ pv: [{ from: 'e2', to: 'e4' }] as never, cp: 30, mate: null }] },
  running: true,
  error: null,
};

describe('engine panel', () => {
  it('shows lines, the search limit and the threat', () => {
    const html = renderToStaticMarkup(
      createElement(EngineLines, {
        fen: START,
        settings: { ...DEFAULT_SETTINGS, threat: true, threads: 2 },
        onSettings: noop,
        maxThreads: 4,
        analysis,
        threat: { fen: START.replace(' w ', ' b '), analysis: { ...analysis, info: { ...analysis.info, lines: [{ pv: [{ from: 'e7', to: 'e5' }] as never, cp: 10, mate: null }] } } },
        onPlayLine: noop,
      }),
    );
    expect(html).toContain('depth 12');
    expect(html).toContain('15 s');
    expect(html).toContain('2 threads');
    expect(html).toContain('1. e4');
    expect(html).toContain('Threat:');
    expect(html).toContain('e5');
  });

  it('says why the engine is quiet while retrying', () => {
    const html = renderToStaticMarkup(
      createElement(EngineLines, { fen: START, settings: DEFAULT_SETTINGS, onSettings: noop, maxThreads: 1, analysis, threat: null, paused: true, onPlayLine: noop }),
    );
    expect(html).toContain('hidden while you retry');
    expect(html).not.toContain('1. e4');
  });

  it('offers every setting', () => {
    const html = renderToStaticMarkup(createElement(SettingsForm, { settings: DEFAULT_SETTINGS, onSettings: noop, maxThreads: 4 }));
    for (const text of ['Search by', 'Time per position', 'Infinite analysis', 'Lines', 'Threads', 'Show threat', 'best moves', 'drawn', 'Right-click']) expect(html).toContain(text);
  });
});

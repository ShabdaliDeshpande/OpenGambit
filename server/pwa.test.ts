import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pub = (p: string) => new URL(`../public/${p}`, import.meta.url);

/** Width and height from a PNG file's header. */
function pngSize(path: URL) {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('installable app', () => {
  it('has a manifest whose icons exist at the stated sizes', () => {
    const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({ name: 'OpenGambit', start_url: '/', display: 'standalone' });
    expect(manifest.icons.map(i => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);
    for (const icon of manifest.icons) expect(pngSize(pub(icon.src.slice(1)))).toBe(icon.sizes);
    expect(pngSize(pub('icons/apple-touch-icon.png'))).toBe('180x180');
  });

  it('never caches the API, the game socket or itself', () => {
    const src = readFileSync(pub('sw.js'), 'utf8');
    // take just the routing rules, without the event listeners that need a worker
    const strategyFor = new Function(`${src.slice(0, src.indexOf("self.addEventListener('install'"))}; return strategyFor;`)() as (
      path: string,
      mode: string,
    ) => string;
    expect(strategyFor('/api/me', 'cors')).toBe('network');
    expect(strategyFor('/api/login', 'navigate')).toBe('network');
    expect(strategyFor('/ws', 'websocket')).toBe('network');
    expect(strategyFor('/sw.js', 'no-cors')).toBe('network');
    expect(strategyFor('/', 'navigate')).toBe('page');
    expect(strategyFor('/?tour=abc', 'navigate')).toBe('page');
    expect(strategyFor('/assets/index-abc123.js', 'cors')).toBe('asset');
    expect(strategyFor('/icons/icon-192.png', 'no-cors')).toBe('static');
  });
});

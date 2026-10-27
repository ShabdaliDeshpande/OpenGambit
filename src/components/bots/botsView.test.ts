import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BOTS } from '../../bots/bots';
import { DEFAULT_ASSISTS } from '../../bots/botGame';
import { BotAvatar } from './BotAvatar';
import { BotGame } from './BotGame';
import { BotsView } from './BotsView';

const noop = () => {};
const gameProps = { assists: DEFAULT_ASSISTS, active: false, onAssists: noop, onSave: noop, onResult: noop, onAgain: noop, onExit: noop, onAnalyse: noop };

describe('bot screens', () => {
  it('shows every bot in the gallery, with the first one ready to play', () => {
    const html = renderToStaticMarkup(createElement(BotsView, { active: true, signedIn: false, onAnalyse: noop }));
    for (const b of BOTS) expect(html).toContain(b.name);
    expect(html).toContain(`Play ${BOTS[0]!.name}`);
    expect(html).toContain('Challenge');
    expect(html).toContain('Ratings are approximate.');
    expect(html).toContain('Your results are kept in this browser.');
  });

  it('draws an avatar for every bot', () => {
    for (const b of BOTS) {
      const svg = renderToStaticMarkup(createElement(BotAvatar, { bot: b }));
      expect(svg).toMatch(/^<svg class="bot-avatar"/);
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it('opens a Challenge game with a greeting and no assists', () => {
    const bot = BOTS[3]!;
    const html = renderToStaticMarkup(createElement(BotGame, { ...gameProps, bot, player: 'w', mode: 'challenge', moves: [] }));
    expect(bot.chat.start.some(line => html.includes(line))).toBe(true);
    expect(html).toContain('Your move');
    expect(html).not.toContain('Assists');
    expect(html).not.toContain('eval-bar');
    expect(html).toContain('Challenge');
  });

  it('resumes an Assisted game with the eval bar and the assist switches', () => {
    const bot = BOTS[5]!;
    const html = renderToStaticMarkup(createElement(BotGame, { ...gameProps, bot, player: 'b', mode: 'assisted', moves: ['e2e4', 'e7e5', 'g1f3'] }));
    expect(html).toContain('eval-bar');
    expect(html).toContain('Assists');
    expect(html).toContain('Takebacks');
    expect(html).toContain('↶ Take back');
    expect(html).toContain('Nf3');
    expect(html).toContain('Assisted games don’t count');
  });
});

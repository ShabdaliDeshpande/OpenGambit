import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FLAIRS } from '../../account/flair';
import { DailySettings } from '../account/DailySettings';
import { Flair } from '../Flair';
import { NotificationBell, notificationUrl } from '../NotificationBell';
import { DailyGame } from './DailyGame';
import { DailyHome } from './DailyHome';
import { DailyTourPage } from './DailyTourPage';

const noop = () => {};

describe('daily chess screens', () => {
  it('asks guests to sign in, and offers the lobby and tournaments', () => {
    const html = renderToStaticMarkup(createElement(DailyHome, { signedIn: false, onSignIn: noop, onOpenGame: noop, onOpenTour: noop, onOpenProfile: noop }));
    expect(html).toContain('Daily chess');
    expect(html).toContain('Sign in to play');
    expect(html).toContain('Find a game');
    expect(html).toContain('Daily tournaments');
  });

  it('shows a loading state for a game and a tournament', () => {
    expect(renderToStaticMarkup(createElement(DailyGame, { id: 'abc', active: true, onBack: noop, onOpenProfile: noop, onOpenTour: noop, onAnalyse: noop }))).toContain('Loading the game');
    expect(renderToStaticMarkup(createElement(DailyTourPage, { id: 'abc', meId: null, onSignIn: noop, onBack: noop, onOpenGame: noop, onOpenProfile: noop }))).toContain('Loading the tournament');
  });

  it('links notifications to their game or tournament', () => {
    expect(notificationUrl({ kind: 'move', link: 'g1' })).toBe('?daily=g1');
    expect(notificationUrl({ kind: 'tour', link: 't1' })).toBe('?dailytour=t1');
    expect(notificationUrl({ kind: 'challenge', link: null })).toBe('?daily');
    expect(renderToStaticMarkup(createElement(NotificationBell, { onOpen: noop }))).toContain('aria-label="Notifications"');
  });

  it('shows flair after a name, and every allowed flair in the picker', () => {
    expect(renderToStaticMarkup(createElement(Flair, { flair: '🦉' }))).toBe('<span class="flair"> 🦉</span>');
    expect(renderToStaticMarkup(createElement(Flair, { flair: null }))).toBe('');
    const settings = renderToStaticMarkup(createElement(DailySettings, { onChanged: noop }));
    for (const f of FLAIRS) expect(settings).toContain(f);
    expect(settings).toContain('Vacation');
    expect(settings).toContain('Show system notifications');
  });
});

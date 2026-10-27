import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnline } from '../../hooks/useOnline';
import { Leaderboard } from './Leaderboard';
import { Lobby } from './Lobby';
import type { Me } from '../../account/api';
import type { GameSetup } from '../../chess/game';
import type { AnalysedGame } from '../analysis/AnalysisView';
import { OnlineGame } from './OnlineGame';
import { TournamentPage } from './TournamentPage';
import { Tournaments } from './Tournaments';
import { DailyHome } from '../daily/DailyHome';
import { DailyGame } from '../daily/DailyGame';
import { DailyTourPage } from '../daily/DailyTourPage';

const ID = /^[A-Za-z0-9]{1,16}$/;

type Screen =
  | { kind: 'lobby' }
  | { kind: 'tours' }
  | { kind: 'leaders' }
  | { kind: 'tour'; id: string }
  | { kind: 'game'; id: string }
  | { kind: 'daily' }
  | { kind: 'dailyGame'; id: string }
  | { kind: 'dailyTour'; id: string };

/** The online screen named by the address: `?game=<id>`, `?tour=<id>`, `?tours`, `?leaders`, `?daily[=<game>]` or `?dailytour=<id>`. */
function screenFromUrl(): Screen {
  const q = new URLSearchParams(window.location.search);
  const game = q.get('game');
  const tour = q.get('tour');
  if (game && ID.test(game)) return { kind: 'game', id: game };
  if (tour && ID.test(tour)) return { kind: 'tour', id: tour };
  const daily = q.get('daily');
  const dailyTour = q.get('dailytour');
  if (daily && ID.test(daily)) return { kind: 'dailyGame', id: daily };
  if (dailyTour && ID.test(dailyTour)) return { kind: 'dailyTour', id: dailyTour };
  if (q.has('daily')) return { kind: 'daily' };
  if (q.has('tours')) return { kind: 'tours' };
  if (q.has('leaders')) return { kind: 'leaders' };
  return { kind: 'lobby' };
}

/** Whether the address points into online play, so the app opens that tab. */
export const linkedOnline = (): boolean => screenFromUrl().kind !== 'lobby';

const urlOf = (s: Screen) =>
  s.kind === 'game'
    ? `?game=${s.id}`
    : s.kind === 'tour'
      ? `?tour=${s.id}`
      : s.kind === 'tours'
        ? '?tours'
        : s.kind === 'leaders'
          ? '?leaders'
          : s.kind === 'daily'
            ? '?daily'
            : s.kind === 'dailyGame'
              ? `?daily=${s.id}`
              : s.kind === 'dailyTour'
                ? `?dailytour=${s.id}`
                : window.location.pathname;

interface Props {
  active: boolean;
  signedIn: boolean;
  /** Your account id, to find you in daily tournaments. */
  meId: string | null;
  /** Your game ratings, to grey out seeks whose rating range you're outside. */
  myRatings: Me['ratings'] | null;
  /** Starts a game against the computer on the Play tab. */
  onPlayComputer: (setup: GameSetup) => void;
  onSignIn: () => void;
  onOpenProfile: (name: string) => void;
  onAnalyse: (pgn: string, game?: AnalysedGame) => void;
}

export function OnlineView({ active, signedIn, meId, myRatings, onPlayComputer, onSignIn, onOpenProfile, onAnalyse }: Props) {
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const { client, state } = useOnline(active || screen.kind !== 'lobby');
  const seenStarted = useRef(0);
  const gameId = screen.kind === 'game' ? screen.id : null;

  const go = useCallback((s: Screen) => {
    setScreen(s);
    window.history.pushState(null, '', urlOf(s));
  }, []);
  const openTour = useCallback((id: string) => go({ kind: 'tour', id }), [go]);
  const openGame = useCallback((id: string) => go({ kind: 'game', id }), [go]);

  useEffect(() => {
    const onPop = () => setScreen(screenFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // seeks only live while the lobby is on screen
  useEffect(() => {
    client?.setLobby(active && screen.kind === 'lobby');
  }, [client, active, screen.kind]);

  useEffect(() => {
    if (!client || !gameId) return;
    client.watch(gameId);
    return () => client.unwatch(gameId);
  }, [client, gameId]);

  // a new game for this player (a seek accepted, a tournament pairing, or a reconnect) opens it
  useEffect(() => {
    const started = state.started;
    if (!started || started.n === seenStarted.current) return;
    seenStarted.current = started.n;
    const current = gameId ? state.games[gameId]?.snap : undefined;
    const playingHere = current && current.you && current.status === 'playing';
    if (active && started.game !== gameId && !playingHere) openGame(started.game);
  }, [state.started, state.games, gameId, active, openGame]);

  const connection =
    state.status === 'online' ? null : state.status === 'connecting' ? 'Connecting to the game server…' : 'Connection lost. Reconnecting…';
  const gameTour = gameId ? state.games[gameId]?.snap.tournament : null;

  return (
    <>
      {connection && (
        <p className="connection-banner" role="status">
          {connection}
        </p>
      )}
      {screen.kind !== 'game' && screen.kind !== 'dailyGame' && (
        <nav className="subnav" aria-label="Online play">
          <button type="button" className={screen.kind === 'lobby' ? 'on' : ''} onClick={() => go({ kind: 'lobby' })}>
            Lobby
          </button>
          <button type="button" className={screen.kind === 'tours' || screen.kind === 'tour' ? 'on' : ''} onClick={() => go({ kind: 'tours' })}>
            🏆 Tournaments
          </button>
          <button type="button" className={screen.kind === 'daily' || screen.kind === 'dailyTour' ? 'on' : ''} onClick={() => go({ kind: 'daily' })}>
            📅 Daily
          </button>
          <button type="button" className={screen.kind === 'leaders' ? 'on' : ''} onClick={() => go({ kind: 'leaders' })}>
            🏅 Leaderboard
          </button>
        </nav>
      )}
      {screen.kind === 'game' && client ? (
        <OnlineGame
          key={screen.id}
          gameId={screen.id}
          active={active}
          client={client}
          state={state}
          backLabel={gameTour ? `← ${gameTour.name}` : '← Lobby'}
          onBack={() => go(gameTour ? { kind: 'tour', id: gameTour.id } : { kind: 'lobby' })}
          onAnalyse={onAnalyse}
          onOpenProfile={onOpenProfile}
        />
      ) : screen.kind === 'tour' && client ? (
        <TournamentPage
          key={screen.id}
          id={screen.id}
          client={client}
          state={state}
          signedIn={signedIn}
          onSignIn={onSignIn}
          onBack={() => go({ kind: 'tours' })}
          onOpenGame={openGame}
          onOpenProfile={onOpenProfile}
        />
      ) : screen.kind === 'dailyGame' ? (
        <DailyGame
          key={screen.id}
          id={screen.id}
          active={active}
          onBack={() => go({ kind: 'daily' })}
          onOpenProfile={onOpenProfile}
          onOpenTour={id => go({ kind: 'dailyTour', id })}
          onAnalyse={pgn => onAnalyse(pgn)}
        />
      ) : screen.kind === 'dailyTour' ? (
        <DailyTourPage
          key={screen.id}
          id={screen.id}
          meId={meId}
          onSignIn={onSignIn}
          onBack={() => go({ kind: 'daily' })}
          onOpenGame={id => go({ kind: 'dailyGame', id })}
          onOpenProfile={onOpenProfile}
        />
      ) : screen.kind === 'daily' ? (
        <DailyHome
          signedIn={signedIn}
          onSignIn={onSignIn}
          onOpenGame={id => go({ kind: 'dailyGame', id })}
          onOpenTour={id => go({ kind: 'dailyTour', id })}
          onOpenProfile={onOpenProfile}
        />
      ) : screen.kind === 'leaders' ? (
        <Leaderboard onOpenProfile={onOpenProfile} />
      ) : screen.kind === 'tours' ? (
        <Tournaments client={client} state={state} signedIn={signedIn} onSignIn={onSignIn} onOpen={openTour} />
      ) : (
        <Lobby
          client={client}
          state={state}
          signedIn={signedIn}
          myRatings={myRatings}
          onPlayComputer={onPlayComputer}
          onSignIn={onSignIn}
          onOpenProfile={onOpenProfile}
          onWatch={openGame}
        />
      )}
    </>
  );
}

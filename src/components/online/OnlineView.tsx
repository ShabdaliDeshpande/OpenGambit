import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../../hooks/useOnline';
import { Lobby } from './Lobby';
import { OnlineGame } from './OnlineGame';

const GAME_ID = /^[A-Za-z0-9]{1,16}$/;

/** A game named by a `?game=<id>` link, if any. */
export function linkedGame(): string | null {
  const id = new URLSearchParams(window.location.search).get('game');
  return id && GAME_ID.test(id) ? id : null;
}

interface Props {
  active: boolean;
  onAnalyse: (pgn: string) => void;
}

export function OnlineView({ active, onAnalyse }: Props) {
  const [gameId, setGameId] = useState<string | null>(linkedGame);
  const { client, state } = useOnline(active || gameId !== null);
  const seenStarted = useRef(0);

  const open = (id: string | null) => {
    setGameId(id);
    const url = id ? `?game=${id}` : window.location.pathname;
    window.history.pushState(null, '', url);
  };

  useEffect(() => {
    const onPop = () => setGameId(linkedGame());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // seeks only live while the lobby is on screen
  useEffect(() => {
    client?.setLobby(active && gameId === null);
  }, [client, active, gameId]);

  useEffect(() => {
    if (!client || !gameId) return;
    client.watch(gameId);
    return () => client.unwatch(gameId);
  }, [client, gameId]);

  // a new game for this player (a seek was accepted, or a reconnect found one) opens it
  useEffect(() => {
    const started = state.started;
    if (!started || started.n === seenStarted.current) return;
    seenStarted.current = started.n;
    const current = gameId ? state.games[gameId]?.snap : undefined;
    const playingHere = current && current.you && current.status === 'playing';
    if (active && started.game !== gameId && !playingHere) open(started.game);
  }, [state.started, state.games, gameId, active]);

  const connection =
    state.status === 'online' ? null : state.status === 'connecting' ? 'Connecting to the game server…' : 'Connection lost. Reconnecting…';

  return (
    <>
      {connection && (
        <p className="connection-banner" role="status">
          {connection}
        </p>
      )}
      {gameId && client ? (
        <OnlineGame
          key={gameId}
          gameId={gameId}
          active={active}
          client={client}
          state={state}
          onBack={() => open(null)}
          onAnalyse={onAnalyse}
        />
      ) : (
        <Lobby client={client} state={state} onWatch={id => open(id)} />
      )}
    </>
  );
}

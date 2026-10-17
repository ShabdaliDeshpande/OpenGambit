import { useEffect, useState, useSyncExternalStore } from 'react';
import { onlineClient, type OnlineClient, type OnlineState } from '../online/client';

const IDLE: OnlineState = { status: 'connecting', me: null, lobby: null, games: {}, error: null, started: null };
const noSubscribe = () => () => undefined;
const idle = () => IDLE;

/** Connects to the game server the first time `enabled` is true, then stays connected. */
export function useOnline(enabled: boolean): { client: OnlineClient | null; state: OnlineState } {
  const [client, setClient] = useState<OnlineClient | null>(null);
  useEffect(() => {
    if (enabled && !client) setClient(onlineClient());
  }, [enabled, client]);
  const state = useSyncExternalStore(client?.subscribe ?? noSubscribe, client?.getState ?? idle);
  return { client, state };
}

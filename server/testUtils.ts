import type { GameSnapshot, ServerMessage } from '../src/online/protocol.ts';
import { makeConfig, type ServerConfig } from './config.ts';
import { Hub } from './hub.ts';
import type { Store } from './store.ts';
import type { Account, Conn } from './types.ts';

export interface TestClient {
  conn: Conn;
  inbox: ServerMessage[];
  closed: boolean;
  send: (msg: object) => void;
  last: <T extends ServerMessage['t']>(t: T) => Extract<ServerMessage, { t: T }> | undefined;
  game: () => GameSnapshot;
  errors: () => string[];
}

/** A hub with fast timeouts and a fixed coin, driven by vitest fake timers. */
export function testHub(overrides: Partial<ServerConfig> = {}, store: Store | null = null) {
  const cfg = makeConfig({
    random: () => 0.25,
    firstMoveMs: () => 20_000,
    disconnectMs: () => 30_000,
    byeMs: 10_000,
    // test clients never answer pings
    staleMs: Number.POSITIVE_INFINITY,
    ...overrides,
  });
  const hub = new Hub(cfg, store);

  const client = (account: Account | null = null): TestClient => {
    const inbox: ServerMessage[] = [];
    const c: TestClient = {
      conn: null as unknown as Conn,
      inbox,
      closed: false,
      send: msg => hub.receive(c.conn, JSON.stringify(msg)),
      last: t => [...inbox].reverse().find(m => m.t === t) as never,
      game: () => {
        const g = c.last('game');
        if (!g) throw new Error('no game snapshot');
        return g.game;
      },
      errors: () => inbox.flatMap(m => (m.t === 'error' ? [m.message] : [])),
    };
    c.conn = hub.connect(
      m => inbox.push(m),
      () => {
        c.closed = true;
      },
      account,
    );
    return c;
  };

  /** Connects a client and says hello (optionally reusing a token, or signed in). */
  const join = (token?: string | null, account: Account | null = null) => {
    const c = client(account);
    c.send({ t: 'hello', ...(token ? { token } : {}) });
    return c;
  };

  /** Two players paired in a new game, both watching it. White is `a`. */
  const pair = (tc = '5+0') => {
    const a = join();
    const b = join();
    a.send({ t: 'lobby', on: true });
    b.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc, color: 'w' });
    const seek = b.last('lobby')!.lobby.seeks[0]!;
    b.send({ t: 'acceptSeek', id: seek.id });
    const id = a.last('started')!.game;
    a.send({ t: 'watch', game: id });
    b.send({ t: 'watch', game: id });
    let ply = 0;
    const move = (who: TestClient, uci: string) => who.send({ t: 'move', game: id, uci, ply: ply++ });
    return { a, b, id, move, room: () => hub.room(id)! };
  };

  return { hub, cfg, client, join, pair, disconnect: (c: TestClient) => hub.disconnect(c.conn) };
}

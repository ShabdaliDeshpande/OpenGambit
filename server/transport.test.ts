import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { WebSocket as NodeWs } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/online/protocol.ts';
import { attachGameServer, sameOrigin } from './transport.ts';

let server: Server | null = null;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise(resolve => server?.close(resolve) ?? resolve(null));
  server = null;
});

async function start(): Promise<string> {
  server = createServer((_req, res) => res.end('ok'));
  attachGameServer(server, { pingMs: 200 });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
}

/** A WebSocket client that collects messages and can wait for one. */
async function open(url: string) {
  const ws = new WebSocket(url);
  const inbox: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.t === 'ping') ws.send(JSON.stringify({ t: 'pong', s: msg.s }));
    inbox.push(msg);
    for (const w of waiters.splice(0)) w();
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  const next = async <T extends ServerMessage['t']>(t: T, ok: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) => {
    const deadline = Date.now() + 3_000;
    for (;;) {
      const found = inbox.find(m => m.t === t && ok(m as never));
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return found as Extract<ServerMessage, { t: T }>;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}`);
      await new Promise<void>(resolve => {
        waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  };
  return { ws, send, next };
}

it('pairs two players over WebSockets, relays moves to a spectator and resumes after a reconnect', async () => {
  const url = await start();
  const alice = await open(url);
  const bob = await open(url);
  alice.send({ t: 'hello' });
  bob.send({ t: 'hello' });
  await alice.next('welcome');
  const bobWelcome = await bob.next('welcome');

  alice.send({ t: 'lobby', on: true });
  bob.send({ t: 'lobby', on: true });
  alice.send({ t: 'seek', tc: '3+2', color: 'w' });
  const lobby = await bob.next('lobby', m => m.lobby.seeks.length === 1);
  bob.send({ t: 'acceptSeek', id: lobby.lobby.seeks[0]!.id });
  const { game } = await alice.next('started');
  await bob.next('started');
  alice.send({ t: 'watch', game });
  bob.send({ t: 'watch', game });

  const viewer = await open(url);
  viewer.send({ t: 'hello' });
  await viewer.next('welcome');
  viewer.send({ t: 'watch', game });
  await viewer.next('game', m => m.game.spectators === 1);

  alice.send({ t: 'move', game, uci: 'e2e4', ply: 0 });
  await bob.next('game', m => m.game.moves.length === 1);
  bob.send({ t: 'move', game, uci: 'c7c5', ply: 1 });
  const seen = await viewer.next('game', m => m.game.moves.length === 2);
  expect(seen.game).toMatchObject({ you: null, moves: ['e2e4', 'c7c5'], clock: { running: 'w' } });

  // Bob's connection drops; Alice sees it, then Bob comes back with his token
  bob.ws.close();
  await alice.next('game', m => !m.game.black.online && m.game.opponentGone !== null);
  const again = await open(url);
  again.send({ t: 'hello', token: bobWelcome.token });
  expect((await again.next('welcome')).id).toBe(bobWelcome.id);
  expect((await again.next('started')).game).toBe(game);
  again.send({ t: 'watch', game });
  const resumed = await again.next('game');
  expect(resumed.game).toMatchObject({ you: 'b', moves: ['e2e4', 'c7c5'], status: 'playing' });
  await alice.next('game', m => m.game.black.online);

  again.send({ t: 'resign', game });
  const over = await viewer.next('game', m => m.game.status === 'finished');
  expect(over.game.result).toMatchObject({ winner: 'w', reason: 'resign' });

  for (const c of [alice, again, viewer]) c.ws.close();
});

it('leaves other upgrade paths alone', async () => {
  const url = await start();
  // stands in for another handler, such as Vite's hot reload socket
  const others: string[] = [];
  server!.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') {
      others.push(req.url ?? '');
      socket.destroy();
    }
  });
  const other = new WebSocket(url.replace('/ws', '/elsewhere'));
  const result = await new Promise(resolve => {
    other.onopen = () => resolve('open');
    other.onerror = () => resolve('error');
    setTimeout(() => resolve('pending'), 1_000);
  });
  expect(result).toBe('error');
  expect(others).toEqual(['/elsewhere']);
  other.close();
});

it('refuses browser sockets from other sites and too many sockets from one address', async () => {
  server = createServer((_req, res) => res.end('ok'));
  attachGameServer(server, {}, { maxConnsPerIp: 2 });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const attempt = (origin?: string) =>
    new Promise<{ ok: boolean; ws: NodeWs }>(resolve => {
      const ws = new NodeWs(url, origin ? { origin } : {});
      ws.on('open', () => resolve({ ok: true, ws }));
      ws.on('error', () => resolve({ ok: false, ws }));
    });

  expect((await attempt('https://elsewhere.example')).ok).toBe(false);
  const first = await attempt(`http://127.0.0.1:${port}`);
  const second = await attempt();
  expect([first.ok, second.ok]).toEqual([true, true]);
  expect((await attempt()).ok).toBe(false); // third from the same address
  first.ws.close();
  await new Promise(resolve => first.ws.on('close', resolve));
  await new Promise(resolve => setTimeout(resolve, 50));
  const again = await attempt();
  expect(again.ok).toBe(true); // a slot is free again
  second.ws.close();
  again.ws.close();
});

it('compares the Origin host with the Host header', () => {
  const req = (origin: string | undefined, host: string) => ({ headers: { origin, host } }) as unknown as IncomingMessage;
  expect(sameOrigin(req('https://chess.example', 'chess.example'))).toBe(true);
  expect(sameOrigin(req('http://localhost:5173', 'localhost:5173'))).toBe(true);
  expect(sameOrigin(req('https://evil.example', 'chess.example'))).toBe(false);
  expect(sameOrigin(req('not a url', 'chess.example'))).toBe(false);
  expect(sameOrigin(req(undefined, 'chess.example'))).toBe(true);
});

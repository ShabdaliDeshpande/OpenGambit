import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH } from '../src/online/protocol.ts';
import { makeConfig, type ServerConfig } from './config.ts';
import { Hub } from './hub.ts';
import type { Store } from './store.ts';
import type { Account } from './types.ts';

export interface TransportOptions {
  /** Read the client address from X-Forwarded-For (only behind a proxy you trust). */
  trustProxy?: boolean;
  maxConnsPerIp?: number;
  maxConns?: number;
  /** Saves finished games and ratings; without it, everyone plays as a guest. */
  store?: Store;
  /** Finds the signed-in account from the upgrade request's session cookie. */
  identify?: (req: IncomingMessage) => Promise<Account | null>;
}

/**
 * Browsers always send Origin on WebSocket requests. Only pages served from
 * this same host may connect, so another site can't open a socket in a
 * visitor's name. Clients without Origin (not browsers) are allowed.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return (trustProxy && first) || req.socket.remoteAddress || 'unknown';
}

/**
 * Serves the game WebSocket at /ws on an existing HTTP server (the Vite dev
 * server or the standalone one). Other upgrade requests, such as Vite's hot
 * reload socket, are left alone.
 */
export function attachGameServer(http: Server, overrides: Partial<ServerConfig> = {}, options: TransportOptions = {}): Hub {
  const { trustProxy = false, maxConnsPerIp = 20, maxConns = 2_000, identify } = options;
  const hub = new Hub(makeConfig(overrides), options.store ?? null);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const perIp = new Map<string, number>();

  http.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== WS_PATH) return;
    const ip = clientIp(req, trustProxy);
    const reject = (status: string) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    if (!sameOrigin(req)) return reject('403 Forbidden');
    if (wss.clients.size >= maxConns || (perIp.get(ip) ?? 0) >= maxConnsPerIp) return reject('429 Too Many Requests');
    // count the socket now, so slow account lookups can't be used to get past the limit
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const release = () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
    };

    (identify ? identify(req) : Promise.resolve(null))
      .catch(err => {
        console.error('Session lookup failed:', err);
        return null;
      })
      .then(account => {
        if (socket.destroyed) return release();
        wss.handleUpgrade(req, socket, head, ws => upgraded(ws, account, release));
      });
  });

  const upgraded = (ws: WebSocket, account: Account | null, release: () => void) => {
    const conn = hub.connect(
      msg => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      () => ws.terminate(),
      account,
    );
    ws.on('message', (data, isBinary) => {
      if (!isBinary) hub.receive(conn, data.toString());
    });
    ws.on('close', () => {
      release();
      hub.disconnect(conn);
    });
    ws.on('error', () => ws.terminate());
  };

  http.on('close', () => {
    hub.stop();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
  return hub;
}

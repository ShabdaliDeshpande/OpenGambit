// Standalone server: serves the built app from dist/, the account API and the
// game WebSocket. Run `npm run build` first, then `npm start`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WS_PATH } from '../src/online/protocol.ts';
import { startBackend } from './backend.ts';

const ROOT = resolve(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const backend = await startBackend();

const server = createServer((req, res) => {
  if ((req.url ?? '').startsWith('/api/')) return backend.api(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  // unknown paths get the app itself
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});

// TRUST_PROXY=1 when running behind a hosting proxy, so limits use the real client address
backend.attach(server, { maxConnsPerIp: Number(process.env.MAX_CONNS_PER_IP ?? 20) });
// nothing else is upgraded here
server.on('upgrade', (req, socket) => {
  if ((req.url ?? '').split('?')[0] !== WS_PATH) socket.destroy();
});
server.listen(PORT, HOST, () => console.log(`Chess app on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`));

// hosts stop containers with SIGTERM: close sockets and exit promptly
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 3_000).unref();
  });

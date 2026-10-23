// End-to-end check of server-side analysis against a server started with
// ANALYSIS_QUEUE=1: two accounts play a short game, one asks the server to
// analyse it, and the saved review and accuracy appear.
// Usage: ANALYSIS_QUEUE=1 npm start, then node scripts/smoke-server-analysis.ts [http://localhost:8787]
import { WebSocket } from 'ws';

const base = process.argv[2] ?? 'http://localhost:8787';
const suffix = Date.now().toString(36).slice(-5);

async function signUp(name: string) {
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username: name, password: 'smoke-test-pass' }),
  });
  if (!res.ok) throw new Error(`signup ${name}: ${res.status} ${await res.text()}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

function connect(cookie: string) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { cookie, origin: base } });
  const inbox: any[] = [];
  ws.on('message', data => {
    const m = JSON.parse(String(data));
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', s: m.s }));
    inbox.push(m);
  });
  const send = (m: object) => ws.send(JSON.stringify(m));
  const wait = async (pred: (m: any) => boolean) => {
    for (let i = 0; i < 60; i++) {
      const m = inbox.find(pred);
      if (m) {
        inbox.splice(inbox.indexOf(m), 1);
        return m;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('timed out');
  };
  return new Promise<{ ws: WebSocket; send: typeof send; wait: typeof wait }>(resolve => ws.on('open', () => resolve({ ws, send, wait })));
}

const status = async (game: string) => (await (await fetch(`${base}/api/games/${game}/analysis`)).json()) as { enabled: boolean; status: string };

const [an, bn] = [`srvA${suffix}`, `srvB${suffix}`];
const cookieA = await signUp(an);
const a = await connect(cookieA);
const b = await connect(await signUp(bn));
a.send({ t: 'hello' });
b.send({ t: 'hello' });
await a.wait(m => m.t === 'welcome');
await b.wait(m => m.t === 'welcome');
a.send({ t: 'lobby', on: true });
b.send({ t: 'lobby', on: true });
a.send({ t: 'seek', tc: '3+2', color: 'w', rated: false });
b.send({ t: 'seek', tc: '3+2', color: 'b', rated: false });
const { game } = await a.wait(m => m.t === 'started');
a.send({ t: 'watch', game });
b.send({ t: 'watch', game });
const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
for (const [ply, uci] of moves.entries()) {
  (ply % 2 ? b : a).send({ t: 'move', game, uci, ply });
  await (ply % 2 ? a : b).wait(m => m.t === 'game' && m.game.moves.length === ply + 1);
}
await a.wait(m => m.t === 'game' && m.game.status !== 'playing');
await new Promise(r => setTimeout(r, 300));

const before = await status(game);
if (!before.enabled) throw new Error('the server has no analysis queue: start it with ANALYSIS_QUEUE=1');
const asked = await fetch(`${base}/api/games/${game}/analysis`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: cookieA }, body: '{}' });
console.log('requested', asked.status, JSON.stringify(await asked.json()));
let now = before;
for (let i = 0; i < 120 && now.status !== 'done'; i++) {
  await new Promise(r => setTimeout(r, 500));
  now = await status(game);
}
console.log('status', now.status);
const review = (await (await fetch(`${base}/api/games/${game}/review`)).json()) as { review: { engine: string; kinds: string } | null };
console.log('review', review.review?.engine, review.review?.kinds);
const profile = (await (await fetch(`${base}/api/users/${an}`)).json()) as { games: { id: string; review: unknown }[] };
console.log('history', JSON.stringify(profile.games.find(g => g.id === game)?.review));
a.ws.close();
b.ws.close();

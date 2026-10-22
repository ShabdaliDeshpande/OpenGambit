// End-to-end check against a running server: two accounts play a short game
// over the WebSocket, one of them saves a review of it, and the accuracy shows
// up in both players' game history. The review's scores are written by hand
// here (the engine runs in the browser); the server checks them and works out
// the accuracy itself.
// Usage: node scripts/smoke-review.ts [http://localhost:5173]
import { WebSocket } from 'ws';
import { REVIEW_VERSION, type StoredReview } from '../src/analysis/reviewData.ts';

const base = process.argv[2] ?? 'http://localhost:5173';
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

const [an, bn] = [`revA${suffix}`, `revB${suffix}`];
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
// 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#
const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
for (const [ply, uci] of moves.entries()) {
  (ply % 2 ? b : a).send({ t: 'move', game, uci, ply });
  await (ply % 2 ? a : b).wait(m => m.t === 'game' && m.game.moves.length === ply + 1);
}
await a.wait(m => m.t === 'game' && m.game.status !== 'playing');
await new Promise(r => setTimeout(r, 300)); // the server saves the finished game

const scores = ['c:20', 'c:30', 'c:30', 'c:40', 'c:30', 'c:0', 'm:1', 'x:b'];
const review: StoredReview = {
  v: REVIEW_VERSION,
  engine: 'smoke-test',
  ms: 600,
  positions: scores.map((s, i) => ({ s, ...(i < moves.length ? { b: i === 5 ? 'g7g6' : moves[i]! } : {}) })),
  kinds: 'SSSSSUS',
};
const saved = await fetch(`${base}/api/games/${game}/review`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base, cookie: cookieA },
  body: JSON.stringify({ review }),
});
if (!saved.ok) throw new Error(`save review: ${saved.status} ${await saved.text()}`);
const body = (await saved.json()) as { saved: boolean; accuracy: { white: number; black: number } };
console.log('saved', body.saved, 'accuracy white', body.accuracy.white, 'black', body.accuracy.black);

const back = (await (await fetch(`${base}/api/games/${game}/review`)).json()) as { review: StoredReview };
console.log('read back', back.review.kinds === review.kinds && back.review.positions.length === scores.length);
for (const name of [an, bn]) {
  const profile = (await (await fetch(`${base}/api/users/${name}`)).json()) as { games: { id: string; review: unknown }[] };
  console.log('history', name, JSON.stringify(profile.games.find(g => g.id === game)?.review));
}
a.ws.close();
b.ws.close();

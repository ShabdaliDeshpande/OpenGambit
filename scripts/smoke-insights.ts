// End-to-end check of insights against a running server: two accounts play
// three short games (with clocks), one saves a review, insights stay private
// until made public, and the numbers add up.
// Usage: node scripts/smoke-insights.ts [http://localhost:5173]
import { WebSocket } from 'ws';
import { REVIEW_VERSION } from '../src/analysis/reviewData.ts';

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
    for (let i = 0; i < 80; i++) {
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

const post = (path: string, body: unknown, cookie: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify(body) });

const [an, bn] = [`insA${suffix}`, `insB${suffix}`];
const [cookieA, cookieB] = [await signUp(an), await signUp(bn)];
const a = await connect(cookieA);
const b = await connect(cookieB);
for (const c of [a, b]) c.send({ t: 'hello' });
await a.wait(m => m.t === 'welcome');
await b.wait(m => m.t === 'welcome');
for (const c of [a, b]) c.send({ t: 'lobby', on: true });

/** Plays a game; `white` moves first. Ends by checkmate or resignation. */
async function play(white: typeof a, black: typeof a, moves: string[], resign: 'w' | 'b' | null, rated: boolean) {
  white.send({ t: 'seek', tc: '3+2', color: 'w', rated });
  black.send({ t: 'seek', tc: '3+2', color: 'b', rated });
  const { game } = await white.wait(m => m.t === 'started');
  await black.wait(m => m.t === 'started');
  white.send({ t: 'watch', game });
  black.send({ t: 'watch', game });
  for (const [ply, uci] of moves.entries()) {
    await new Promise(r => setTimeout(r, 120)); // some thinking time, so the clocks move
    (ply % 2 ? black : white).send({ t: 'move', game, uci, ply });
    await (ply % 2 ? white : black).wait(m => m.t === 'game' && m.game.moves.length === ply + 1);
  }
  if (resign) (resign === 'w' ? white : black).send({ t: 'resign', game });
  await white.wait(m => m.t === 'game' && m.game.status !== 'playing');
  await new Promise(r => setTimeout(r, 300));
  return game as string;
}

const mate = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
const g1 = await play(a, b, mate, null, true); // A wins as White
await play(b, a, ['d2d4', 'd7d5', 'c2c4', 'e7e6'], 'w', true); // A wins as Black (B resigns)
await play(a, b, ['e2e4', 'c7c5', 'g1f3', 'd7d6'], 'w', false); // A resigns as White
console.log('three games played');

const scores = ['c:20', 'c:30', 'c:30', 'c:40', 'c:30', 'c:0', 'm:1', 'x:b'];
const saved = await post(`/api/games/${g1}/review`, { review: { v: REVIEW_VERSION, engine: 'smoke', ms: 600, positions: scores.map(s => ({ s })), kinds: 'SSSSSUS' } }, cookieA);
console.log('review saved', saved.status);

const tz = encodeURIComponent('Asia/Kolkata');
console.log('others before public:', (await fetch(`${base}/api/insights/${an}?tz=${tz}`, { headers: { cookie: cookieB } })).status);
await post('/api/account/insights', { public: true }, cookieA);
const res = await fetch(`${base}/api/insights/${an}?tz=${tz}`);
const { insights } = (await res.json()) as { insights: any };
console.log('after public:', res.status, 'games', insights.games);
console.log('by colour', JSON.stringify(insights.results.byColor));
console.log('rating points', JSON.stringify(Object.fromEntries(Object.entries(insights.rating).map(([k, v]) => [k, (v as unknown[]).length]))));
console.log('accuracy', insights.accuracy.reviewed, 'reviewed, average', insights.accuracy.average);
console.log('time', insights.time.games, 'timed games,', JSON.stringify(insights.time.perMove));
console.log('openings', insights.openings.map((o: any) => o.label).join(' | '));
a.ws.close();
b.ws.close();

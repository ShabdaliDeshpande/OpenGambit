// End-to-end check of the opening explorer against a running server: two
// accounts play a short game, which then shows up in the OpenGambit tab and
// in each player's own games. If master games and opening names have been
// imported (npm run explorer:import / openings:import), those are shown too.
// Usage: node scripts/smoke-explorer.ts [http://localhost:5173]
import { WebSocket } from 'ws';

const base = process.argv[2] ?? 'http://localhost:5173';
const suffix = Date.now().toString(36).slice(-5);
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

const show = (label: string, body: any) =>
  console.log(label, body.available === false ? '(nothing imported)' : body.moves.map((m: any) => `${m.san} ${m.white}/${m.draws}/${m.black}${m.averageRating ? ` @${m.averageRating}` : ''}`).join(', ') || '(none)');

const cookieA = await signUp(`expA${suffix}`);
const cookieB = await signUp(`expB${suffix}`);
const a = await connect(cookieA);
const b = await connect(cookieB);
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

const q = (source: string, extra = '') => `${base}/api/explorer?source=${source}&fen=${encodeURIComponent(START)}${extra}`;
show('opengambit', await (await fetch(q('site'))).json());
show('masters', await (await fetch(q('masters'))).json());
show('my games as white', await (await fetch(q('mine', '&color=w'), { headers: { cookie: cookieA } })).json());
show('my games as black (Black player)', await (await fetch(`${base}/api/explorer?source=mine&color=b&fen=${encodeURIComponent('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')}`, { headers: { cookie: cookieB } })).json());
console.log('guest asking for my games:', (await fetch(q('mine'))).status);
console.log('opening:', JSON.stringify((await (await fetch(`${base}/api/opening?moves=${moves.slice(0, 4).join(',')}`)).json()).opening));
console.log('book:', JSON.stringify((await (await fetch(`${base}/api/explorer/book?moves=${moves.join(',')}`)).json()).book));
a.ws.close();
b.ws.close();

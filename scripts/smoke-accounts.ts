// End-to-end check against a running server: two accounts sign up, play a
// rated game over the WebSocket and see it on their profiles.
// Usage: node scripts/smoke-accounts.ts [http://localhost:5173]
import { WebSocket } from 'ws';

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

const [an, bn] = [`smokeA${suffix}`, `smokeB${suffix}`];
const a = await connect(await signUp(an));
const b = await connect(await signUp(bn));
a.send({ t: 'hello' });
b.send({ t: 'hello' });
console.log('welcome', (await a.wait(m => m.t === 'welcome')).name, (await b.wait(m => m.t === 'welcome')).registered);
a.send({ t: 'lobby', on: true });
b.send({ t: 'lobby', on: true });
a.send({ t: 'seek', tc: '3+2', color: 'w', rated: true });
b.send({ t: 'seek', tc: '3+2', color: 'b', rated: true });
const { game } = await a.wait(m => m.t === 'started');
a.send({ t: 'watch', game });
b.send({ t: 'watch', game });
const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
for (const [ply, uci] of moves.entries()) {
  (ply % 2 ? b : a).send({ t: 'move', game, uci, ply });
  await (ply % 2 ? a : b).wait(m => m.t === 'game' && m.game.moves.length === ply + 1);
}
const scored = await a.wait(m => m.t === 'game' && m.game.white.diff !== null);
console.log('result', scored.game.result.reason, 'white', scored.game.white.rating.rating, 'diff', scored.game.white.diff, 'black diff', scored.game.black.diff);
const profile = await (await fetch(`${base}/api/users/${an}`)).json();
console.log('profile', profile.user.username, 'blitz', profile.ratings.blitz, 'games', profile.totalGames, profile.games[0].id === game);
a.ws.close();
b.ws.close();

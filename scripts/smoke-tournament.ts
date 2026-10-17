// End-to-end check against a running server: four accounts play a short
// Swiss over the WebSocket, and the finished tournament is saved.
// Usage: node scripts/smoke-tournament.ts [http://localhost:5173]
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

async function connect(name: string) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { cookie: await signUp(name), origin: base } });
  const inbox: any[] = [];
  ws.on('message', data => {
    const m = JSON.parse(String(data));
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', s: m.s }));
    inbox.push(m);
  });
  await new Promise(resolve => ws.on('open', resolve));
  const send = (m: object) => ws.send(JSON.stringify(m));
  send({ t: 'hello' });
  return { name, ws, inbox, send };
}

const wait = async <T>(get: () => T | undefined, what: string, ms = 15_000): Promise<T> => {
  for (let t = 0; t < ms; t += 100) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const players = await Promise.all(['A', 'B', 'C', 'D'].map(n => connect(`tour${n}${suffix}`)));
const [host] = players;
host!.send({
  t: 'createTour',
  tour: { kind: 'swiss', name: 'Smoke Swiss', tc: '3+2', rated: true, startInMin: 1, durationMin: 0, berserk: false, nbRounds: 3, roundIntervalSec: 10 },
});
const id: string = (await wait(() => host!.inbox.find(m => m.t === 'tourCreated'), 'tourCreated')).id;
for (const p of players.slice(1)) p.send({ t: 'joinTour', id });
host!.send({ t: 'watchTour', id });
const latest = () => [...host!.inbox].reverse().find(m => m.t === 'tour')?.tour;
await wait(() => (latest()?.players === 4 ? true : undefined), 'four players');
console.log('created', id, 'players', latest().players, 'starts in', Math.round(latest().msToStart / 1000), 's');

const seen = new Set<string>();
for (let round = 1; round <= 3; round++) {
  await wait(() => (latest()?.round === round && latest()?.games.length === 2 ? true : undefined), `round ${round}`, 90_000);
  console.log(`round ${round}:`, latest().games.map((g: any) => `${g.white}-${g.black}`).join(', '));
  for (const g of latest().games) {
    seen.add([g.white, g.black].sort().join('|'));
    // each game: White plays e4, Black e5, then Black resigns
    const white = players.find(p => p.name === g.white)!;
    const black = players.find(p => p.name === g.black)!;
    white.send({ t: 'move', game: g.id, uci: 'e2e4', ply: 0 });
    await new Promise(r => setTimeout(r, 150));
    black.send({ t: 'move', game: g.id, uci: 'e7e5', ply: 1 });
    await new Promise(r => setTimeout(r, 150));
    black.send({ t: 'resign', game: g.id });
  }
}
const final = await wait(() => (latest()?.status === 'finished' ? latest() : undefined), 'finish', 30_000);
console.log('finished; standings', final.standings.map((s: any) => `${s.rank}. ${s.name} ${s.score} (SB ${s.tieBreak})`).join(' | '));
console.log('distinct pairings', seen.size, 'of 6 possible; no repeats:', seen.size === 6);
await new Promise(r => setTimeout(r, 500));
const saved = await (await fetch(`${base}/api/tournaments/${id}`)).json();
console.log('saved winner', saved.tournament.winnerName, 'players', saved.tournament.players);
for (const p of players) p.ws.close();

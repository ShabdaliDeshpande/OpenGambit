// End-to-end check of daily chess against a running server started with
// DAILY_TEST_CLOCK=1: two accounts pair through a seek, each moves, a
// conditional reply is played automatically, and a timeout is reached by
// moving the server's daily clock forward.
// Usage: DAILY_TEST_CLOCK=1 npm start, then node scripts/smoke-daily.ts [http://localhost:8787]

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

async function post<T>(path: string, body: unknown, cookie: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
  return data;
}
const get = async <T>(path: string, cookie: string) => (await (await fetch(`${base}${path}`, { headers: { cookie } })).json()) as T;

type Game = { game: { moves: string[]; status: string; result: string | null; reason: string | null; turn: string } };

const [a, b] = [await signUp(`dayA${suffix}`), await signUp(`dayB${suffix}`)];
const { id: seek } = await post<{ id: string }>('/api/daily/seeks', { days: 3, color: 'w', rated: true }, a);
const { game: id } = await post<{ game: string }>(`/api/daily/seeks/${seek}/accept`, {}, b);
console.log('paired through a seek:', id);

await post<Game>(`/api/daily/games/${id}/move`, { uci: 'e2e4', ply: 0 }, a);
await post<Game>(`/api/daily/games/${id}/move`, { uci: 'e7e5', ply: 1 }, b);
await post<Game>(`/api/daily/games/${id}/move`, { uci: 'g1f3', ply: 2 }, a);
console.log('a move each, then White again');

const { lines } = await post<{ lines: string[][] }>(`/api/daily/games/${id}/lines`, { lines: [['b8c6', 'f1c4'], ['g8f6', 'f3e5']] }, a);
console.log('White prepares conditional lines:', JSON.stringify(lines));
const after = await post<Game>(`/api/daily/games/${id}/move`, { uci: 'b8c6', ply: 3 }, b);
console.log('Black plays Nc6; moves now', after.game.moves.join(' '), '· to move:', after.game.turn);

const kinds = async (cookie: string) => (await get<{ list: { kind: string }[] }>('/api/notifications', cookie)).list.map(n => n.kind).join(', ');
console.log('White was told:', await kinds(a));

const clock = await post<{ now: number }>('/api/daily/test-clock', { ms: 4 * 86_400_000 }, a);
console.log('daily clock moved 4 days ahead, to', new Date(clock.now).toISOString());
const ended = await get<Game>(`/api/daily/games/${id}`, a);
console.log('game:', ended.game.status, ended.game.result, ended.game.reason);
console.log('Black was told:', await kinds(b));
const ratings = await get<{ user: { ratings: Record<string, { rating: number; games: number }> } }>('/api/me', a);
console.log('White’s daily rating:', JSON.stringify(ratings.user.ratings.correspondence));

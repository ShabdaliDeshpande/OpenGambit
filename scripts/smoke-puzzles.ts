// End-to-end check against a running server: a new account solves a puzzle,
// misses one, and sees its puzzle rating, dashboard and the daily puzzle.
// Usage: node scripts/smoke-puzzles.ts [http://localhost:5173]
import { BUILTIN_PUZZLES } from '../src/puzzles/builtin.ts';

const base = process.argv[2] ?? 'http://localhost:5173';
const name = `puz${Date.now().toString(36).slice(-6)}`;

const signup = await fetch(`${base}/api/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ username: name, password: 'smoke-test-pass' }),
});
if (!signup.ok) throw new Error(`signup: ${signup.status}`);
const cookie = (signup.headers.get('set-cookie') ?? '').split(';')[0]!;
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify(body) });
const get = async (path: string) => (await fetch(base + path, { headers: { cookie } })).json();

// a puzzle near a new player's 1500, as training picks them, and an easy one to miss
const near = [...BUILTIN_PUZZLES].sort((a, b) => Math.abs(a.rating - 1500) - Math.abs(b.rating - 1500))[0]!;
const hard = near;
const easy = [...BUILTIN_PUZZLES].sort((a, b) => a.rating - b.rating)[0]!;
const themed = BUILTIN_PUZZLES.find(p => p.themes.includes('mateIn2') && p.id !== near.id)!;
const weighted = await (await post('/api/puzzles/attempt', { id: themed.id, win: true, moves: themed.solution, theme: 'mateIn2' })).json();
console.log(`solved ${themed.id} while training "Mate in 2" (counts 10%):`, weighted);
const solved = await (await post('/api/puzzles/attempt', { id: hard.id, win: true, moves: hard.solution })).json();
console.log(`solved ${hard.id} (rated ${hard.rating}):`, solved);
const fake = await post('/api/puzzles/attempt', { id: easy.id, win: true, moves: [] });
console.log('fake solve refused:', fake.status, (await fake.json()).error);
const missed = await (await post('/api/puzzles/attempt', { id: easy.id, win: false })).json();
console.log(`missed ${easy.id} (rated ${easy.rating}):`, missed);
const me = await get('/api/me');
console.log('puzzle rating on /api/me:', me.user.puzzleRating);
const { dashboard } = await get('/api/puzzles/dashboard');
console.log('dashboard:', { played: dashboard.played, firstWins: dashboard.firstWins, successRate: dashboard.successRate, chart: dashboard.chart.length, history: dashboard.history.length });
console.log('daily:', await get('/api/puzzles/daily'));

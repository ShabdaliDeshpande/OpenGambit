// Sets the bots' approximate ratings: plays each bot against its neighbours in
// the gallery and against the engine levels closest to it, plays the levels
// against each other, and fits Elo-style ratings to all the results. Level 1
// is pinned at 400, so the numbers are relative to that, not measured from
// games against people. Games run in parallel worker threads.
//
// Usage: npm run bots:rate -- [--games 8] [--workers 20]
//   --games is per pairing (half with each colour).
import { cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { Chess } from 'chess.js';
import { BOTS, type Bot } from '../src/bots/bots.ts';
import { repertoireMove } from '../src/bots/repertoire.ts';
import { chooseMove, LEVELS, MAX_LEVEL, MIN_LEVEL } from '../src/engine/search.ts';

const ANCHOR = 'level 1';
const ANCHOR_RATING = 400;
const MAX_PLIES = 240;

// short, common starts so the games don't all repeat one line
const OPENINGS = ['e2e4 e7e5', 'd2d4 d7d5', 'e2e4 c7c5', 'c2c4 g8f6', 'e2e4 e7e6', 'd2d4 g8f6', 'g1f3 d7d5', 'e2e4 c7c6'];

type Player = { kind: 'bot'; bot: Bot } | { kind: 'level'; level: number };
interface Task {
  id: number;
  white: string;
  black: string;
  opening: string;
}

const players = new Map<string, Player>([
  ...BOTS.map(b => [b.name, { kind: 'bot', bot: b }] as [string, Player]),
  ...LEVELS.map((_l, i) => [`level ${i + 1}`, { kind: 'level', level: i + 1 }] as [string, Player]),
]);

/** One game; White's score (1, ½ or 0). Decisive evaluations for 8 plies in a row end it early. */
function play(task: Task): number {
  const chess = new Chess();
  for (const u of task.opening.split(' ')) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  const evals: number[] = [];
  while (!chess.isGameOver() && chess.history().length < MAX_PLIES) {
    const p = players.get(chess.turn() === 'w' ? task.white : task.black)!;
    const own = p.kind === 'bot' ? repertoireMove(p.bot.repertoire[chess.turn() === 'w' ? 'white' : 'black'], chess.history()) : null;
    if (own) {
      chess.move(own);
      continue;
    }
    const side = chess.turn();
    const m = chooseMove(chess, p.kind === 'bot' ? p.bot.engine : p.level)!;
    chess.move(m);
    evals.push(side === 'w' ? m.best : -m.best);
    const recent = evals.slice(-8);
    if (recent.length === 8 && recent.every(e => e >= 900)) return 1;
    if (recent.length === 8 && recent.every(e => e <= -900)) return 0;
  }
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 0 : 1;
  return 0.5;
}

if (!isMainThread) {
  parentPort!.on('message', (task: Task) => parentPort!.postMessage({ id: task.id, score: play(task) }));
} else {
  const args = process.argv.slice(2);
  const opt = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
  };
  const games = Math.max(2, opt('games', 8));
  const workers = Math.max(1, Math.min(opt('workers', cpus().length - 2), 64));

  // the engine level a bot's settings are closest to
  const nearestLevel = (b: Bot) => {
    let best = MIN_LEVEL;
    let bestDiff = Infinity;
    LEVELS.forEach((l, i) => {
      const diff = 2 * Math.abs(Math.min(l.depth, 8) - Math.min(b.engine.depth, 8)) + Math.abs(l.noise - b.engine.noise) / 50;
      if (diff < bestDiff) [best, bestDiff] = [i + 1, diff];
    });
    return best;
  };

  const pairs: [string, string][] = [];
  BOTS.forEach((b, i) => {
    for (const j of [i + 1, i + 2]) if (BOTS[j]) pairs.push([b.name, BOTS[j]!.name]);
    const near = nearestLevel(b);
    for (let l = Math.max(MIN_LEVEL, near - 1); l <= Math.min(MAX_LEVEL, near + 1); l++) pairs.push([b.name, `level ${l}`]);
  });
  for (let l = MIN_LEVEL; l < MAX_LEVEL; l++) pairs.push([`level ${l}`, `level ${l + 1}`]);

  const tasks: (Task & { pair: number })[] = [];
  pairs.forEach(([a, b], pair) => {
    for (let g = 0; g < games; g++) {
      const opening = OPENINGS[Math.floor(g / 2) % OPENINGS.length]!;
      tasks.push({ id: tasks.length, pair, white: g % 2 ? b : a, black: g % 2 ? a : b, opening });
    }
  });

  console.log(`${pairs.length} pairings, ${tasks.length} games on ${workers} workers…`);
  const scores = new Map<number, number>(); // task id → White's score
  const started = Date.now();
  await new Promise<void>(resolve => {
    let next = 0;
    const pool = Array.from({ length: Math.min(workers, tasks.length) }, () => new Worker(new URL(import.meta.url)));
    const feed = (w: Worker) => {
      if (next < tasks.length) w.postMessage(tasks[next++]);
      else void w.terminate();
    };
    for (const w of pool) {
      w.on('message', ({ id, score }: { id: number; score: number }) => {
        scores.set(id, score);
        process.stdout.write(`\r${scores.size}/${tasks.length} games, ${Math.round((Date.now() - started) / 1000)} s`);
        if (scores.size === tasks.length) resolve();
        feed(w);
      });
      w.on('error', err => {
        console.error(err);
        process.exit(1);
      });
      feed(w);
    }
  });
  console.log('\n');

  // results per pairing, from the first player's side
  const results = pairs.map(([a, b], pair) => {
    const mine = tasks.filter(t => t.pair === pair);
    const points = mine.reduce((s, t) => s + (t.white === a ? scores.get(t.id)! : 1 - scores.get(t.id)!), 0);
    return { a, b, points, games: mine.length };
  });
  for (const r of results) console.log(`${r.a.padEnd(10)} vs ${r.b.padEnd(10)} ${r.points}/${r.games}`);

  // maximum-likelihood ratings, with one virtual draw per pairing so a clean sweep stays finite
  const rating = new Map([...players.keys()].map(k => [k, k === ANCHOR ? ANCHOR_RATING : 1000]));
  const expected = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400));
  for (let iter = 0; iter < 20_000; iter++) {
    const grad = new Map<string, number>();
    const count = new Map<string, number>();
    for (const r of results) {
      const e = expected(rating.get(r.a)!, rating.get(r.b)!);
      const n = r.games + 1;
      const diff = r.points + 0.5 - n * e;
      grad.set(r.a, (grad.get(r.a) ?? 0) + diff);
      grad.set(r.b, (grad.get(r.b) ?? 0) - diff);
      count.set(r.a, (count.get(r.a) ?? 0) + n);
      count.set(r.b, (count.get(r.b) ?? 0) + n);
    }
    for (const [k, g] of grad) if (k !== ANCHOR) rating.set(k, rating.get(k)! + (200 * g) / count.get(k)!);
  }

  console.log('\nFitted ratings (level 1 = 400):');
  for (const [name, p] of players) {
    const r = Math.round(rating.get(name)!);
    console.log(`${name.padEnd(10)} ${String(r).padStart(5)}${p.kind === 'bot' ? `   → card ≈${Math.round(r / 50) * 50}` : ''}`);
  }
}

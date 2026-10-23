// Plays this app's engine against another version of itself (taken from git)
// and reports the score, so engine changes are measured, not guessed.
// Each opening is played twice, once with each colour.
//
// Usage:
//   npm run engine:match -- [--baseline <git ref>] [--ms 150] [--openings 12]
//   npm run engine:match -- --ladder [--games 4]   (each play level against the next)
//
// `--baseline` defaults to HEAD, so run it before committing an engine change.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Chess } from 'chess.js';
import * as current from '../src/engine/search.ts';

type Engine = Pick<typeof current, 'analyse' | 'chooseMove'>;
type Uci = { from: string; to: string; promotion?: string };

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

// short, common starts so the games don't all repeat one line
const OPENINGS = [
  'e2e4 e7e5',
  'e2e4 c7c5',
  'e2e4 e7e6',
  'e2e4 c7c6',
  'd2d4 d7d5',
  'd2d4 g8f6',
  'c2c4 e7e5',
  'g1f3 d7d5',
  'e2e4 d7d5',
  'd2d4 f7f5',
  'b2b3 e7e5',
  'e2e4 g7g6',
];

const MAX_PLIES = 200;

/** Loads `src/engine` from a git ref into a temporary folder. */
async function loadBaseline(ref: string): Promise<Engine> {
  const dir = mkdtempSync(join(tmpdir(), 'engine-baseline-'));
  for (const file of ['board.ts', 'search.ts']) {
    const text = execFileSync('git', ['show', `${ref}:src/engine/${file}`], { encoding: 'utf8' });
    // older versions import without the extension, which Node needs
    writeFileSync(join(dir, file), text.replace(/from '\.\/board'/g, "from './board.ts'"));
  }
  return (await import(pathToFileURL(join(dir, 'search.ts')).href)) as Engine;
}

type Mover = (startFen: string, moves: Uci[], chess: Chess) => { move: Uci; whiteCp: number | null };

const byTime =
  (engine: Engine, ms: number): Mover =>
  (startFen, moves) => {
    const info = engine.analyse(startFen, moves as never, { maxMs: ms, multiPv: 1 });
    const line = info!.lines[0]!;
    const whiteCp = line.mate !== null ? (line.mate > 0 ? 10_000 : -10_000) : line.cp;
    return { move: line.pv[0]!, whiteCp };
  };

const byLevel =
  (engine: Engine, level: number): Mover =>
  (_startFen, _moves, chess) => {
    const m = engine.chooseMove(chess, level)!;
    return { move: m, whiteCp: null };
  };

/** Plays one game; returns White's score (1, ½ or 0). */
function play(opening: string, white: Mover, black: Mover): number {
  const chess = new Chess();
  const start = chess.fen();
  const moves: Uci[] = [];
  for (const u of opening.split(' ')) {
    const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    moves.push({ from: m.from, to: m.to });
  }
  const evals: number[] = [];
  while (!chess.isGameOver() && moves.length < MAX_PLIES) {
    const side = chess.turn() === 'w' ? white : black;
    const { move, whiteCp } = side(start, moves, chess);
    const m = chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    moves.push({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
    // both engines agreeing on a decisive score for 8 plies ends the game early
    if (whiteCp !== null) evals.push(whiteCp);
    const recent = evals.slice(-8);
    if (recent.length === 8 && recent.every(e => e >= 900)) return 1;
    if (recent.length === 8 && recent.every(e => e <= -900)) return 0;
  }
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 0 : 1;
  return 0.5;
}

const elo = (score: number) => (score <= 0 ? -Infinity : score >= 1 ? Infinity : Math.round(-400 * Math.log10(1 / score - 1)));

function match(label: string, a: Mover, b: Mover, openings: string[]) {
  let points = 0;
  const tally = { win: 0, draw: 0, loss: 0 };
  const count = (s: number) => {
    points += s;
    tally[s === 1 ? 'win' : s === 0 ? 'loss' : 'draw']++;
  };
  for (const [i, o] of openings.entries()) {
    count(play(o, a, b));
    count(1 - play(o, b, a));
    process.stdout.write(`\r${label}: ${2 * (i + 1)}/${2 * openings.length} games, ${points} points`);
  }
  const n = 2 * openings.length;
  console.log(`\n${label}: +${tally.win} =${tally.draw} −${tally.loss}, score ${((100 * points) / n).toFixed(1)}%, about ${elo(points / n)} Elo`);
}

if (args.includes('--ladder')) {
  const games = Number(opt('games', '4'));
  const openings = OPENINGS.slice(0, Math.max(1, Math.ceil(games / 2)));
  for (let level = 1; level < current.MAX_LEVEL; level++)
    match(`level ${level + 1} vs level ${level}`, byLevel(current, level + 1), byLevel(current, level), openings);
} else {
  const ref = opt('baseline', 'HEAD');
  const ms = Number(opt('ms', '150'));
  const openings = OPENINGS.slice(0, Number(opt('openings', String(OPENINGS.length))));
  const baseline = await loadBaseline(ref);
  match(`working copy vs ${ref} at ${ms} ms a move`, byTime(current, ms), byTime(baseline, ms), openings);
}

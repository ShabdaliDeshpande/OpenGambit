// Converts a puzzle CSV you downloaded yourself into public/puzzles/imported.json,
// which the Puzzles screen loads automatically.
//
//   npm run puzzles:import -- <file.csv | file.csv.zst> [--limit 5000] [--min 600] [--max 2800] [--themes fork,pin]
//
// Expected columns: id,fen,moves,rating,…,themes,…  (moves = space-separated UCI,
// the first one being the opponent's setup move). Runs on Node 24 directly
// (built-in TypeScript type stripping); no extra dependencies.
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import * as zlib from 'node:zlib';
import { parseCsvRow } from '../src/puzzles/csv.ts';
import type { Puzzle } from '../src/puzzles/types.ts';

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: npm run puzzles:import -- <file.csv|file.csv.zst> [--limit N] [--min R] [--max R] [--themes a,b] [--out path]');
  process.exit(1);
}

// "--name value" options; the first other argument is the input file
const args = process.argv.slice(2);
const options = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith('--')) options.set(a.slice(2), args[++i] ?? '');
  else positional.push(a);
}
const file = positional[0];
const opt = (name: string) => options.get(name);
if (!file) usage('no input file given');
try {
  statSync(file);
} catch {
  usage(`cannot read ${file}`);
}

const limit = Number(opt('limit') ?? 5000);
const minRating = Number(opt('min') ?? 0);
const maxRating = Number(opt('max') ?? Infinity);
const themes = (opt('themes') ?? '').split(',').filter(Boolean);
const out = resolve(opt('out') ?? 'public/puzzles/imported.json');
if (!Number.isInteger(limit) || limit < 1) usage('--limit must be a positive whole number');

let input: NodeJS.ReadableStream = createReadStream(file);
if (file.endsWith('.zst')) {
  const createZstd = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
  if (!createZstd) usage('this Node version cannot read .zst files; decompress the file first');
  input = input.pipe(createZstd());
}

// reservoir sampling keeps a uniform random sample without holding the whole file
const sample: Puzzle[] = [];
let seen = 0;
let rows = 0;
let skipped = 0;
const rl = createInterface({ input, crlfDelay: Infinity });
for await (const line of rl) {
  rows++;
  const p = parseCsvRow(line);
  if (!p) {
    if (rows > 1) skipped++;
    continue;
  }
  if (p.rating < minRating || p.rating > maxRating) continue;
  if (themes.length && !themes.some(t => p.themes.includes(t))) continue;
  seen++;
  if (sample.length < limit) sample.push(p);
  else {
    const j = Math.floor(Math.random() * seen);
    if (j < limit) sample[j] = p;
  }
  if (rows % 500_000 === 0) process.stdout.write(`  read ${rows.toLocaleString()} rows…\r`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(sample));
console.log(`Read ${rows.toLocaleString()} rows (${skipped.toLocaleString()} malformed), ${seen.toLocaleString()} matched the filters.`);
console.log(`Wrote ${sample.length.toLocaleString()} puzzles to ${out}`);

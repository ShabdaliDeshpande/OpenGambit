// Adds master games from a PGN file you downloaded yourself to the opening
// explorer's "Masters" tab, the review's book moves and the computer's
// opening book.
//
//   npm run explorer:import -- <games.pgn | games.pgn.zst> [more files…] [--min-rating 2200] [--plies 30]
//
// Writes to the same database as the server: SQLite (data/chess.db, or
// SQLITE_PATH), or PostgreSQL when DATABASE_URL is set. Running it again adds
// the games again, so import each file once. Stop the server first when
// using SQLite.
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as zlib from 'node:zlib';
import { openDatabase } from '../server/db/db.ts';
import { importGames } from '../server/explorer/importer.ts';
import { EXPLORER_PLIES } from '../server/explorer/explorerStore.ts';
import { readPgnGames } from '../server/explorer/pgnGames.ts';

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: npm run explorer:import -- <games.pgn|games.pgn.zst> [more files] [--min-rating R] [--plies N]');
  process.exit(1);
}

const args = process.argv.slice(2);
const options = new Map<string, string>();
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith('--')) options.set(a.slice(2), args[++i] ?? '');
  else files.push(a);
}
if (files.length === 0) usage('no input file given');
for (const f of files) {
  try {
    statSync(f);
  } catch {
    usage(`cannot read ${f}`);
  }
}
const minRating = Number(options.get('min-rating') ?? 0);
const plies = Number(options.get('plies') ?? EXPLORER_PLIES);
if (!Number.isFinite(minRating) || !Number.isInteger(plies) || plies < 1 || plies > 60) usage('--plies must be 1 to 60 and --min-rating a number');

function linesOf(file: string) {
  let input: NodeJS.ReadableStream = createReadStream(file);
  if (file.endsWith('.zst')) {
    const createZstd = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
    if (!createZstd) usage('this Node version cannot read .zst files; decompress the file first');
    input = input.pipe(createZstd());
  }
  return createInterface({ input, crlfDelay: Infinity });
}

const db = await openDatabase(process.env);
const started = Date.now();
try {
  for (const file of files) {
    console.log(`Importing ${file}${minRating ? ` (both players rated ${minRating}+)` : ''}, first ${plies} moves of each game…`);
    const stats = await importGames(db, readPgnGames(linesOf(file), plies), {
      minRating,
      plies,
      onProgress: s => process.stdout.write(`\r  ${s.games} games added, ${s.skipped} skipped`),
    });
    console.log(`\r  ${stats.games} games added, ${stats.skipped} skipped`);
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s. Restart the server to see them in the explorer.`);
} finally {
  await db.close();
}

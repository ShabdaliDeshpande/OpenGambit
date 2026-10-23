// Adds opening names (ECO code and name) from TSV files you downloaded
// yourself, for example a public-domain opening-name list. Each file needs a
// header row with eco, name and pgn columns, e.g.
//
//   eco	name	pgn
//   C50	Italian Game	1. e4 e5 2. Nf3 Nc6 3. Bc4
//
//   npm run openings:import -- a.tsv [b.tsv …]
//
// Writes to the server's database (SQLite or DATABASE_URL). When two names
// reach the same position, the first one read is kept.
import { readFileSync } from 'node:fs';
import { openDatabase } from '../server/db/db.ts';
import { importOpenings, parseOpeningsTsv } from '../server/explorer/importer.ts';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length === 0) {
  console.error('Usage: npm run openings:import -- <openings.tsv> [more files]');
  process.exit(1);
}

const db = await openDatabase(process.env);
try {
  for (const file of files) {
    const rows = parseOpeningsTsv(readFileSync(file, 'utf8'));
    const { added, skipped } = await importOpenings(db, rows);
    console.log(`${file}: ${added} names added, ${skipped} skipped (already named, or moves that don't read)`);
  }
} finally {
  await db.close();
}

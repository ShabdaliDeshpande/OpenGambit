// Rebuilds the explorer's "OpenGambit" and "My games" data from every game
// already saved in the database. New games are added as they finish, so this
// is only needed once, for games played before the explorer existed.
//
//   npm run explorer:index-site
import { openDatabase } from '../server/db/db.ts';
import { Explorer } from '../server/explorer/explorerStore.ts';

const db = await openDatabase(process.env);
try {
  const games = await new Explorer(db).reindexSite(n => process.stdout.write(`\r${n} games indexed`));
  console.log(`\r${games} games indexed.`);
} finally {
  await db.close();
}

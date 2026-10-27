// Learning progress: stars per lesson level, the best time per drill,
// which endgames you've completed and your best result against each bot.
// Kept in the browser, and on the account when you're signed in; the two
// are merged, keeping the better result. No imports, so the server uses the
// same rules.

export type Progress = Record<string, number>;

export const lessonKey = (id: string) => `lesson:${id}`;
export const drillKey = (id: string) => `drill:${id}`;
export const endgameKey = (id: string) => `endgame:${id}`;
/** Best Challenge-mode result against a bot: 1 a draw, 2 a win. */
export const botKey = (id: string) => `bot:${id}`;

const ITEM = /^(lesson|drill|endgame|bot):[a-z0-9-]{1,40}$/;

/** Whether a progress entry has a known kind and a sensible value. */
export function validItem(key: string, value: unknown): value is number {
  if (!ITEM.test(key) || typeof value !== 'number' || !Number.isInteger(value)) return false;
  if (key.startsWith('lesson:')) return value >= 1 && value <= 3;
  if (key.startsWith('endgame:')) return value === 1;
  if (key.startsWith('bot:')) return value === 1 || value === 2;
  return value > 0 && value < 24 * 3_600_000; // a drill time in ms
}

/** The better of two results for one entry: more stars, a faster drill or a better bot result. */
export const better = (key: string, a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : key.startsWith('drill:') ? Math.min(a, b) : Math.max(a, b);

/** Both progress records combined, entry by entry. Invalid entries are dropped. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const out: Progress = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = better(key, validItem(key, a[key]) ? a[key] : undefined, validItem(key, b[key]) ? b[key] : undefined);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Stars won in a stage's levels, out of three per level. */
export const stageStars = (progress: Progress, levelIds: readonly string[]) => levelIds.reduce((s, id) => s + (progress[lessonKey(id)] ?? 0), 0);

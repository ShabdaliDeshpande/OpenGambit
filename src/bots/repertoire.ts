// A bot's own opening lines: while the game so far is the start of one of
// them, the bot plays that line's next move.

/** SAN without check, mate and annotation marks, so "Bb5+" matches "Bb5". */
export const bareSan = (san: string) => san.replace(/[+#!?]/g, '');

/**
 * The bot's next move (SAN) from `lines`, or null when the game has left them.
 * When several lines match, one is picked at random.
 */
export function repertoireMove(lines: readonly string[], played: readonly string[], rng: () => number = Math.random): string | null {
  const sofar = played.map(bareSan);
  const matching = lines
    .map(line => line.trim().split(/\s+/).map(bareSan))
    .filter(line => line.length > sofar.length && sofar.every((m, i) => line[i] === m));
  if (!matching.length) return null;
  return matching[Math.floor(rng() * matching.length)]![sofar.length]!;
}

// Daily (correspondence) chess rules shared by the browser and the server:
// days per move and deadlines, the reminder, vacation days and conditional
// moves. Pure; only chess.js, so the server can load it.

import { Chess } from 'chess.js';

export const DAY_MS = 86_400_000;

export const DAYS_PER_MOVE = [1, 2, 3, 5, 7, 14] as const;
export type DaysPerMove = (typeof DAYS_PER_MOVE)[number];

export const isDaysPerMove = (d: unknown): d is DaysPerMove => DAYS_PER_MOVE.includes(d as DaysPerMove);

/** The time control as stored with a finished game, e.g. "3d". */
export const dailyTc = (days: number) => `${days}d`;

export const daysLabel = (days: number) => (days === 1 ? '1 day per move' : `${days} days per move`);

/**
 * When a player must have moved by, counting from `from` (the opponent's
 * move). Time on vacation doesn't count, so the clock starts after it.
 */
export const moveDeadline = (from: number, days: number, vacationUntil: number | null) => Math.max(from, vacationUntil ?? 0) + days * DAY_MS;

/** A reminder goes out once this share of the time for a move has passed. */
export const REMIND_SHARE = 0.8;

export const reminderAt = (turnStarted: number, deadline: number) => turnStarted + Math.round((deadline - turnStarted) * REMIND_SHARE);

/** Time left as words: "2 days", "5 hours", "12 minutes". */
export function timeLeftText(ms: number): string {
  if (ms <= 0) return 'no time';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(ms / DAY_MS);
  return `${days} days`;
}

// ----------------------------------------------------------------- vacation

/** Vacation days a player may take each calendar year (UTC). */
export const VACATION_DAYS = 14;

export interface Vacation {
  /** The year `used` counts for. */
  year: number;
  used: number;
  /** While on vacation: when it ends. */
  until: number | null;
}

export const yearOf = (t: number) => new Date(t).getUTCFullYear();

export const onVacation = (v: Vacation, now: number) => v.until !== null && v.until > now;

/** Days still free this year. */
export const vacationLeft = (v: Vacation, now: number) => VACATION_DAYS - (v.year === yearOf(now) ? v.used : 0);

/**
 * Starts a vacation of whole days. `shift` is how far deadlines move forward
 * in the games where it's your move. A string explains why it can't start.
 */
export function startVacation(v: Vacation, now: number, days: number): { vacation: Vacation; shift: number } | string {
  if (onVacation(v, now)) return 'You’re already on vacation.';
  if (!Number.isInteger(days) || days < 1) return 'Take at least one whole day.';
  const left = vacationLeft(v, now);
  if (days > left) return left === 0 ? 'You’ve used all your vacation days this year.' : `You have ${left} vacation day${left === 1 ? '' : 's'} left this year.`;
  const used = (v.year === yearOf(now) ? v.used : 0) + days;
  return { vacation: { year: yearOf(now), used, until: now + days * DAY_MS }, shift: days * DAY_MS };
}

/**
 * Ends a vacation early. Whole days not yet started are given back, and the
 * deadlines in games where it's your move move back by `shift` (negative).
 */
export function endVacation(v: Vacation, now: number): { vacation: Vacation; shift: number } | string {
  if (!onVacation(v, now)) return 'You’re not on vacation.';
  const refund = Math.floor((v.until! - now) / DAY_MS);
  return { vacation: { year: v.year, used: Math.max(0, v.used - refund), until: now }, shift: -refund * DAY_MS };
}

// --------------------------------------------------------- conditional moves

/** At most this many lines, each at most this many moves (as lila allows). */
export const MAX_LINES = 30;
export const MAX_LINE_MOVES = 30;

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Checks conditional lines prepared while waiting for the opponent: each line
 * alternates the opponent's move and your reply, starting from `fen` (the
 * opponent to move). Returns the cleaned lines (a last move without a reply
 * is dropped, as are repeats) or a reason they can't be saved.
 */
export function checkConditional(fen: string, raw: unknown): string[][] | string {
  if (!Array.isArray(raw)) return 'Send a list of lines.';
  if (raw.length > MAX_LINES) return `At most ${MAX_LINES} lines.`;
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const [i, line] of raw.entries()) {
    if (!Array.isArray(line) || line.length > MAX_LINE_MOVES || !line.every(m => typeof m === 'string' && UCI.test(m))) return `Line ${i + 1} isn’t a list of moves.`;
    const moves = (line as string[]).slice(0, line.length - (line.length % 2));
    if (moves.length === 0) continue;
    const chess = new Chess(fen);
    for (const m of moves) {
      try {
        chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
      } catch {
        return `Line ${i + 1} has an illegal move (${m}). Lines must start from the current position.`;
      }
    }
    const key = moves.join(' ');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(moves);
    }
  }
  return out;
}

/**
 * The opponent played `move`. Returns your prepared reply, if a line expected
 * it, and the lines that still apply afterwards (moved on by two moves).
 * Lines that didn't expect this move are dropped.
 */
export function advanceConditional(lines: readonly string[][], move: string): { reply: string | null; lines: string[][] } {
  const matching = lines.filter(l => l[0] === move && l.length >= 2);
  const reply = matching[0]?.[1] ?? null;
  if (!reply) return { reply: null, lines: [] };
  return { reply, lines: matching.filter(l => l[1] === reply && l.length > 2).map(l => l.slice(2)) };
}

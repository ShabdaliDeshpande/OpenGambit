import type { Color } from 'chess.js';

export interface TimeControl {
  id: string;
  label: string;
  initialMs: number;
  incrementMs: number;
}

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: '1+0', label: '1+0 Bullet', initialMs: 60_000, incrementMs: 0 },
  { id: '3+2', label: '3+2 Blitz', initialMs: 180_000, incrementMs: 2_000 },
  { id: '5+0', label: '5+0 Blitz', initialMs: 300_000, incrementMs: 0 },
  { id: '10+0', label: '10+0 Rapid', initialMs: 600_000, incrementMs: 0 },
  { id: '15+10', label: '15+10 Rapid', initialMs: 900_000, incrementMs: 10_000 },
];

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** Speed category from the estimated game length (initial time + 40 increments). */
export function speedOf(tc: TimeControl): Speed {
  const seconds = (tc.initialMs + 40 * tc.incrementMs) / 1000;
  return seconds < 180 ? 'bullet' : seconds < 480 ? 'blitz' : seconds < 1500 ? 'rapid' : 'classical';
}

export function findTimeControl(id: string | null): TimeControl | null {
  return TIME_CONTROLS.find(tc => tc.id === id) ?? null;
}

/**
 * Remaining time is stored as of `since` for the running side, so the clock
 * never accumulates drift from timer jitter: the current value is always
 * derived from a monotonic timestamp passed in by the caller.
 */
export interface ClockState {
  incrementMs: number;
  remaining: Record<Color, number>;
  active: Color | null;
  since: number;
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function createClock(tc: TimeControl): ClockState {
  return {
    incrementMs: tc.incrementMs,
    remaining: { w: tc.initialMs, b: tc.initialMs },
    active: null,
    since: 0,
  };
}

export function remainingMs(clock: ClockState, color: Color, now: number): number {
  const base = clock.remaining[color];
  const elapsed = clock.active === color ? Math.max(0, now - clock.since) : 0;
  return Math.max(0, base - elapsed);
}

/** The side whose flag has fallen at `now`, if any. */
export function flaggedColor(clock: ClockState, now: number): Color | null {
  if (clock.active && remainingMs(clock, clock.active, now) <= 0) return clock.active;
  return null;
}

/**
 * Called after `mover` completes a move. The very first move of the game only
 * starts the opponent's clock (no time is charged and no increment is added).
 * Afterwards the mover is charged the elapsed time and receives the increment.
 */
export function pressClock(clock: ClockState, mover: Color, now: number): ClockState {
  const next = opposite(mover);
  if (clock.active === null) return { ...clock, active: next, since: now };
  const left = clock.remaining[mover] - (now - clock.since);
  return {
    ...clock,
    remaining: { ...clock.remaining, [mover]: left + clock.incrementMs },
    active: next,
    since: now,
  };
}

/** Freeze both clocks, settling the running side's time. */
export function stopClock(clock: ClockState, now: number): ClockState {
  if (!clock.active) return clock;
  const color = clock.active;
  return {
    ...clock,
    remaining: { ...clock.remaining, [color]: remainingMs(clock, color, now) },
    active: null,
    since: now,
  };
}

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    const tenths = Math.floor(clamped / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const totalSec = Math.ceil(clamped / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Analysis board engine settings: how long to search, how many lines and
// workers, threat mode and which arrows to draw. Kept in the browser; this
// module only checks and converts them.

export type SearchBy = 'time' | 'depth';

export interface EngineSettings {
  on: boolean;
  /** Engine lines shown, 1–5. */
  lines: number;
  by: SearchBy;
  /** Seconds per position when searching by time (one of TIME_STEPS). */
  seconds: number;
  /** Plies when searching by depth, 1–30. */
  depth: number;
  /** Keep searching until the position changes. */
  infinite: boolean;
  /** Engine workers sharing the search, 1 to the number the device has. */
  threads: number;
  /** Also show what the opponent threatens (the best move if it were their turn). */
  threat: boolean;
  arrows: { best: boolean; threat: boolean; drawn: boolean };
}

/** Time steps offered, in seconds (lila offers a similar ladder). */
export const TIME_STEPS: readonly number[] = [1, 2, 4, 6, 8, 10, 15, 20, 30];
export const MAX_DEPTH = 30;
export const MAX_LINES = 5;

export const DEFAULT_SETTINGS: EngineSettings = {
  on: true,
  lines: 3,
  by: 'time',
  seconds: 15,
  depth: 20,
  infinite: false,
  threads: 1,
  threat: false,
  arrows: { best: true, threat: true, drawn: true },
};

/** Workers the device can spare for analysis (one core stays for the page). */
export function availableThreads(cores: number | undefined = typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency): number {
  return Math.max(1, Math.min(8, (cores ?? 2) - 1));
}

const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Settings read back from storage: anything missing or out of range takes its default. */
export function checkSettings(raw: unknown, maxThreads: number): EngineSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arrows = r.arrows && typeof r.arrows === 'object' ? (r.arrows as Record<string, unknown>) : {};
  const seconds = TIME_STEPS.includes(r.seconds as number) ? (r.seconds as number) : DEFAULT_SETTINGS.seconds;
  return {
    on: bool(r.on, DEFAULT_SETTINGS.on),
    lines: int(r.lines, 1, MAX_LINES, DEFAULT_SETTINGS.lines),
    by: r.by === 'depth' ? 'depth' : 'time',
    seconds,
    depth: int(r.depth, 1, MAX_DEPTH, DEFAULT_SETTINGS.depth),
    infinite: bool(r.infinite, DEFAULT_SETTINGS.infinite),
    threads: int(r.threads, 1, maxThreads, Math.min(DEFAULT_SETTINGS.threads, maxThreads)),
    threat: bool(r.threat, DEFAULT_SETTINGS.threat),
    arrows: {
      best: bool(arrows.best, DEFAULT_SETTINGS.arrows.best),
      threat: bool(arrows.threat, DEFAULT_SETTINGS.arrows.threat),
      drawn: bool(arrows.drawn, DEFAULT_SETTINGS.arrows.drawn),
    },
  };
}

/** A day: "infinite" in practice, since a new position restarts the search anyway. */
const FOREVER_MS = 86_400_000;

/** The engine limits for these settings. */
export function searchLimits(s: EngineSettings): { maxMs: number; maxDepth: number } {
  if (s.infinite) return { maxMs: FOREVER_MS, maxDepth: 60 };
  if (s.by === 'depth') return { maxMs: FOREVER_MS, maxDepth: s.depth };
  return { maxMs: s.seconds * 1000, maxDepth: 60 };
}

/** "15 s", "depth 20", "∞". */
export function limitText(s: EngineSettings): string {
  if (s.infinite) return '∞';
  return s.by === 'depth' ? `depth ${s.depth}` : `${s.seconds} s`;
}

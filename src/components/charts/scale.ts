// Small helpers for the SVG charts: clean axis ticks, linear scales and
// lookups for the hover readout.

/** About `count` round tick values (1, 2 or 5 × a power of ten apart) covering min..max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    [min, max] = [min - pad, max + pad];
  }
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * power).find(s => s >= raw) ?? 10 * power;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Maps a domain onto a pixel range. */
export const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** The index of the value in a sorted list closest to `x`. */
export function nearestIndex(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo]! - x) <= Math.abs(sorted[hi]! - x) ? lo : hi;
}

/** A series' latest point at or before `t` (its value then), or null before its first point. */
export function pointAtOrBefore<P extends { t: number }>(points: readonly P[], t: number): P | null {
  let found: P | null = null;
  for (const p of points) {
    if (p.t > t) break;
    found = p;
  }
  return found;
}

/** "1 Oct 2026". */
export const dayText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** "Oct 2026" for axis ticks. */
export const monthText = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** Axis tick text that suits the span shown: times within two days, days within three months, months beyond. */
export function timeTickText(span: number): (t: number) => string {
  if (span < 2 * 86_400_000) return t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (span < 90 * 86_400_000) return t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return monthText;
}

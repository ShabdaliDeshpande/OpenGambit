import type { MouseEvent } from 'react';
import type { Division } from '../../analysis/divider';
import { KIND_LABEL, type Kind } from '../../analysis/review';

interface Props {
  /** White's winning chances (−1…1) after each ply, index 0 = start; null where not analysed yet. */
  points: readonly (number | null)[];
  /** The class of the move reaching each ply, for the dots. */
  kinds: ReadonlyMap<number, Kind>;
  division: Division;
  /** The ply shown on the board. */
  current: number;
  onSelect: (ply: number) => void;
}

const W = 300;
const H = 90;
const DOT_KINDS: readonly Kind[] = ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'];

/** The evaluation over the game; clicking jumps to that move. */
export function EvalGraph({ points, kinds, division, current, onSelect }: Props) {
  const n = Math.max(1, points.length - 1);
  const x = (ply: number) => (ply / n) * W;
  const y = (wc: number) => H / 2 - (wc * H) / 2;

  // White's area: from the bottom up to the line, wherever the line is known
  const known = points.map((p, i) => [i, p] as const).filter((e): e is readonly [number, number] => e[1] !== null);
  const area = known.length > 1 ? `M ${x(known[0]![0])} ${H} ${known.map(([i, p]) => `L ${x(i)} ${y(p)}`).join(' ')} L ${x(known[known.length - 1]![0])} ${H} Z` : '';
  const line = known.length > 1 ? `M ${known.map(([i, p]) => `${x(i)} ${y(p)}`).join(' L ')}` : '';

  const select = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ply = Math.round(((e.clientX - box.left) / box.width) * n);
    onSelect(Math.max(0, Math.min(points.length - 1, ply)));
  };

  const divisions = [
    ...(division.middle !== null ? [{ ply: division.middle, label: 'Middlegame' }] : []),
    ...(division.end !== null ? [{ ply: division.end, label: 'Endgame' }] : []),
  ];

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Evaluation graph: White's chances over the game. Click a point to go to that move."
      onClick={select}
    >
      <rect className="eval-graph-black" x={0} y={0} width={W} height={H} />
      {area && <path className="eval-graph-white" d={area} />}
      <line className="eval-graph-mid" x1={0} y1={H / 2} x2={W} y2={H / 2} />
      {divisions.map(d => (
        <g key={d.label}>
          <line className="eval-graph-division" x1={x(d.ply)} y1={0} x2={x(d.ply)} y2={H} />
          <text className="eval-graph-label" x={x(d.ply) + 2} y={9}>
            {d.label}
          </text>
        </g>
      ))}
      {line && <path className="eval-graph-line" d={line} />}
      <line className="eval-graph-current" x1={x(current)} y1={0} x2={x(current)} y2={H} />
      {[...kinds].map(([ply, kind]) => {
        const p = points[ply];
        if (!DOT_KINDS.includes(kind) || p === null || p === undefined) return null;
        return (
          <circle key={ply} className={`eval-graph-dot ${kind}`} cx={x(ply)} cy={y(p)} r={2.6}>
            <title>{KIND_LABEL[kind]}</title>
          </circle>
        );
      })}
    </svg>
  );
}

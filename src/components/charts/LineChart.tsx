import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dayText, linear, nearestIndex, niceTicks, pointAtOrBefore, timeTickText } from './scale';
import { useWidth } from './useWidth';

export interface LineSeries {
  id: string;
  label: string;
  /** A CSS colour, normally a chart token such as var(--viz-1). */
  color: string;
  points: { t: number; v: number }[];
}

interface Props {
  series: LineSeries[];
  /** What the chart shows, for screen readers and the table caption. */
  title: string;
  formatValue?: (v: number) => string;
  height?: number;
  /** Name each line in its end label (off when the title already names the only line). */
  nameEnds?: boolean;
}

const MARGIN = { top: 12, bottom: 26, left: 44 };

/** A time-series line chart: legend for two or more series, end labels, a hover/keyboard readout and a table view. */
export function LineChart({ series, title, formatValue = v => String(Math.round(v)), height = 220, nameEnds = true }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const shown = series.filter(s => s.points.length > 0).map(s => ({ ...s, points: [...s.points].sort((a, b) => a.t - b.t) }));
  const times = useMemo(() => [...new Set(shown.flatMap(s => s.points.map(p => p.t)))].sort((a, b) => a - b), [series]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shown.length === 0) return null;
  const values = shown.flatMap(s => s.points.map(p => p.v));
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const [t0, t1] = [times[0]!, times[times.length - 1]!];
  const right = shown.length <= 4 ? 96 : 16;
  const x = linear(t0, t1, MARGIN.left, width - right);
  const y = linear(ticks[0]!, ticks[ticks.length - 1]!, height - MARGIN.bottom, MARGIN.top);
  const tickText = timeTickText(t1 - t0);
  // a tick whose text repeats the one before it says nothing new
  const xTicks = (t1 > t0 ? [t0, t0 + (t1 - t0) / 2, t1] : [t0]).filter((tk, i, all) => i === 0 || tickText(tk) !== tickText(all[i - 1]!));

  // end labels sit next to the last point of each series; if two would collide, the legend and readout carry them
  const ends = shown.map(s => ({ s, last: s.points[s.points.length - 1]! })).sort((a, b) => y(a.last.v) - y(b.last.v));
  const labelsFit = shown.length <= 4 && ends.every((e, i) => i === 0 || y(e.last.v) - y(ends[i - 1]!.last.v) >= 14);

  const hoverT = at === null ? null : times[at]!;
  const readout = hoverT === null ? [] : shown.map(s => ({ s, p: pointAtOrBefore(s.points, hoverT) })).filter(r => r.p);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    setAt(nearestIndex(times.map(x), px));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setAt(i => Math.max(0, (i ?? times.length) - 1));
    else if (e.key === 'ArrowRight') setAt(i => Math.min(times.length - 1, (i ?? -1) + 1));
    else if (e.key === 'Escape') setAt(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="viz" ref={ref}>
      {shown.length >= 2 && (
        <ul className="viz-legend" aria-label="Legend">
          {shown.map(s => (
            <li key={s.id}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="viz-plot">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Use the arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setAt(null)}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
        >
          {ticks.map(v => (
            <g key={v}>
              <line className="viz-grid" x1={MARGIN.left} x2={width - right} y1={y(v)} y2={y(v)} />
              <text className="viz-tick" x={MARGIN.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {formatValue(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} className="viz-tick" x={x(t)} y={height - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {tickText(t)}
            </text>
          ))}
          {shown.map(s => (
            <g key={s.id}>
              {s.points.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={s.points.map(p => `${x(p.t)},${y(p.v)}`).join(' ')}
                />
              )}
              <circle className="viz-dot" cx={x(s.points[s.points.length - 1]!.t)} cy={y(s.points[s.points.length - 1]!.v)} r="4" fill={s.color} />
            </g>
          ))}
          {labelsFit &&
            ends.map(({ s, last }) => (
              <text key={s.id} className="viz-end" x={x(last.t) + 9} y={y(last.v)} dy="0.32em">
                {nameEnds ? `${s.label} ` : ''}
                <tspan className="viz-end-value">{formatValue(last.v)}</tspan>
              </text>
            ))}
          {hoverT !== null && (
            <g>
              <line className="viz-crosshair" x1={x(hoverT)} x2={x(hoverT)} y1={MARGIN.top} y2={height - MARGIN.bottom} />
              {readout.map(({ s, p }) => (
                <circle key={s.id} className="viz-dot" cx={x(p!.t)} cy={y(p!.v)} r="4" fill={s.color} />
              ))}
            </g>
          )}
        </svg>
        {hoverT !== null && readout.length > 0 && (
          <div className="viz-tooltip" style={{ left: Math.min(width - 150, Math.max(0, x(hoverT) + 10)) }} role="status">
            <div className="viz-tooltip-head">{dayText(hoverT)}</div>
            {readout.map(({ s, p }) => (
              <div key={s.id} className="viz-tooltip-row">
                <svg width="12" height="6" aria-hidden="true">
                  <line x1="1" y1="3" x2="11" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <strong>{formatValue(p!.v)}</strong> <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="viz-table">
        <summary>Show the numbers</summary>
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {shown.map(s => (
                <th key={s.id} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.slice(-60).map(t => (
              <tr key={t}>
                <th scope="row">{dayText(t)}</th>
                {shown.map(s => {
                  const p = s.points.find(q => q.t === t);
                  return <td key={s.id}>{p ? formatValue(p.v) : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {times.length > 60 && <p className="muted small">The latest 60 of {times.length}.</p>}
      </details>
    </figure>
  );
}

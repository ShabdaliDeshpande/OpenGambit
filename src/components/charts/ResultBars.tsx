import type { Bucket } from '../../account/api';
import { resultShares } from '../../explorer/format';

const PARTS = [
  { key: 'win', label: 'Wins' },
  { key: 'draw', label: 'Draws' },
  { key: 'loss', label: 'Losses' },
] as const;

const games = (b: Bucket) => b.win + b.draw + b.loss;

/** The win / draw / loss key shown above result bars. */
export function ResultLegend() {
  return (
    <ul className="viz-legend" aria-label="Legend">
      {PARTS.map(p => (
        <li key={p.key}>
          <span className={`viz-swatch ${p.key}`} aria-hidden="true" />
          {p.label}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  rows: Bucket[];
  title: string;
  /** Show rows without games (e.g. every time-of-day slot). */
  keepEmpty?: boolean;
}

/** One stacked bar per row: wins, draws and losses, with the number of games at the end. */
export function ResultBars({ rows, title, keepEmpty = false }: Props) {
  const list = keepEmpty ? rows : rows.filter(r => games(r) > 0);
  if (list.length === 0) return <p className="muted small">No games yet.</p>;
  return (
    <figure className="viz">
      <ResultLegend />
      <ul className="rb-list" aria-label={title}>
        {list.map(r => {
          const n = games(r);
          const share = resultShares({ white: r.win, draws: r.draw, black: r.loss });
          const pct = { win: share.white, draw: share.draws, loss: share.black };
          const readout = `${r.label}: ${r.win} won, ${r.draw} drawn, ${r.loss} lost (${n} game${n === 1 ? '' : 's'})`;
          return (
            <li key={r.label} className="rb-row" tabIndex={0} aria-label={readout}>
              <span className="rb-label" title={r.label}>
                {r.label}
              </span>
              <span className="rb-bar">
                {n === 0 ? (
                  <span className="rb-none">no games</span>
                ) : (
                  PARTS.filter(p => r[p.key] > 0).map(p => (
                    <span key={p.key} className={`rb-seg ${p.key}`} style={{ flexGrow: r[p.key] }}>
                      {pct[p.key] >= 18 ? `${pct[p.key]}%` : ''}
                    </span>
                  ))
                )}
              </span>
              <span className="rb-count">{n}</span>
              <span className="rb-tip" role="tooltip">
                <strong>{r.win}</strong> won · <strong>{r.draw}</strong> drawn · <strong>{r.loss}</strong> lost
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

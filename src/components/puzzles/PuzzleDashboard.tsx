import { useEffect, useState } from 'react';
import { diffText, fetchPuzzleDashboard, ratingText, type PuzzleDashboardData, type ThemeStat } from '../../account/api';
import { themeLabel } from '../../puzzles/picker';

/** Puzzle rating over time, as a small line chart. */
function RatingChart({ points }: { points: { at: number; rating: number }[] }) {
  if (points.length < 2) return <p className="muted small">Your rating chart appears after a couple of rated puzzles.</p>;
  const w = 600;
  const h = 160;
  const ratings = points.map(p => p.rating);
  const lo = Math.min(...ratings) - 20;
  const hi = Math.max(...ratings) + 20;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (r: number) => h - ((r - lo) / (hi - lo)) * h;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  return (
    <svg className="rating-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Puzzle rating over ${points.length} puzzles, now ${last.rating}`}>
      <path d={`${line} L${w},${h} L0,${h} Z`} className="area" />
      <path d={line} className="line" />
      <text x="4" y="14" className="label">
        {Math.round(hi - 20)}
      </text>
      <text x="4" y={h - 4} className="label">
        {Math.round(lo + 20)}
      </text>
    </svg>
  );
}

function ThemeTable({ rows, empty }: { rows: ThemeStat[]; empty: string }) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <table className="theme-table">
      <tbody>
        {rows.map(t => (
          <tr key={t.theme}>
            <td>{themeLabel(t.theme)}</td>
            <td className="muted small">
              {t.firstWins}/{t.played} first try
            </td>
            <td className="num">{t.performance}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  /** Bumps whenever a new attempt was recorded, to refresh. */
  version: number;
  onReplay: (puzzleId: string) => void;
}

export function PuzzleDashboard({ version, onReplay }: Props) {
  const [data, setData] = useState<PuzzleDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPuzzleDashboard()
      .then(d => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading your dashboard…</p>;

  return (
    <div className="puzzle-dashboard">
      <div className="dash-tiles">
        <div className="stat">
          <span className="stat-value">{ratingText(data.rating)}</span>
          <span className="stat-label">puzzle rating ±{data.rating.deviation}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.played}</span>
          <span className="stat-label">rated puzzles</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.successRate}%</span>
          <span className="stat-label">solved first try</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.performance ?? '–'}</span>
          <span className="stat-label">performance</span>
        </div>
      </div>

      <RatingChart points={data.chart} />

      <div className="dash-columns">
        <section>
          <h3>💪 Strengths</h3>
          <ThemeTable rows={data.strengths} empty="Solve 3 puzzles of a theme on the first try, above your average, to see it here." />
        </section>
        <section>
          <h3>🎯 Improvement areas</h3>
          <ThemeTable rows={data.improvements} empty="Themes you miss 3 times or more, below your average, show up here to train." />
        </section>
      </div>

      <h3>Recent puzzles</h3>
      {data.history.length === 0 ? (
        <p className="muted small">No puzzles yet. Solve one to start your history.</p>
      ) : (
        <ul className="puzzle-history">
          {data.history.map((h, i) => (
            <li key={`${h.puzzleId}-${h.at}-${i}`}>
              <span className={`result-badge ${h.win ? 'win' : 'loss'}`}>{h.win ? 'Solved' : 'Missed'}</span>
              <span>
                {h.puzzleId} <span className="muted small">· {h.puzzleRating}</span>
              </span>
              <span className="muted small">{h.themes.map(themeLabel).join(', ')}</span>
              <span className={`diff ${h.ratingDiff === null ? '' : h.ratingDiff >= 0 ? 'up' : 'down'}`}>
                {h.first ? diffText(h.ratingDiff) : 'practice'}
              </span>
              <button type="button" onClick={() => onReplay(h.puzzleId)}>
                ↻ Replay
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Only your first try at each puzzle is rated. A wrong move, a hint or showing the solution counts as a miss. Performance per theme is the average
        puzzle rating − 500 + 1000 × your first-try success rate.
      </p>
    </div>
  );
}

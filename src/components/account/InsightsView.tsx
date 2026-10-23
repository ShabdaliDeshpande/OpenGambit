import { useEffect, useState } from 'react';
import { ApiError, CATEGORIES, CATEGORY_LABEL, fetchInsights, type Category, type Insights } from '../../account/api';
import { LineChart } from '../charts/LineChart';
import { ResultBars } from '../charts/ResultBars';

const PERIODS = [
  { id: 'all', label: 'All time', days: null },
  { id: 'year', label: 'Last 12 months', days: 365 },
  { id: 'quarter', label: 'Last 3 months', days: 91 },
  { id: 'month', label: 'Last 30 days', days: 30 },
] as const;
type Period = (typeof PERIODS)[number]['id'];

/** Chart tokens for the rating lines, in a fixed order per speed. */
const SPEED_COLOR: Record<Category, string> = { bullet: 'var(--viz-1)', blitz: 'var(--viz-2)', rapid: 'var(--viz-3)', classical: 'var(--viz-4)' };

const speedLabel = (s: string) => CATEGORY_LABEL[s as Category] ?? s;

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);
const num = (v: number | null) => (v === null ? '–' : v.toFixed(2).replace(/\.?0+$/, '') || '0');

interface Props {
  username: string;
  /** The signed-in player's name, to tell "your" insights from someone else's. */
  meName: string | null;
  onOpenProfile: (name: string) => void;
}

/** A player's insights: results, ratings, accuracy and time, from their saved games. */
export function InsightsView({ username, meName, onOpenProfile }: Props) {
  const [speed, setSpeed] = useState<Category | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const own = meName?.toLowerCase() === username.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = PERIODS.find(p => p.id === period)!.days;
    fetchInsights(username, { speed, since: days ? Date.now() - days * 86_400_000 : null })
      .then(d => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof ApiError && e.status === 0 ? 'Insights need a connection to the server.' : (e as Error).message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [username, speed, period]);

  const speeds = (Object.keys(data?.rating ?? {}) as Category[]).filter(s => CATEGORIES.includes(s));
  return (
    <main className="insights">
      <section className="panel">
        <h2>
          📈 Insights ·{' '}
          <button type="button" className="link-button" onClick={() => onOpenProfile(username)}>
            {username}
          </button>
        </h2>
        <div className="row insights-filters" role="group" aria-label="Filters">
          <label>
            Period{' '}
            <select value={period} onChange={e => setPeriod(e.target.value as Period)}>
              {PERIODS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Speed{' '}
            <select value={speed ?? ''} onChange={e => setSpeed((e.target.value || null) as Category | null)}>
              <option value="">All speeds</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          {loading && data && <span className="muted small">Updating…</span>}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!data && loading && <p role="status">Loading insights…</p>}
        {data && (
          <p className="muted small">
            From {data.games} game{data.games === 1 ? '' : 's'}
            {data.games >= 2000 ? ' (the latest 2,000)' : ''}. {own ? 'Only you can see these unless you make them public in your account settings.' : ''}
          </p>
        )}
      </section>

      {data && data.games === 0 && (
        <section className="panel">
          <p className="muted">No games here yet. Insights come from finished online games while signed in.</p>
        </section>
      )}

      {data && data.games > 0 && (
        <div className="insights-grid">
          <section className="panel">
            <h3>Rating history</h3>
            {speeds.length ? (
              <LineChart
                title="Rating after each rated game"
                series={speeds.map(s => ({ id: s, label: CATEGORY_LABEL[s], color: SPEED_COLOR[s], points: data.rating[s]!.map(p => ({ t: p.t, v: p.rating })) }))}
              />
            ) : (
              <p className="muted small">No rated games yet.</p>
            )}
          </section>

          <section className="panel">
            <h3>Results by colour</h3>
            <ResultBars title="Results by colour" rows={data.results.byColor} keepEmpty />
          </section>

          <section className="panel">
            <h3>Results by time control</h3>
            <ResultBars title="Results by time control" rows={data.results.byTimeControl} />
          </section>

          <section className="panel">
            <h3>Results by time of day</h3>
            <p className="muted small">When games ended, in your time zone.</p>
            <ResultBars title="Results by time of day" rows={data.results.byTimeOfDay} keepEmpty />
          </section>

          <section className="panel">
            <h3>Results against stronger and weaker players</h3>
            <p className="muted small">The opponent’s rating compared with yours, in rated games.</p>
            <ResultBars title="Results by opponent rating" rows={data.results.byOpponent} />
          </section>

          <section className="panel">
            <h3>Most-played openings</h3>
            <ResultBars title="Results by opening" rows={data.openings} />
            <p className="muted small">Names appear once opening names are imported on the server; until then, the first moves are shown.</p>
          </section>

          <section className="panel">
            <h3>Accuracy</h3>
            {data.accuracy.reviewed === 0 ? (
              <p className="muted small">No reviewed games yet. Review your games on the analysis board; they’re saved with the game.</p>
            ) : (
              <>
                <div className="stat-tiles">
                  <Tile label="Average accuracy" value={pct(data.accuracy.average)} note={`${data.accuracy.reviewed} reviewed game${data.accuracy.reviewed === 1 ? '' : 's'}`} />
                  <Tile label="Opening" value={pct(data.accuracy.byPhase.opening)} />
                  <Tile label="Middlegame" value={pct(data.accuracy.byPhase.middlegame)} />
                  <Tile label="Endgame" value={pct(data.accuracy.byPhase.endgame)} />
                </div>
                <div className="stat-tiles">
                  <Tile label="Blunders per game" value={num(data.accuracy.blunders)} />
                  <Tile label="Mistakes and misses per game" value={num(data.accuracy.mistakes)} />
                  <Tile label="Inaccuracies per game" value={num(data.accuracy.inaccuracies)} />
                </div>
                {data.accuracy.overTime.length > 1 && (
                  <LineChart
                    title="Accuracy in each reviewed game"
                    nameEnds={false}
                    formatValue={v => `${Math.round(v)}%`}
                    series={[{ id: 'accuracy', label: 'Accuracy', color: 'var(--viz-1)', points: data.accuracy.overTime.map(p => ({ t: p.t, v: p.accuracy })) }]}
                  />
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h3>Time</h3>
            {data.time.games === 0 ? (
              <p className="muted small">Clock times are saved for games played from now on; none of these games has them yet.</p>
            ) : (
              <>
                <div className="stat-tiles">
                  {data.time.perMove.map(p => (
                    <Tile key={p.label} label={`${speedLabel(p.label)}: time per move`} value={`${p.seconds} s`} note={`${p.games} game${p.games === 1 ? '' : 's'}`} />
                  ))}
                  <Tile
                    label="Time trouble"
                    value={pct(data.time.trouble.share)}
                    note={`of ${data.time.games} timed game${data.time.games === 1 ? '' : 's'}: under 10% of your clock left`}
                  />
                </div>
                {data.time.trouble.games > 0 && (
                  <>
                    <p className="muted small">How games in time trouble ended:</p>
                    <ResultBars title="Results in time trouble" rows={[{ ...data.time.trouble, label: 'In time trouble' }]} />
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

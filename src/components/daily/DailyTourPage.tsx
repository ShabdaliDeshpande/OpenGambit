import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../account/api';
import { daysLabel } from '../../daily/rules';
import { fetchDailyTour, joinDailyTour, type DailyTourView } from '../../daily/api';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

interface Props {
  id: string;
  meId: string | null;
  onSignIn: () => void;
  onBack: () => void;
  onOpenGame: (id: string) => void;
  onOpenProfile: (name: string) => void;
}

/** A daily tournament: who's in, the standings and the games. */
export function DailyTourPage({ id, meId, onSignIn, onBack, onOpenGame, onOpenProfile }: Props) {
  const [tour, setTour] = useState<DailyTourView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDailyTour(id)
      .then(t => {
        setTour(t);
        setError(null);
      })
      .catch(e => setError(errorText(e)));
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!tour) return <main className="daily">{error ? <p className="error">{error}</p> : <p role="status">Loading the tournament…</p>}</main>;

  const mine = tour.standings.find(s => s.id === meId);
  const joined = mine && !mine.withdrawn;
  const toggle = (join: boolean) =>
    void joinDailyTour(id, join)
      .then(t => {
        setTour(t);
        setError(null);
      })
      .catch(e => setError(errorText(e)));

  const when =
    tour.status === 'created'
      ? `Starts ${new Date(tour.startsAt).toLocaleString()}`
      : tour.status === 'started'
        ? tour.kind === 'swiss'
          ? `Round ${tour.round} of ${tour.nbRounds}`
          : `Ends ${new Date(tour.endsAt!).toLocaleString()}`
        : 'Finished';

  return (
    <main className="daily">
      <section className="panel">
        <button type="button" className="link-button" onClick={onBack}>
          ← Daily tournaments
        </button>
        <h2>🏆 {tour.name}</h2>
        <p className="muted small">
          {tour.kind === 'swiss' ? `Swiss, ${tour.nbRounds} rounds` : 'Arena'} · {daysLabel(tour.days)} · {tour.rated ? 'rated' : 'casual'} · {when}
        </p>
        {error && <p className="error">{error}</p>}
        {tour.status !== 'finished' &&
          (meId === null ? (
            <button type="button" className="primary" onClick={onSignIn}>
              Sign in to join
            </button>
          ) : joined ? (
            <button type="button" onClick={() => toggle(false)}>
              {tour.status === 'created' ? 'Leave' : 'Pause (stop getting new games)'}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => toggle(true)}>
              {mine ? 'Rejoin' : 'Join'}
            </button>
          ))}
      </section>

      <section className="panel">
        <h2>Standings</h2>
        {tour.standings.length === 0 ? (
          <p className="muted">Nobody has joined yet.</p>
        ) : (
          <table className="seek-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>{tour.kind === 'swiss' ? 'Points' : 'Score'}</th>
                <th>{tour.kind === 'swiss' ? 'Rounds' : 'Games'}</th>
              </tr>
            </thead>
            <tbody>
              {tour.standings.map(s => (
                <tr key={s.id} className={s.id === meId ? 'own' : ''}>
                  <td>{s.rank}</td>
                  <td>
                    <button type="button" className="link-button" onClick={() => onOpenProfile(s.name)}>
                      {s.name}
                    </button>
                    <span className="muted"> {s.rating}</span>
                    {s.withdrawn && <span className="muted"> (paused)</span>}
                  </td>
                  <td>{s.points}</td>
                  <td className="small">{s.detail.join(' ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {tour.games.length > 0 && (
        <section className="panel">
          <h2>Games</h2>
          <ul className="daily-list">
            {[...tour.games].reverse().map(g => (
              <li key={g.id}>
                <button type="button" className="link-button daily-open" onClick={() => onOpenGame(g.id)}>
                  {g.whiteName} – {g.blackName}
                </button>
                <span className="muted small">
                  {tour.kind === 'swiss' ? ` · round ${g.round}` : ''} · {g.result ?? 'playing'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

import { useEffect, useState } from 'react';
import { findTimeControl } from '../../chess/clock';
import type { OnlineClient, OnlineState } from '../../online/client';
import type { TourKind, TourSnapshot, TourStanding } from '../../online/protocol';
import { tourTiming } from './Tournaments';

interface StoredTour {
  id: string;
  kind: TourKind;
  name: string;
  tc: string;
  rated: boolean;
  createdByName: string;
  settings: Record<string, unknown>;
  players: number;
  winnerName: string | null;
  finishedAt: number;
  standings: TourStanding[];
}

const KIND_LABEL: Record<TourKind, string> = { arena: 'Arena', swiss: 'Swiss' };
const SWISS_MARK = { win: '1', draw: '½', loss: '0', bye: 'B', absent: '–' } as const;

interface Props {
  id: string;
  client: OnlineClient;
  state: OnlineState;
  signedIn: boolean;
  onSignIn: () => void;
  onBack: () => void;
  onOpenGame: (id: string) => void;
  onOpenProfile: (name: string) => void;
}

export function TournamentPage({ id, client, state, signedIn, onSignIn, onBack, onOpenGame, onOpenProfile }: Props) {
  const [now, setNow] = useState(() => performance.now());
  const [stored, setStored] = useState<StoredTour | null>(null);
  const received = state.tourPages[id];
  const missing = state.error?.tour === id && state.error.message === 'Tournament not found.';

  useEffect(() => {
    client.watchTour(id);
    return () => client.unwatchTour(id);
  }, [client, id]);

  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // no longer live: show the saved result
  useEffect(() => {
    if (!missing || received) return;
    fetch(`/api/tournaments/${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { tournament: StoredTour } | null) => d && setStored(d.tournament))
      .catch(() => undefined);
  }, [missing, received, id]);

  if (!received) {
    if (stored) return <StoredView tour={stored} onBack={onBack} onOpenProfile={onOpenProfile} />;
    return (
      <main className="lobby">
        <section className="panel">
          <p role="status">{missing ? 'Looking up this tournament…' : 'Loading the tournament…'}</p>
          <button type="button" onClick={onBack}>
            ← All tournaments
          </button>
        </section>
      </main>
    );
  }

  const t: TourSnapshot = received.snap;
  const elapsed = now - received.at;
  const error = state.error?.tour === id ? state.error : null;
  const nextRound = t.msToNextRound === null ? null : Math.max(0, t.msToNextRound - elapsed);

  return (
    <main className="tournament">
      <section className="panel tour-head">
        <button type="button" className="link-button back" onClick={onBack}>
          ← All tournaments
        </button>
        <h2>
          <span className={`tour-kind ${t.kind}`}>{KIND_LABEL[t.kind]}</span> {t.name}
        </h2>
        <p className="muted">
          {findTimeControl(t.tc)?.label ?? t.tc} · {t.rated ? 'Rated' : 'Casual'}
          {t.kind === 'arena' ? ` · ${t.durationMin} minutes${t.berserk ? ' · berserk allowed' : ''}` : ` · ${t.nbRounds} rounds`} · by {t.createdBy}
        </p>
        <p className={`tour-clock ${t.status}`} role="timer">
          {t.status === 'started' && t.kind === 'swiss' && nextRound !== null
            ? `Round ${t.round} of ${t.nbRounds} done · next round in ${Math.ceil(nextRound / 1000)} s`
            : tourTiming(t, elapsed)}
        </p>

        <div className="row">
          {t.you?.playing && (
            <button type="button" className="primary" onClick={() => onOpenGame(t.you!.playing!)}>
              ▶ Go to your game
            </button>
          )}
          {!signedIn ? (
            t.status !== 'finished' && (
              <button type="button" className="primary" onClick={onSignIn}>
                Sign in to join
              </button>
            )
          ) : t.canJoin ? (
            <button type="button" className="primary" onClick={() => client.send({ t: 'joinTour', id })}>
              {t.you?.withdrawn ? 'Rejoin' : 'Join'}
            </button>
          ) : (
            t.you?.joined &&
            !t.you.withdrawn &&
            t.status !== 'finished' && (
              <button type="button" onClick={() => client.send({ t: 'withdrawTour', id })}>
                {t.status === 'created' ? 'Leave' : 'Pause'}
              </button>
            )
          )}
        </div>
        {t.you?.joined && !t.you.withdrawn && t.status === 'created' && (
          <p className="muted small">You’re in. Keep this tab open: your games open here by themselves.</p>
        )}
        {t.you?.withdrawn && t.status === 'started' && <p className="muted small">You’re paused and won’t be paired until you rejoin.</p>}
        {error && (
          <p className="error" role="alert" key={error.n}>
            {error.message}
          </p>
        )}
      </section>

      <section className="panel" aria-label="Standings">
        <h2>{t.status === 'finished' ? 'Final standings' : 'Standings'}</h2>
        <Standings rows={t.standings} kind={t.kind} onOpenGame={onOpenGame} onOpenProfile={onOpenProfile} />
      </section>

      {t.games.length > 0 && (
        <section className="panel" aria-label="Games being played">
          <h2>Playing now</h2>
          <ul className="live-games">
            {t.games.map(g => (
              <li key={g.id}>
                <span>
                  {g.white} – {g.black}
                </span>
                <button type="button" onClick={() => onOpenGame(g.id)}>
                  👁 Watch
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Standings({
  rows,
  kind,
  onOpenGame,
  onOpenProfile,
}: {
  rows: TourStanding[];
  kind: TourKind;
  onOpenGame?: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  if (rows.length === 0) return <p className="muted">Nobody has joined yet.</p>;
  return (
    <table className="standings">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Player</th>
          <th scope="col">{kind === 'arena' ? 'Games' : 'Rounds'}</th>
          <th scope="col" title={kind === 'arena' ? 'Performance rating' : 'Sonneborn–Berger'}>
            {kind === 'arena' ? 'Perf' : 'SB'}
          </th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(s => (
          <tr key={s.id} className={s.withdrawn ? 'paused' : ''}>
            <td>{s.rank === 1 && rows.length > 1 ? '🏆' : s.rank}</td>
            <td>
              <button type="button" className="link-button" onClick={() => onOpenProfile(s.name)}>
                {s.name}
              </button>
              <span className="muted"> {s.rating}</span>
              {s.fire && <span title="On fire: the next win counts double"> 🔥</span>}
              {s.withdrawn && <span className="muted small"> (paused)</span>}
              {s.playing && onOpenGame && (
                <button type="button" className="link-button playing-link" onClick={() => onOpenGame(s.playing!)} title="Watch their game">
                  ● playing
                </button>
              )}
            </td>
            <td className="sheet">
              {kind === 'arena'
                ? (s.arena ?? []).map((e, i) => (
                    <span key={i} className={`sheet-item ${e.result}${e.fire ? ' fire' : ''}`} title={`${e.result}${e.berserk ? ', berserk' : ''}`}>
                      {e.points}
                      {e.berserk && e.result === 'win' ? '⚡' : ''}
                    </span>
                  ))
                : (s.swiss ?? []).map(r => (
                    <span
                      key={r.round}
                      className={`sheet-item ${r.outcome}`}
                      title={`Round ${r.round}: ${r.outcome}${r.opponent ? ` vs ${r.opponent}` : ''}${r.color ? ` (${r.color === 'w' ? 'White' : 'Black'})` : ''}`}
                    >
                      {SWISS_MARK[r.outcome]}
                    </span>
                  ))}
            </td>
            <td>{s.tieBreak ?? ''}</td>
            <td className="score">{s.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StoredView({ tour, onBack, onOpenProfile }: { tour: StoredTour; onBack: () => void; onOpenProfile: (name: string) => void }) {
  return (
    <main className="tournament">
      <section className="panel tour-head">
        <button type="button" className="link-button back" onClick={onBack}>
          ← All tournaments
        </button>
        <h2>
          <span className={`tour-kind ${tour.kind}`}>{KIND_LABEL[tour.kind]}</span> {tour.name}
        </h2>
        <p className="muted">
          {findTimeControl(tour.tc)?.label ?? tour.tc} · {tour.rated ? 'Rated' : 'Casual'} · {tour.players} players · by {tour.createdByName} · finished{' '}
          {new Date(tour.finishedAt).toLocaleString()}
        </p>
        {tour.winnerName && <p className="tour-clock finished">🏆 {tour.winnerName}</p>}
      </section>
      <section className="panel" aria-label="Final standings">
        <h2>Final standings</h2>
        <Standings rows={tour.standings} kind={tour.kind} onOpenProfile={onOpenProfile} />
      </section>
    </main>
  );
}

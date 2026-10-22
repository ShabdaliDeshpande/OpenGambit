import { useEffect, useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  diffText,
  fetchGame,
  fetchGames,
  fetchProfile,
  ratingText,
  type Profile,
  type PublicGame,
} from '../../account/api';
import { findTimeControl } from '../../chess/clock';
import { TERMINATION_LABEL } from '../../chess/gameEnd';
import { gamePgn } from '../../online/view';
import { AccountSettings } from './AccountSettings';

const REASON: Record<string, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  threefold: 'repetition',
  'fifty-move': '50-move rule',
  insufficient: 'insufficient material',
  timeout: 'time',
  'timeout-vs-insufficient': 'time vs insufficient material',
  resign: 'resignation',
  agreement: 'agreement',
  abandoned: 'opponent left',
  'abandoned-draw': 'opponent left',
};

const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

interface Props {
  username: string;
  /** The signed-in user's id, to mark their side of each game. */
  meId: string | null;
  onOpenProfile: (name: string) => void;
  onAnalyse: (pgn: string) => void;
  onAccountDeleted: () => void;
}

export function ProfileView({ username, meId, onOpenProfile, onAnalyse, onAccountDeleted }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<PublicGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setGames([]);
    setError(null);
    fetchProfile(username)
      .then(p => {
        if (cancelled) return;
        setProfile(p);
        setGames(p.games);
        setMore(p.games.length < p.totalGames);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [username]);

  const loadMore = async () => {
    const last = games.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const next = await fetchGames(username, last.endedAt);
      setGames(g => [...g, ...next]);
      setMore(next.length > 0 && games.length + next.length < (profile?.totalGames ?? 0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const analyse = async (g: PublicGame) => {
    try {
      const full = await fetchGame(g.id);
      onAnalyse(
        gamePgn({
          moves: full.moves ?? [],
          white: full.white.name,
          black: full.black.name,
          tc: full.tc,
          result: full.result,
          rated: full.rated,
          whiteElo: full.white.rating,
          blackElo: full.black.rating,
          date: new Date(full.endedAt),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && !profile)
    return (
      <main className="profile">
        <section className="panel">
          <p role="alert">{error}</p>
        </section>
      </main>
    );
  if (!profile)
    return (
      <main className="profile">
        <section className="panel">
          <p role="status">Loading {username}…</p>
        </section>
      </main>
    );

  const subject = profile.user;
  return (
    <main className="profile">
      <section className="panel">
        <h2 className="profile-name">{subject.username}</h2>
        <p className="muted">
          Joined {dateText(subject.createdAt)} · {profile.totalGames} game{profile.totalGames === 1 ? '' : 's'}
        </p>
        <div className="rating-cards">
          {CATEGORIES.map(c => {
            const r = profile.ratings[c];
            return (
              <div key={c} className="rating-card">
                <span className="stat-label">{CATEGORY_LABEL[c]}</span>
                <span className="stat-value" title={r.provisional ? 'Provisional: not enough rated games yet' : undefined}>
                  {ratingText(r)}
                </span>
                <span className="muted small">
                  ±{r.deviation} · {r.games} rated game{r.games === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
          {profile.puzzleRating && (
            <div className="rating-card puzzle">
              <span className="stat-label">🧩 Puzzles</span>
              <span className="stat-value" title={profile.puzzleRating.provisional ? 'Provisional: not enough rated puzzles yet' : undefined}>
                {ratingText(profile.puzzleRating)}
              </span>
              <span className="muted small">±{profile.puzzleRating.deviation}</span>
            </div>
          )}
          {profile.runs && (
            <div className="rating-card">
              <span className="stat-label">🔥 Streak · ⚡ Storm</span>
              <span className="stat-value">
                {profile.runs.streak.best} · {profile.runs.storm.best}
              </span>
              <span className="muted small">best runs</span>
            </div>
          )}
        </div>
        <p className="muted small">
          Ratings use Glicko-2. A “?” means the rating is still provisional: its uncertainty (±) is 110 or more.
        </p>
      </section>

      <section className="panel">
        <h2>Games</h2>
        {games.length === 0 ? (
          <p className="muted">No games yet.</p>
        ) : (
          <ul className="history">
            {games.map(g => {
              const mine = g.white.id === subject.id ? 'white' : 'black';
              const score = g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === (mine === 'white') ? 'win' : 'loss';
              const side = (s: 'white' | 'black') => {
                const p = g[s];
                return (
                  <span className={s === mine ? 'me' : ''}>
                    {p.id && p.id !== subject.id ? (
                      <button type="button" className="link-button" onClick={() => onOpenProfile(p.name)}>
                        {p.name}
                      </button>
                    ) : (
                      p.name
                    )}
                    {p.rating !== null && <span className="muted"> ({p.rating})</span>}
                  </span>
                );
              };
              return (
                <li key={g.id} className={`history-item ${score}`}>
                  <div className="history-main">
                    <span className={`result-badge ${score}`}>{score === 'win' ? 'Won' : score === 'loss' ? 'Lost' : 'Draw'}</span>
                    <span>
                      {side('white')} – {side('black')}
                    </span>
                  </div>
                  <div className="history-meta muted small">
                    {g.result} by {REASON[g.reason] ?? TERMINATION_LABEL[g.reason as keyof typeof TERMINATION_LABEL] ?? g.reason} ·{' '}
                    {findTimeControl(g.tc)?.label ?? g.tc} · {g.rated ? 'Rated' : 'Casual'} · {Math.ceil(g.plies / 2)} moves · {dateText(g.endedAt)}
                    {g[mine].diff !== null && <strong className={`diff ${g[mine].diff! >= 0 ? 'up' : 'down'}`}> {diffText(g[mine].diff)}</strong>}
                  </div>
                  <button type="button" onClick={() => analyse(g)} disabled={g.plies === 0}>
                    🔍 Analyse
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {more && games.length > 0 && (
          <button type="button" onClick={loadMore} disabled={busy}>
            {busy ? 'Loading…' : 'Show older games'}
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {meId === subject.id && <p className="muted small">Games against guests are casual and saved without ratings.</p>}
      </section>

      {meId === subject.id && <AccountSettings username={subject.username} onDeleted={onAccountDeleted} />}
    </main>
  );
}

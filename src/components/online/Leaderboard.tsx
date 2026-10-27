import { useEffect, useState } from 'react';
import { CATEGORIES, CATEGORY_LABEL, fetchLeaderboard, type Category, type LeaderboardEntry } from '../../account/api';
import { Flair } from '../Flair';

const BOARDS: { key: Category | 'puzzle'; label: string }[] = [...CATEGORIES.map(c => ({ key: c, label: CATEGORY_LABEL[c] })), { key: 'puzzle', label: '🧩 Puzzles' }];

export function Leaderboard({ onOpenProfile }: { onOpenProfile: (name: string) => void }) {
  const [boards, setBoards] = useState<Record<Category | 'puzzle', LeaderboardEntry[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard()
      .then(setBoards)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="lobby leaderboard">
      {BOARDS.map(({ key, label }) => (
        <section key={key} className="panel" aria-label={`${label} leaderboard`}>
          <h2>{label}</h2>
          {error ? (
            <p className="error">{error}</p>
          ) : !boards ? (
            <p className="muted">Loading…</p>
          ) : boards[key].length === 0 ? (
            <p className="muted small">Nobody with an established rating yet.</p>
          ) : (
            <ol className="leader-list">
              {boards[key].map((e, i) => (
                <li key={e.username}>
                  <span className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                  <button type="button" className="link-button" onClick={() => onOpenProfile(e.username)}>
                    {e.username}
                  </button>
                  <Flair flair={e.flair} />
                  <span className="rating">{e.rating}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      <p className="muted small leader-note">
        Only established ratings are listed: not provisional (uncertainty under 110) and at least 2 rated games. Uncertainty grows while a player
        is away, so inactive players drop off by themselves.
      </p>
    </main>
  );
}

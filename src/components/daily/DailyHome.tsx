import { useCallback, useEffect, useState } from 'react';
import type { Color } from 'chess.js';
import { ApiError, ratingText } from '../../account/api';
import { DAYS_PER_MOVE, daysLabel, timeLeftText } from '../../daily/rules';
import {
  acceptDailySeek,
  answerChallenge,
  cancelDailySeek,
  createDailySeek,
  createDailyTour,
  fetchChallenges,
  fetchDailyGames,
  fetchDailySeeks,
  fetchDailyTours,
  sendChallenge,
  type DailyChallenge,
  type DailySeek,
  type DailyTourSummary,
  type MyDailyGame,
  type TourForm,
} from '../../daily/api';
import { Flair } from '../Flair';

type Section = 'games' | 'lobby' | 'tours';
const REFRESH_MS = 60_000;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
const colorText = (c: Color | 'random') => (c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random');

interface Props {
  signedIn: boolean;
  onSignIn: () => void;
  onOpenGame: (id: string) => void;
  onOpenTour: (id: string) => void;
  onOpenProfile: (name: string) => void;
}

/** Daily chess: your games, the daily lobby and daily tournaments. */
export function DailyHome({ signedIn, onSignIn, onOpenGame, onOpenTour, onOpenProfile }: Props) {
  // until you pick one, the section follows whether you're signed in (that's known a moment after loading)
  const [chosen, setSection] = useState<Section | null>(null);
  const section = chosen ?? (signedIn ? 'games' : 'lobby');
  return (
    <main className="daily">
      <section className="panel">
        <h2>Daily chess</h2>
        <p className="muted small">Correspondence games at 1 to 14 days per move. Play as many as you like, and come back when it’s your move.</p>
        <div className="segmented" role="radiogroup" aria-label="Daily chess">
          {(
            [
              ['games', 'My games'],
              ['lobby', 'Find a game'],
              ['tours', '🏆 Daily tournaments'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={section === id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>
      {!signedIn && section !== 'tours' && (
        <section className="panel">
          <p>Daily games last days, so they need an account.</p>
          <button type="button" className="primary" onClick={onSignIn}>
            Sign in to play
          </button>
        </section>
      )}
      {section === 'games' && signedIn && <MyGames onOpenGame={onOpenGame} onOpenProfile={onOpenProfile} />}
      {section === 'lobby' && <DailyLobby signedIn={signedIn} onOpenGame={onOpenGame} onOpenProfile={onOpenProfile} />}
      {section === 'tours' && <DailyTours signedIn={signedIn} onSignIn={onSignIn} onOpenTour={onOpenTour} />}
    </main>
  );
}

function useRefreshing<T>(load: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) return;
    load()
      .then(d => {
        setData(d);
        setError(null);
      })
      .catch(e => setError(errorText(e)));
  }, [load, enabled]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, error, refresh, setError };
}

function MyGames({ onOpenGame, onOpenProfile }: { onOpenGame: (id: string) => void; onOpenProfile: (name: string) => void }) {
  const load = useCallback(async () => ({ games: await fetchDailyGames(), challenges: await fetchChallenges() }), []);
  const { data, error, refresh, setError } = useRefreshing(load);
  const now = Date.now();

  const answer = async (c: DailyChallenge, action: 'accept' | 'decline' | 'cancel') => {
    try {
      const game = await answerChallenge(c.id, action);
      if (game) onOpenGame(game);
      else refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!data) return <p role="status">{error ?? 'Loading your daily games…'}</p>;
  const yourMove = data.games.filter(g => g.yourMove).length;
  return (
    <>
      {error && <p className="error">{error}</p>}
      {data.challenges.length > 0 && (
        <section className="panel">
          <h2>Challenges</h2>
          <ul className="daily-list">
            {data.challenges.map(c => (
              <li key={c.id}>
                <span>
                  {c.incoming ? 'From ' : 'To '}
                  <button type="button" className="link-button" onClick={() => onOpenProfile(c.name)}>
                    {c.name}
                  </button>
                  <Flair flair={c.flair} /> · {daysLabel(c.days)} · {c.rated ? 'rated' : 'casual'} · {c.incoming ? `you play ${colorText(c.color === 'random' ? 'random' : c.color === 'w' ? 'b' : 'w')}` : `you play ${colorText(c.color)}`}
                </span>
                <span className="row">
                  {c.incoming ? (
                    <>
                      <button type="button" className="primary" onClick={() => void answer(c, 'accept')}>
                        Accept
                      </button>
                      <button type="button" onClick={() => void answer(c, 'decline')}>
                        Decline
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => void answer(c, 'cancel')}>
                      Cancel
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <h2>
          My games{yourMove > 0 && <span className="daily-badge">{yourMove} to move</span>}
        </h2>
        {data.games.length === 0 ? (
          <p className="muted">No daily games yet. Find one in the lobby, or challenge a player.</p>
        ) : (
          <ul className="daily-list">
            {data.games.map((g: MyDailyGame) => (
              <li key={g.id} className={g.yourMove ? 'your-move' : ''}>
                <button type="button" className="link-button daily-open" onClick={() => onOpenGame(g.id)}>
                  vs {g.opponent}
                </button>
                <Flair flair={g.opponentFlair} />
                <span className="muted small">
                  {' '}
                  · you play {g.you === 'w' ? 'White' : 'Black'} · move {Math.floor(g.moves.length / 2) + 1} · {daysLabel(g.days)}
                  {g.tourId ? ' · tournament' : ''}
                </span>
                <span className={g.yourMove ? 'daily-turn mine' : 'daily-turn'}>{g.yourMove ? `Your move · ${timeLeftText(g.deadline - now)} left` : 'Their move'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SpecFields({ days, setDays, color, setColor, rated, setRated }: { days: number; setDays: (d: number) => void; color: Color | 'random'; setColor: (c: Color | 'random') => void; rated: boolean; setRated: (r: boolean) => void }) {
  return (
    <>
      <label>
        Days per move
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          {DAYS_PER_MOVE.map(d => (
            <option key={d} value={d}>
              {daysLabel(d)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Your colour
        <select value={color} onChange={e => setColor(e.target.value as Color | 'random')}>
          <option value="random">Random</option>
          <option value="w">White</option>
          <option value="b">Black</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={rated} onChange={e => setRated(e.target.checked)} /> Rated
      </label>
    </>
  );
}

function DailyLobby({ signedIn, onOpenGame, onOpenProfile }: { signedIn: boolean; onOpenGame: (id: string) => void; onOpenProfile: (name: string) => void }) {
  const { data: seeks, error, refresh, setError } = useRefreshing(fetchDailySeeks);
  const [days, setDays] = useState(3);
  const [color, setColor] = useState<Color | 'random'>('random');
  const [rated, setRated] = useState(true);
  const [to, setTo] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      setNote(done ?? null);
      setError(null);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <section className="panel">
        <h2>Open daily seeks</h2>
        {error && <p className="error">{error}</p>}
        {!seeks ? (
          <p role="status">Loading…</p>
        ) : seeks.length === 0 ? (
          <p className="muted">No open seeks. Create one below and someone will pick it up.</p>
        ) : (
          <table className="seek-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Time</th>
                <th>Colour</th>
                <th>Mode</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {seeks.map((s: DailySeek) => (
                <tr key={s.id} className={s.mine ? 'own' : ''}>
                  <td>
                    <button type="button" className="link-button" onClick={() => onOpenProfile(s.name)}>
                      {s.name}
                    </button>
                    <Flair flair={s.flair} />
                    <span className="muted"> {ratingText(s.rating)}</span>
                  </td>
                  <td>{daysLabel(s.days)}</td>
                  <td>{colorText(s.color)}</td>
                  <td>{s.rated ? 'Rated' : 'Casual'}</td>
                  <td>
                    {s.mine ? (
                      <button type="button" onClick={() => void act(() => cancelDailySeek(s.id))}>
                        Cancel
                      </button>
                    ) : (
                      <button type="button" className="primary" disabled={!signedIn} onClick={() => void act(async () => onOpenGame(await acceptDailySeek(s.id)))}>
                        Play
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {signedIn && (
        <section className="panel">
          <h2>New daily game</h2>
          <div className="daily-form">
            <SpecFields days={days} setDays={setDays} color={color} setColor={setColor} rated={rated} setRated={setRated} />
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={() => void act(() => createDailySeek(days, color, rated), 'Your seek is open. You’ll get a notification when someone takes it.')}>
              Create a seek
            </button>
          </div>
          <div className="daily-form">
            <label>
              Or challenge a player
              <input value={to} maxLength={40} placeholder="Username" onChange={e => setTo(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button type="button" disabled={!to.trim()} onClick={() => void act(() => sendChallenge(to.trim(), days, color, rated), `Challenge sent to ${to.trim()}.`)}>
              Send challenge
            </button>
          </div>
          {note && (
            <p className="muted small" role="status">
              {note}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function DailyTours({ signedIn, onSignIn, onOpenTour }: { signedIn: boolean; onSignIn: () => void; onOpenTour: (id: string) => void }) {
  const { data: tours, error, setError } = useRefreshing(fetchDailyTours);
  const [form, setForm] = useState<TourForm>({ kind: 'swiss', name: '', days: 3, rated: true, startInHours: 24, nbRounds: 5, durationDays: 14 });
  const set = (p: Partial<TourForm>) => setForm(f => ({ ...f, ...p }));

  const create = async () => {
    try {
      onOpenTour(await createDailyTour({ ...form, name: form.name.trim() || `${form.kind === 'swiss' ? 'Daily Swiss' : 'Daily Arena'}` }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <section className="panel">
        <h2>Daily tournaments</h2>
        {error && <p className="error">{error}</p>}
        {!tours ? (
          <p role="status">Loading…</p>
        ) : tours.length === 0 ? (
          <p className="muted">No daily tournaments yet.</p>
        ) : (
          <ul className="daily-list">
            {tours.map((t: DailyTourSummary) => (
              <li key={t.id}>
                <button type="button" className="link-button daily-open" onClick={() => onOpenTour(t.id)}>
                  {t.name}
                </button>
                <span className="muted small">
                  {' '}
                  · {t.kind === 'swiss' ? `Swiss, ${t.nbRounds} rounds` : `Arena, ${Math.round(((t.endsAt ?? t.startsAt) - t.startsAt) / 86_400_000)} days`} · {daysLabel(t.days)} · {t.players} player
                  {t.players === 1 ? '' : 's'}
                </span>
                <span className="daily-turn">{t.status === 'created' ? `Starts ${new Date(t.startsAt).toLocaleString()}` : t.status === 'started' ? (t.kind === 'swiss' ? `Round ${t.round}` : 'Running') : 'Finished'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>Create a daily tournament</h2>
        {!signedIn ? (
          <button type="button" className="primary" onClick={onSignIn}>
            Sign in to create one
          </button>
        ) : (
          <>
            <div className="daily-form">
              <label>
                Name
                <input value={form.name} maxLength={60} placeholder={form.kind === 'swiss' ? 'Daily Swiss' : 'Daily Arena'} onChange={e => set({ name: e.target.value })} />
              </label>
              <label>
                Format
                <select value={form.kind} onChange={e => set({ kind: e.target.value as TourForm['kind'] })}>
                  <option value="swiss">Swiss</option>
                  <option value="arena">Arena</option>
                </select>
              </label>
              <label>
                Days per move
                <select value={form.days} onChange={e => set({ days: Number(e.target.value) })}>
                  {DAYS_PER_MOVE.map(d => (
                    <option key={d} value={d}>
                      {daysLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              {form.kind === 'swiss' ? (
                <label>
                  Rounds
                  <select value={form.nbRounds} onChange={e => set({ nbRounds: Number(e.target.value) })}>
                    {[3, 4, 5, 6, 7, 8, 9].map(n => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Runs for
                  <select value={form.durationDays} onChange={e => set({ durationDays: Number(e.target.value) })}>
                    {[7, 14, 28].map(n => (
                      <option key={n} value={n}>
                        {n} days
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Starts in
                <select value={form.startInHours} onChange={e => set({ startInHours: Number(e.target.value) })}>
                  {[1, 6, 12, 24, 48, 72, 168].map(h => (
                    <option key={h} value={h}>
                      {h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={form.rated} onChange={e => set({ rated: e.target.checked })} /> Rated
              </label>
            </div>
            <p className="muted small">
              {form.kind === 'swiss'
                ? 'Everyone plays one game per round; a round lasts until its games finish.'
                : 'Play one game at a time; when it ends you’re paired again, until the Arena’s time is up.'}
            </p>
            <button type="button" className="primary" onClick={() => void create()}>
              Create
            </button>
          </>
        )}
      </section>
    </>
  );
}

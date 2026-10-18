import { useState } from 'react';
import { ratingText, type Me } from '../../account/api';
import { findTimeControl, speedOf, TIME_CONTROLS } from '../../chess/clock';
import type { OnlineClient, OnlineState } from '../../online/client';
import { SEEK_RANGES, type SeekColor, type SeekInfo } from '../../online/protocol';

const COLOR_LABEL: Record<SeekColor, string> = { random: 'Random', w: 'White', b: 'Black' };
const COLOR_ICON: Record<SeekColor, string> = { random: '◐', w: '○', b: '●' };

const tcLabel = (id: string) => findTimeControl(id)?.label ?? id;

interface Props {
  client: OnlineClient | null;
  state: OnlineState;
  /** Signed in according to the account API (the socket may still be reconnecting). */
  signedIn: boolean;
  myRatings: Me['ratings'] | null;
  onSignIn: () => void;
  onOpenProfile: (name: string) => void;
  onWatch: (game: string) => void;
}

export function Lobby({ client, state, signedIn, myRatings, onSignIn, onOpenProfile, onWatch }: Props) {
  const [color, setColor] = useState<SeekColor>('random');
  const [ratedChoice, setRatedChoice] = useState(true);
  const [range, setRange] = useState<number | null>(null);
  const { me, lobby } = state;
  const ready = !!client && state.status === 'online';
  const registered = !!me?.registered;
  const rated = registered && ratedChoice;
  const seeks = lobby?.seeks ?? [];
  const mine = seeks.filter(s => s.owner === me?.id);
  const error = state.error && !state.error.game ? state.error : null;
  // a seek with a rating range only accepts players within it
  const withinRange = (s: SeekInfo) => {
    if (s.range === null || !s.rating) return true;
    const tc = findTimeControl(s.tc);
    const mine = tc && myRatings ? myRatings[speedOf(tc)] : null;
    return !!mine && Math.abs(mine.rating - s.rating.rating) <= s.range;
  };

  return (
    <main className="lobby">
      <section className="panel" aria-label="Create a game">
        <h2>Create a game</h2>
        <p className="muted">Pick a time control. Someone in the lobby can accept it, or you’re paired at once with a matching seek.</p>
        <fieldset className="color-choice">
          <legend>Your colour</legend>
          {(['random', 'w', 'b'] as const).map(c => (
            <label key={c}>
              <input type="radio" name="seek-color" value={c} checked={color === c} onChange={() => setColor(c)} />
              <span>
                {COLOR_ICON[c]} {COLOR_LABEL[c]}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="color-choice">
          <legend>Mode</legend>
          <label>
            <input type="radio" name="seek-mode" checked={rated} disabled={!registered} onChange={() => setRatedChoice(true)} />
            <span>Rated</span>
          </label>
          <label>
            <input type="radio" name="seek-mode" checked={!rated} onChange={() => setRatedChoice(false)} />
            <span>Casual</span>
          </label>
        </fieldset>
        {registered && (
          <label className="field range-field">
            <span>Opponent’s rating</span>
            <select value={range ?? ''} onChange={e => setRange(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Anyone</option>
              {SEEK_RANGES.map(r => (
                <option key={r} value={r}>
                  Within ±{r} of mine
                </option>
              ))}
            </select>
          </label>
        )}
        {!signedIn && (
          <p className="muted small">
            <button type="button" className="link-button" onClick={onSignIn}>
              Sign in
            </button>{' '}
            to play rated games. Guests play casual games.
          </p>
        )}
        <div className="tc-grid">
          {TIME_CONTROLS.map(tc => (
            <button key={tc.id} type="button" disabled={!ready} onClick={() => client?.send({ t: 'seek', tc: tc.id, color, rated, range })}>
              <strong>{tc.id}</strong>
              <span>{tc.label.split(' ')[1]}</span>
            </button>
          ))}
        </div>
        {mine.length > 0 && (
          <p className="waiting" role="status">
            Waiting for an opponent…
          </p>
        )}
        {error && (
          <p className="error" role="alert" key={error.n}>
            {error.message}
          </p>
        )}
      </section>

      <section className="panel" aria-label="Open seeks">
        <h2>Open seeks</h2>
        {seeks.length === 0 ? (
          <p className="muted">No open seeks yet. Create one, or wait for someone to join.</p>
        ) : (
          <table className="seek-table">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Time</th>
                <th scope="col">Mode</th>
                <th scope="col">
                  <span className="sr-only">Colour</span>
                </th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {seeks.map(s => {
                const own = s.owner === me?.id;
                const inRange = withinRange(s);
                const canJoin = (!s.rated || registered) && inRange;
                return (
                  <tr key={s.id} className={own ? 'own' : ''}>
                    <td>
                      {s.registered ? (
                        <button type="button" className="link-button" onClick={() => onOpenProfile(s.name)}>
                          {s.name}
                        </button>
                      ) : (
                        s.name
                      )}
                      {s.rating && <span className="muted"> {ratingText(s.rating)}</span>}
                      {own && <span className="muted"> (you)</span>}
                    </td>
                    <td>{tcLabel(s.tc)}</td>
                    <td>
                      {s.rated ? 'Rated' : 'Casual'}
                      {s.range !== null && <span className="muted small"> ±{s.range}</span>}
                    </td>
                    <td title={`Seeker plays ${COLOR_LABEL[s.color]}`}>{COLOR_ICON[s.color]}</td>
                    <td>
                      {own ? (
                        <button type="button" onClick={() => client?.send({ t: 'cancelSeek', id: s.id })}>
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary"
                          disabled={!canJoin}
                          title={canJoin ? undefined : !inRange ? 'Your rating is outside this seek’s range' : 'Sign in to play rated games'}
                          onClick={() => client?.send({ t: 'acceptSeek', id: s.id })}
                        >
                          Play
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" aria-label="Games in progress">
        <h2>Games in progress</h2>
        {lobby && lobby.games.length > 0 ? (
          <ul className="live-games">
            {lobby.games.map(g => (
              <li key={g.id}>
                <span>
                  {g.white} – {g.black}{' '}
                  <span className="muted">
                    · {tcLabel(g.tc)}
                    {g.rated ? ' · Rated' : ''}
                  </span>
                </span>
                <button type="button" onClick={() => onWatch(g.id)}>
                  👁 Watch
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No games being played right now.</p>
        )}
        <p className="muted lobby-footer">
          {me ? `You are ${me.name}${me.registered ? '' : ' (guest)'}.` : 'Not connected.'} {lobby ? `${lobby.online} online.` : ''}
        </p>
      </section>
    </main>
  );
}

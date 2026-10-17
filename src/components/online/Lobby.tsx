import { useState } from 'react';
import { findTimeControl, TIME_CONTROLS } from '../../chess/clock';
import type { OnlineClient, OnlineState } from '../../online/client';
import type { SeekColor } from '../../online/protocol';

const COLOR_LABEL: Record<SeekColor, string> = { random: 'Random', w: 'White', b: 'Black' };
const COLOR_ICON: Record<SeekColor, string> = { random: '◐', w: '○', b: '●' };

const tcLabel = (id: string) => findTimeControl(id)?.label ?? id;

interface Props {
  client: OnlineClient | null;
  state: OnlineState;
  onWatch: (game: string) => void;
}

export function Lobby({ client, state, onWatch }: Props) {
  const [color, setColor] = useState<SeekColor>('random');
  const { me, lobby } = state;
  const ready = !!client && state.status === 'online';
  const seeks = lobby?.seeks ?? [];
  const mine = seeks.filter(s => s.owner === me?.id);
  const error = state.error && !state.error.game ? state.error : null;

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
        <div className="tc-grid">
          {TIME_CONTROLS.map(tc => (
            <button
              key={tc.id}
              type="button"
              disabled={!ready}
              onClick={() => client?.send({ t: 'seek', tc: tc.id, color })}
            >
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
                <th scope="col">Colour</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {seeks.map(s => {
                const own = s.owner === me?.id;
                return (
                  <tr key={s.id} className={own ? 'own' : ''}>
                    <td>{own ? `${s.name} (you)` : s.name}</td>
                    <td>{tcLabel(s.tc)}</td>
                    <td title={COLOR_LABEL[s.color]}>
                      {COLOR_ICON[s.color]} {COLOR_LABEL[s.color]}
                    </td>
                    <td>
                      {own ? (
                        <button type="button" onClick={() => client?.send({ t: 'cancelSeek', id: s.id })}>
                          Cancel
                        </button>
                      ) : (
                        <button type="button" className="primary" onClick={() => client?.send({ t: 'acceptSeek', id: s.id })}>
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
                  {g.white} – {g.black} <span className="muted">· {tcLabel(g.tc)}</span>
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
          {me ? `You are ${me.name}.` : 'Not connected.'} {lobby ? `${lobby.online} online.` : ''}
        </p>
      </section>
    </main>
  );
}

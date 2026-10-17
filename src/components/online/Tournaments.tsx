import { useEffect, useState } from 'react';
import { findTimeControl, TIME_CONTROLS } from '../../chess/clock';
import type { OnlineClient, OnlineState } from '../../online/client';
import { TOUR_OPTIONS, type CreateTour, type TourKind, type TourSummary } from '../../online/protocol';
import { countdown } from '../../online/view';

interface FinishedTour {
  id: string;
  kind: TourKind;
  name: string;
  tc: string;
  rated: boolean;
  players: number;
  winnerName: string | null;
  finishedAt: number;
}

const tcLabel = (id: string) => findTimeControl(id)?.label ?? id;
const KIND_LABEL: Record<TourKind, string> = { arena: 'Arena', swiss: 'Swiss' };

export function tourTiming(t: TourSummary, elapsed: number): string {
  const left = (ms: number | null) => (ms === null ? '' : countdown(Math.max(0, ms - elapsed)));
  if (t.status === 'created') return `starts in ${left(t.msToStart)}`;
  if (t.status === 'finished') return t.cancelled ? 'cancelled' : t.winner ? `won by ${t.winner}` : 'finished';
  return t.kind === 'arena' ? `${left(t.msToEnd)} left` : `round ${t.round} of ${t.nbRounds}`;
}

interface Props {
  client: OnlineClient | null;
  state: OnlineState;
  signedIn: boolean;
  onSignIn: () => void;
  onOpen: (id: string) => void;
}

export function Tournaments({ client, state, signedIn, onSignIn, onOpen }: Props) {
  const [now, setNow] = useState(() => performance.now());
  const [finished, setFinished] = useState<FinishedTour[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    client?.setTourList(true);
    return () => client?.setTourList(false);
  }, [client]);

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch('/api/tournaments')
      .then(r => (r.ok ? r.json() : { tournaments: [] }))
      .then((d: { tournaments: FinishedTour[] }) => setFinished(d.tournaments))
      .catch(() => undefined);
  }, []);

  // open the tournament we just created
  const created = state.created;
  const [seenCreated, setSeenCreated] = useState(created?.n ?? 0);
  useEffect(() => {
    if (created && created.n !== seenCreated) {
      setSeenCreated(created.n);
      setCreating(false);
      onOpen(created.id);
    }
  }, [created, seenCreated, onOpen]);

  const live = state.tours?.list ?? [];
  const elapsed = state.tours ? now - state.tours.at : 0;
  const liveIds = new Set(live.map(t => t.id));
  const error = state.error && !state.error.game && !state.error.tour ? state.error : null;

  return (
    <main className="lobby tournaments">
      <section className="panel" aria-label="Tournaments">
        <div className="panel-head">
          <h2>Tournaments</h2>
          {signedIn ? (
            <button type="button" className="primary" onClick={() => setCreating(c => !c)}>
              {creating ? 'Close' : '+ New tournament'}
            </button>
          ) : (
            <button type="button" onClick={onSignIn}>
              Sign in to create or join
            </button>
          )}
        </div>
        {creating && client && <CreateForm client={client} />}
        {error && (
          <p className="error" role="alert" key={error.n}>
            {error.message}
          </p>
        )}
        {live.length === 0 ? (
          <p className="muted">No tournaments right now. {signedIn ? 'Create one!' : ''}</p>
        ) : (
          <ul className="tour-list">
            {live.map(t => (
              <li key={t.id}>
                <button type="button" className="tour-row" onClick={() => onOpen(t.id)}>
                  <span className={`tour-kind ${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                  <span className="tour-name">{t.name}</span>
                  <span className="muted small">
                    {tcLabel(t.tc)} · {t.rated ? 'Rated' : 'Casual'} · {t.players} player{t.players === 1 ? '' : 's'} · {tourTiming(t, elapsed)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-label="Finished tournaments">
        <h2>Recently finished</h2>
        {finished.filter(t => !liveIds.has(t.id)).length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="tour-list">
            {finished
              .filter(t => !liveIds.has(t.id))
              .map(t => (
                <li key={t.id}>
                  <button type="button" className="tour-row" onClick={() => onOpen(t.id)}>
                    <span className={`tour-kind ${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                    <span className="tour-name">{t.name}</span>
                    <span className="muted small">
                      {tcLabel(t.tc)} · {t.players} players · {t.winnerName ? `🏆 ${t.winnerName}` : 'no winner'} ·{' '}
                      {new Date(t.finishedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="panel rules" aria-label="How tournaments work">
        <h2>How it works</h2>
        <h3>Arena</h3>
        <ul className="small">
          <li>Play as many games as you can until time runs out. You’re paired again as soon as your game ends.</li>
          <li>A win is 2 points, a draw 1, a loss 0. After two wins in a row you’re on fire 🔥: wins count 4 and draws 2.</li>
          <li>Draws in under 10 moves score nothing, and so do back-to-back short draws.</li>
          <li>Berserk (if allowed) halves your clock before your first move; a win then earns 1 extra point.</li>
          <li>Games still running when time is up don’t count.</li>
        </ul>
        <h3>Swiss</h3>
        <ul className="small">
          <li>A fixed number of rounds. Each round pairs players with similar scores who haven’t met yet.</li>
          <li>A win is 1 point, a draw ½. An odd player out gets a bye worth 1 point.</li>
          <li>No draw offers before move 30. Ties are broken by Sonneborn–Berger.</li>
          <li>You can join late until more than half the rounds have started.</li>
        </ul>
        <p className="muted small">In both: if you don’t make your first move in time, you lose the game and are paused until you rejoin.</p>
      </section>
    </main>
  );
}

function CreateForm({ client }: { client: OnlineClient }) {
  const [form, setForm] = useState<CreateTour>({
    kind: 'arena',
    name: '',
    tc: '3+2',
    rated: true,
    startInMin: 2,
    durationMin: 30,
    berserk: true,
    nbRounds: 5,
    roundIntervalSec: 30,
  });
  const set = <K extends keyof CreateTour>(k: K, v: CreateTour[K]) => setForm(f => ({ ...f, [k]: v }));
  const select = (key: 'startInMin' | 'durationMin' | 'nbRounds' | 'roundIntervalSec', values: readonly number[], label: (v: number) => string) => (
    <select value={form[key]} onChange={e => set(key, Number(e.target.value))}>
      {values.map(v => (
        <option key={v} value={v}>
          {label(v)}
        </option>
      ))}
    </select>
  );

  return (
    <form
      className="tour-form"
      onSubmit={e => {
        e.preventDefault();
        client.send({ t: 'createTour', tour: form });
      }}
    >
      <fieldset className="color-choice">
        <legend>Type</legend>
        {(['arena', 'swiss'] as const).map(k => (
          <label key={k}>
            <input type="radio" name="tour-kind" checked={form.kind === k} onChange={() => set('kind', k)} />
            <span>{KIND_LABEL[k]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Name (optional)</span>
        <input value={form.name} maxLength={30} placeholder={`${tcLabel(form.tc)} ${KIND_LABEL[form.kind]}`} onChange={e => set('name', e.target.value)} />
      </label>
      <label className="field">
        <span>Time control</span>
        <select value={form.tc} onChange={e => set('tc', e.target.value)}>
          {TIME_CONTROLS.map(tc => (
            <option key={tc.id} value={tc.id}>
              {tc.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Starts in</span>
        {select('startInMin', TOUR_OPTIONS.startInMin, v => `${v} minute${v === 1 ? '' : 's'}`)}
      </label>
      {form.kind === 'arena' ? (
        <>
          <label className="field">
            <span>Duration</span>
            {select('durationMin', TOUR_OPTIONS.durationMin, v => (v < 60 ? `${v} minutes` : `${v / 60} hour${v === 60 ? '' : 's'}`))}
          </label>
          <label className="check">
            <input type="checkbox" checked={form.berserk} onChange={e => set('berserk', e.target.checked)} /> Allow berserk
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>Rounds</span>
            {select('nbRounds', TOUR_OPTIONS.nbRounds, v => `${v} rounds`)}
          </label>
          <label className="field">
            <span>Pause between rounds</span>
            {select('roundIntervalSec', TOUR_OPTIONS.roundIntervalSec, v => (v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}`))}
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={form.rated} onChange={e => set('rated', e.target.checked)} /> Rated
      </label>
      <button type="submit" className="primary">
        Create tournament
      </button>
    </form>
  );
}

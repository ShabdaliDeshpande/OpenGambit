import { useEffect, useState } from 'react';
import { ApiError, CATEGORIES, CATEGORY_LABEL, fetchExplorer, type Category, type ExplorerMove, type ExplorerSource, type MineFilter } from '../../account/api';
import { gamesOf, gamesText, resultShares, totalOf } from '../../explorer/format';
import { positionKey } from '../../explorer/key';

const PREF_KEY = 'chess-app:explorer';

interface Prefs {
  open: boolean;
  tab: ExplorerSource;
  filter: MineFilter;
}

const DEFAULT_PREFS: Prefs = { open: true, tab: 'masters', filter: { color: 'w', speeds: [], since: '', until: '' } };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const f = (raw.filter ?? {}) as Partial<MineFilter>;
    return {
      open: raw.open !== false,
      tab: raw.tab === 'site' || raw.tab === 'mine' ? raw.tab : 'masters',
      filter: {
        color: f.color === 'b' ? 'b' : 'w',
        speeds: Array.isArray(f.speeds) ? f.speeds.filter((s): s is Category => (CATEGORIES as readonly string[]).includes(s)) : [],
        since: typeof f.since === 'string' ? f.since : '',
        until: typeof f.until === 'string' ? f.until : '',
      },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const TAB_LABEL: Record<ExplorerSource, string> = { masters: 'Masters', site: 'OpenGambit', mine: 'My games' };

interface Props {
  fen: string;
  /** The board's game starts from the standard position (the explorer only covers those). */
  standard: boolean;
  signedIn: boolean;
  /** Plays a move from the table (UCI). */
  onPlay: (uci: string) => void;
}

type Result = { moves: ExplorerMove[]; available: boolean } | { error: string };

/** Opening explorer: what was played from this position, in master games, here, or in your own games. */
export function ExplorerPanel({ fen, standard, signedIn, onPlay }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [result, setResult] = useState<Result | null>(null);
  const tab = prefs.tab === 'mine' && !signedIn ? 'masters' : prefs.tab;
  const key = positionKey(fen);
  const filterKey = JSON.stringify(prefs.filter);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      // not remembered
    }
  }, [prefs]);

  useEffect(() => {
    if (!prefs.open || !standard) return;
    let cancelled = false;
    setResult(null);
    // a short pause, so stepping quickly through a game doesn't ask for every position
    const t = setTimeout(() => {
      fetchExplorer(tab, fen, prefs.filter)
        .then(r => !cancelled && setResult({ moves: r.moves, available: r.available }))
        .catch((e: unknown) => !cancelled && setResult({ error: e instanceof ApiError && e.status === 0 ? 'The explorer needs a connection to the server.' : String((e as Error).message) }));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // the key identifies the position; fen is derived from it
  }, [key, tab, filterKey, prefs.open, standard]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Prefs>) => setPrefs(p => ({ ...p, ...patch }));
  const setFilter = (patch: Partial<MineFilter>) => setPrefs(p => ({ ...p, filter: { ...p.filter, ...patch } }));

  const moves = result && 'moves' in result ? result.moves : [];
  const total = totalOf(moves);

  return (
    <section className="panel explorer" aria-label="Opening explorer">
      <div className="explorer-head">
        <h2>Opening explorer</h2>
        <button type="button" className="link-button" onClick={() => set({ open: !prefs.open })} aria-expanded={prefs.open}>
          {prefs.open ? 'Hide' : 'Show'}
        </button>
      </div>
      {prefs.open && !standard && <p className="muted small">The explorer covers games from the standard starting position only.</p>}
      {prefs.open && standard && (
        <>
          <div className="explorer-tabs" role="tablist">
            {(['masters', 'site', 'mine'] as const).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                disabled={t === 'mine' && !signedIn}
                title={t === 'mine' && !signedIn ? 'Sign in to see your own games' : undefined}
                onClick={() => set({ tab: t })}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>

          {tab === 'mine' && (
            <div className="explorer-filter small">
              <label>
                <input type="radio" name="explorer-color" checked={prefs.filter.color === 'w'} onChange={() => setFilter({ color: 'w' })} /> as White
              </label>
              <label>
                <input type="radio" name="explorer-color" checked={prefs.filter.color === 'b'} onChange={() => setFilter({ color: 'b' })} /> as Black
              </label>
              {CATEGORIES.map(c => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={prefs.filter.speeds.length === 0 || prefs.filter.speeds.includes(c)}
                    onChange={e => {
                      const all = prefs.filter.speeds.length === 0 ? [...CATEGORIES] : prefs.filter.speeds;
                      const next = e.target.checked ? [...all, c] : all.filter(s => s !== c);
                      setFilter({ speeds: next.length === CATEGORIES.length ? [] : next });
                    }}
                  />{' '}
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
              <label>
                from <input type="month" value={prefs.filter.since} onChange={e => setFilter({ since: e.target.value })} />
              </label>
              <label>
                to <input type="month" value={prefs.filter.until} onChange={e => setFilter({ until: e.target.value })} />
              </label>
            </div>
          )}

          {!result && <p className="muted small">Loading…</p>}
          {result && 'error' in result && <p className="error small">{result.error}</p>}
          {result && 'moves' in result && moves.length === 0 && (
            <p className="muted small">
              {tab === 'masters' && !result.available
                ? 'No master games have been imported yet. Whoever runs this server can add them with npm run explorer:import (see the README).'
                : tab === 'mine'
                  ? 'None of your games reached this position (with these filters).'
                  : 'No games from this position yet.'}
            </p>
          )}
          {moves.length > 0 && (
            <table className="explorer-table">
              <thead>
                <tr>
                  <th scope="col">Move</th>
                  <th scope="col">Games</th>
                  <th scope="col">White / draw / Black</th>
                  {tab !== 'mine' && <th scope="col">Avg rating</th>}
                </tr>
              </thead>
              <tbody>
                {moves.map(m => {
                  const share = resultShares(m);
                  return (
                    <tr key={m.uci} className="explorer-row">
                      <td>
                        <button type="button" className="link-button" onClick={() => onPlay(m.uci)}>
                          {m.san}
                        </button>
                      </td>
                      <td title={gamesText(gamesOf(m))}>{gamesOf(m).toLocaleString('en')}</td>
                      <td>
                        <ResultBar shares={share} />
                      </td>
                      {tab !== 'mine' && <td>{m.averageRating ?? '–'}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All</th>
                  <td>{gamesOf(total).toLocaleString('en')}</td>
                  <td>
                    <ResultBar shares={resultShares(total)} />
                  </td>
                  {tab !== 'mine' && <td />}
                </tr>
              </tfoot>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function ResultBar({ shares }: { shares: { white: number; draws: number; black: number } }) {
  return (
    <div className="result-bar" aria-label={`White ${shares.white}%, draws ${shares.draws}%, Black ${shares.black}%`}>
      {(['white', 'draws', 'black'] as const).map(k =>
        shares[k] > 0 ? (
          <span key={k} className={k} style={{ width: `${shares[k]}%` }}>
            {shares[k] >= 12 ? `${shares[k]}%` : ''}
          </span>
        ) : null,
      )}
    </div>
  );
}

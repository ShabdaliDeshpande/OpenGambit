import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import { writePgn } from '../../analysis/pgn';
import { treeFromMoves } from '../../analysis/tree';
import { BUILTIN_PUZZLES } from '../../puzzles/builtin';
import {
  DIFFICULTY_RANGE,
  EMPTY_STATS,
  matches,
  pickPuzzle,
  recordResult,
  RELATIVE_DIFFICULTY,
  themeCounts,
  themeLabel,
  type Difficulty,
  type PuzzleFilter,
  type PuzzleStats,
} from '../../puzzles/picker';
import { sessionReducer, startSession } from '../../puzzles/session';
import type { Puzzle } from '../../puzzles/types';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { diffText, fetchDailyPuzzle, ratingText, submitPuzzleAttempt, type Me, type PuzzleResult } from '../../account/api';
import { PuzzleDashboard } from './PuzzleDashboard';

const STATS_KEY = 'chess-app:puzzle-stats';
const IMPORTED_URL = '/puzzles/imported.json';

function loadStats(): PuzzleStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? { ...EMPTY_STATS, ...(JSON.parse(raw) as PuzzleStats) } : EMPTY_STATS;
  } catch {
    return EMPTY_STATS;
  }
}

function saveStats(stats: PuzzleStats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable: stats last for this visit only
  }
}

/** A built-in puzzle named by a `?puzzle=<id>` link, if any. */
export function linkedPuzzle(): Puzzle | null {
  const id = new URLSearchParams(window.location.search).get('puzzle');
  return (id && BUILTIN_PUZZLES.find(p => p.id === id)) || null;
}

type Source = 'all' | 'builtin' | 'imported';

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  any: 'Any difficulty',
  easy: `Easy (< ${DIFFICULTY_RANGE.medium[0]})`,
  medium: `Medium (${DIFFICULTY_RANGE.medium[0]}–${DIFFICULTY_RANGE.medium[1]})`,
  hard: `Hard (${DIFFICULTY_RANGE.hard[0]}+)`,
};

const colorName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');

interface Props {
  active: boolean;
  onAnalyse: (pgn: string) => void;
  /** The signed-in player, for the puzzle rating; null for guests. */
  me: Me | null;
  /** Called after a rated attempt so the account (and its puzzle rating) can refresh. */
  onRated: () => void;
  onSignIn: () => void;
}

export function PuzzleView({ active, onAnalyse, me, onRated, onSignIn }: Props) {
  const [view, setView] = useState<'train' | 'dashboard'>('train');
  // signed in: difficulty is an offset from your puzzle rating
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ attempt: number; value: PuzzleResult | null; error: string | null } | null>(null);
  const [dashVersion, setDashVersion] = useState(0);
  const [daily, setDaily] = useState<{ id: string; solved: boolean } | null>(null);
  const reported = useRef<number | null>(null);
  const [imported, setImported] = useState<Puzzle[]>([]);
  const [source, setSource] = useState<Source>('all');
  const [filter, setFilter] = useState<PuzzleFilter>({ theme: '', difficulty: 'any' });
  const [stats, setStats] = useState<PuzzleStats>(loadStats);
  const [session, dispatch] = useReducer(sessionReducer, undefined, () =>
    startSession(
      linkedPuzzle() ?? pickPuzzle(BUILTIN_PUZZLES, { theme: '', difficulty: 'any' }, loadStats(), null) ?? BUILTIN_PUZZLES[0]!,
    ),
  );
  const recorded = useRef<number | null>(null);

  // optional imported set (see README: npm run puzzles:import)
  useEffect(() => {
    let cancelled = false;
    fetch(IMPORTED_URL)
      .then(r => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return;
        const list = (data as Puzzle[]).filter(p => p && typeof p.fen === 'string' && Array.isArray(p.solution));
        setImported(list.map(p => ({ ...p, source: 'imported' as const })));
      })
      .catch(() => {
        // no imported set (or not valid JSON): built-in puzzles only
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = useMemo(
    () => (source === 'builtin' ? BUILTIN_PUZZLES : source === 'imported' ? imported : [...BUILTIN_PUZZLES, ...imported]),
    [source, imported],
  );
  const themes = useMemo(() => themeCounts(all), [all]);
  const myRating = me?.puzzleRating.rating ?? null;
  // the filter actually used for picking: near your rating when signed in
  const pickFilter = useMemo<PuzzleFilter>(
    () => (myRating !== null ? { theme: filter.theme, difficulty: 'any', target: myRating + offset } : filter),
    [filter, myRating, offset],
  );
  const available = useMemo(() => all.filter(p => matches(p, pickFilter)).length, [all, pickFilter]);

  const next = useCallback(
    (f: PuzzleFilter = pickFilter, pool: Puzzle[] = all) => {
      const p = pickPuzzle(pool, f, stats, session.puzzle.id);
      if (p) dispatch({ type: 'start', puzzle: p });
    },
    [pickFilter, all, stats, session.puzzle.id],
  );

  const startById = useCallback(
    (id: string) => {
      const p = [...BUILTIN_PUZZLES, ...imported].find(x => x.id === id);
      if (p) dispatch({ type: 'start', puzzle: p });
      setView('train');
    },
    [imported],
  );

  useEffect(() => {
    fetchDailyPuzzle()
      .then(d => setDaily({ id: d.id, solved: d.solved }))
      .catch(() => undefined);
  }, [me?.id]);

  // signed in: report each attempt once — a miss as soon as it happens, a solve with its moves
  useEffect(() => {
    if (!me || reported.current === session.attempt) return;
    const missed = session.failed;
    const solved = session.phase === 'solved' && !session.failed;
    if (!missed && !solved) return;
    reported.current = session.attempt;
    const attempt = session.attempt;
    submitPuzzleAttempt(session.puzzle.id, solved, solved ? session.played : [], filter.theme)
      .then(value => {
        setResult({ attempt, value, error: null });
        setDashVersion(v => v + 1);
        if (solved && daily?.id === session.puzzle.id) setDaily(d => (d ? { ...d, solved: true } : d));
        onRated();
      })
      .catch((e: Error) => setResult({ attempt, value: null, error: e.message }));
  }, [me, session.attempt, session.failed, session.phase, session.puzzle.id, session.played, daily?.id, onRated, filter.theme]);
  const shownResult = result && result.attempt === session.attempt ? result : null;

  // play the setup move, opponent replies and revealed moves with a short delay
  useEffect(() => {
    const delay = { setup: 600, opponent: 450, revealing: 700 }[session.phase as 'setup' | 'opponent' | 'revealing'];
    if (delay === undefined) return;
    const action = session.phase === 'setup' ? 'setupMove' : session.phase === 'opponent' ? 'opponentMove' : 'revealStep';
    const id = setTimeout(() => dispatch({ type: action }), delay);
    return () => clearTimeout(id);
  }, [session.phase, session.step]);

  // record each attempt once, when it ends
  useEffect(() => {
    if (session.phase !== 'solved' || recorded.current === session.attempt) return;
    recorded.current = session.attempt;
    setStats(s => {
      const updated = recordResult(s, session.puzzle.id, !session.failed);
      saveStats(updated);
      return updated;
    });
  }, [session.phase, session.failed, session.puzzle.id, session.attempt]);

  useKeyboardNav(
    {
      prev: () => session.phase === 'wrong' && dispatch({ type: 'takeBack' }),
      next: () => session.phase === 'solved' && next(),
      first: () => undefined,
      last: () => undefined,
      flip: () => undefined,
    },
    active,
  );

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) =>
      dispatch({ type: 'move', move: { from, to, ...(promotion ? { promotion } : {}) } }),
    [],
  );

  const changeFilter = (f: PuzzleFilter) => {
    setFilter(f);
    next(myRating !== null ? { ...f, difficulty: 'any', target: myRating + offset } : f);
  };

  const changeSource = (s: Source) => {
    setSource(s);
    const pool = s === 'builtin' ? BUILTIN_PUZZLES : s === 'imported' ? imported : [...BUILTIN_PUZZLES, ...imported];
    const f = { theme: '', difficulty: filter.difficulty };
    setFilter(f);
    next(myRating !== null ? { ...f, difficulty: 'any', target: myRating + offset } : f, pool);
  };

  const changeOffset = (o: number) => {
    setOffset(o);
    if (myRating !== null) next({ theme: filter.theme, difficulty: 'any', target: myRating + o });
  };

  const analyse = () => {
    const chess = new Chess(session.puzzle.fen);
    if (session.puzzle.setup) chess.move(session.puzzle.setup);
    const tree = treeFromMoves(chess.fen(), session.puzzle.solution, { Event: 'Puzzle', Result: '*' });
    onAnalyse(writePgn(tree));
  };

  const { phase, solver, puzzle } = session;
  const solverName = colorName(solver);
  const status =
    phase === 'setup'
      ? 'Watch the opponent’s move…'
      : phase === 'playing'
        ? session.step === 0
          ? `Your turn: find the best move for ${solverName}.`
          : 'Correct. Keep going…'
        : phase === 'opponent'
          ? 'Correct!'
          : phase === 'wrong'
            ? 'That’s not the move. Take it back and try again.'
            : phase === 'revealing'
              ? 'Showing the solution…'
              : session.failed
                ? 'Puzzle complete (with help).'
                : 'Solved!';

  const viewSwitch = (
    <div className="segmented puzzle-views" role="radiogroup" aria-label="Puzzle screen">
      <button type="button" role="radio" aria-checked={view === 'train'} className={view === 'train' ? 'on' : ''} onClick={() => setView('train')}>
        🧩 Train
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={view === 'dashboard'}
        className={view === 'dashboard' ? 'on' : ''}
        onClick={() => (me ? setView('dashboard') : onSignIn())}
        title={me ? 'Your puzzle statistics' : 'Sign in to see your puzzle dashboard'}
      >
        📈 Dashboard
      </button>
    </div>
  );

  if (view === 'dashboard' && me)
    return (
      <main className="puzzle-dash-page">
        <section className="panel">
          {viewSwitch}
          <PuzzleDashboard version={dashVersion} onReplay={startById} />
        </section>
      </main>
    );

  return (
    <main className="layout puzzles">
      <div className="board-wrap">
        <Board
          fen={session.fen}
          orientation={solver}
          movableColor={phase === 'playing' ? solver : null}
          lastMove={session.lastMove}
          onMove={onMove}
          marks={session.hint ? [session.hint] : []}
        />
      </div>

      <aside className="side">
        {viewSwitch}
        <section className={`panel puzzle-status ${phase}`} aria-live="polite">
          <p className="puzzle-message">{status}</p>
          <div className="row">
            {phase === 'wrong' && (
              <button type="button" className="primary" onClick={() => dispatch({ type: 'takeBack' })}>
                ↶ Take back
              </button>
            )}
            {(phase === 'playing' || phase === 'wrong') && (
              <>
                <button type="button" onClick={() => dispatch({ type: 'hint' })} disabled={phase !== 'playing' || !!session.hint}>
                  💡 Hint
                </button>
                <button type="button" onClick={() => dispatch({ type: 'reveal' })}>
                  Show solution
                </button>
              </>
            )}
            {phase === 'solved' && (
              <>
                <button type="button" className="primary" onClick={() => next()} disabled={available === 0}>
                  Next puzzle →
                </button>
                <button type="button" onClick={() => dispatch({ type: 'retry' })}>
                  Retry
                </button>
                <button type="button" onClick={analyse}>
                  🔍 Analyse
                </button>
              </>
            )}
          </div>
          <dl className="puzzle-meta">
            <div>
              <dt>Rating</dt>
              <dd>{puzzle.rating}</dd>
            </div>
            <div>
              <dt>Themes</dt>
              <dd>{phase === 'solved' ? puzzle.themes.map(themeLabel).join(', ') || '–' : 'shown when solved'}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{puzzle.source === 'builtin' ? 'Built-in' : 'Imported'}</dd>
            </div>
          </dl>
          {me && shownResult && (
            <p className="puzzle-rating-change" role="status">
              {shownResult.error
                ? shownResult.error
                : shownResult.value && !shownResult.value.first
                  ? 'Practice: you’d tried this puzzle before, so it isn’t rated.'
                  : shownResult.value && (
                      <>
                        Puzzle rating {ratingText(shownResult.value.rating)}{' '}
                        <strong className={`diff ${(shownResult.value.diff ?? 0) >= 0 ? 'up' : 'down'}`}>{diffText(shownResult.value.diff)}</strong>
                      </>
                    )}
            </p>
          )}
        </section>

        <section className="panel" aria-label="Your progress">
          <h2>Progress</h2>
          {me ? (
            <p className="puzzle-rating">
              <span className="stat-value">{ratingText(me.puzzleRating)}</span>
              <span className="muted small"> puzzle rating · ±{me.puzzleRating.deviation}</span>
            </p>
          ) : (
            <p className="muted small">
              <button type="button" className="link-button" onClick={onSignIn}>
                Sign in
              </button>{' '}
              for a puzzle rating and a training dashboard. Progress below is kept in this browser.
            </p>
          )}
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{stats.solved.length}</span>
              <span className="stat-label">solved</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.streak}</span>
              <span className="stat-label">streak</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.bestStreak}</span>
              <span className="stat-label">best streak</span>
            </div>
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setStats(EMPTY_STATS);
              saveStats(EMPTY_STATS);
            }}
          >
            Reset progress
          </button>
        </section>

        <section className="panel" aria-label="Choose puzzles">
          <h2>Choose puzzles</h2>
          {imported.length > 0 && (
            <label className="field">
              <span>Source</span>
              <select value={source} onChange={e => changeSource(e.target.value as Source)}>
                <option value="all">All ({BUILTIN_PUZZLES.length + imported.length})</option>
                <option value="builtin">Built-in ({BUILTIN_PUZZLES.length})</option>
                <option value="imported">Imported ({imported.length})</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>Theme</span>
            <select value={filter.theme} onChange={e => changeFilter({ ...filter, theme: e.target.value })}>
              <option value="">Any theme</option>
              {themes.map(([t, n]) => (
                <option key={t} value={t}>
                  {themeLabel(t)} ({n})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Difficulty</span>
            {myRating !== null ? (
              <select value={offset} onChange={e => changeOffset(Number(e.target.value))}>
                {RELATIVE_DIFFICULTY.map(d => (
                  <option key={d.offset} value={d.offset}>
                    {d.label} ({d.offset > 0 ? '+' : ''}
                    {d.offset === 0 ? 'your rating' : d.offset})
                  </option>
                ))}
              </select>
            ) : (
              <select value={filter.difficulty} onChange={e => changeFilter({ ...filter, difficulty: e.target.value as Difficulty })}>
                {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map(d => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABEL[d]}
                  </option>
                ))}
              </select>
            )}
          </label>
          {daily && (
            <button type="button" className="daily-button" onClick={() => startById(daily.id)} disabled={session.puzzle.id === daily.id}>
              📅 Daily puzzle{daily.solved ? ' ✓' : ''}
            </button>
          )}
          <p className="muted">
            {available === 0
              ? 'No puzzles match these filters.'
              : myRating !== null
                ? `Picking puzzles near ${myRating + offset} from ${available}.`
                : `${available} puzzle${available === 1 ? '' : 's'} match.`}
            {imported.length === 0 && ' Add more by importing a puzzle CSV (see README).'}
          </p>
        </section>
      </aside>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_POSITION } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import type { Me } from '../../account/api';
import { usePuzzleRound } from '../../hooks/usePuzzleRound';
import { useRunBests } from '../../hooks/useRunBests';
import { countdown } from '../../online/view';
import {
  comboBonus,
  newStorm,
  runSequence,
  STORM,
  stormBadMove,
  stormEnd,
  stormGoodMove,
  stormSolved,
  stormTick,
  stormTimeLeft,
  type StormState,
} from '../../puzzles/runs';
import type { Puzzle } from '../../puzzles/types';
import { playSound } from '../../sound/sounds';

interface Props {
  puzzles: readonly Puzzle[];
  me: Me | null;
  onSignIn: () => void;
}

/** The next combo level and how far along it you are, for the combo bar. */
function comboProgress(combo: number): { next: number; pct: number } {
  const levels = STORM.levels.map(([at]) => at as number);
  let prev = 0;
  for (const at of levels) {
    if (combo < at) return { next: at, pct: ((combo - prev) / (at - prev)) * 100 };
    prev = at;
  }
  const last = levels.at(-1)!;
  const step = (combo - last) % 10;
  return { next: combo - step + 10, pct: (step / 10) * 100 };
}

/** Puzzle Storm: solve as many as you can in 3 minutes; combos add time, mistakes cost 10 seconds. */
export function StormView({ puzzles, me, onSignIn }: Props) {
  const [sequence, setSequence] = useState(() => runSequence(puzzles));
  const [index, setIndex] = useState(0);
  const [storm, setStorm] = useState<StormState | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [result, setResult] = useState<{ newBest: boolean; error: string | null } | null>(null);
  const { bests, record } = useRunBests(me);
  const round = usePuzzleRound(sequence[0]!, { setup: 250, opponent: 150 });
  const { session } = round;
  const saved = useRef(false);

  const begin = () => {
    const seq = runSequence(puzzles);
    setSequence(seq);
    setIndex(0);
    setStorm(newStorm());
    setResult(null);
    saved.current = false;
    round.start(seq[0]!);
  };

  const nextPuzzle = useCallback(
    (from: number) => {
      const next = sequence[from + 1];
      if (!next) {
        setStorm(s => (s ? stormEnd(s) : s));
        return;
      }
      setIndex(from + 1);
      round.start(next);
    },
    [sequence, round],
  );

  // the clock
  const running = !!storm && !storm.over && storm.deadline !== null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      setStorm(s => (s ? stormTick(s, t) : s));
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  // a solved puzzle scores and the next one comes straight away
  useEffect(() => {
    if (!storm || storm.over || session.phase !== 'solved') return;
    setStorm(s => (s ? stormSolved(s) : s));
    nextPuzzle(index);
  }, [session.phase, session.attempt]);

  // save the run once it's over
  useEffect(() => {
    if (!storm?.over || saved.current) return;
    saved.current = true;
    playSound('end');
    record('storm', storm.score)
      .then(newBest => setResult({ newBest, error: null }))
      .catch((e: Error) => setResult({ newBest: false, error: e.message }));
  }, [storm?.over, storm?.score, record]);

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) => {
      if (!storm || storm.over) return;
      const t = performance.now();
      const verdict = round.play(session, from, to, promotion);
      if (verdict === 'good') {
        const combo = storm.combo + 1;
        if (comboBonus(combo)) playSound('start');
        setStorm(s => (s ? stormGoodMove(s, t) : s));
      } else if (verdict === 'wrong') {
        playSound('error');
        setStorm(s => (s ? stormBadMove(s, t) : s));
        // a mistake skips to the next puzzle
        setTimeout(() => nextPuzzle(index), 350);
      }
      setNow(t);
    },
    [storm, session, round, nextPuzzle, index],
  );

  const left = storm ? stormTimeLeft(storm, now) : STORM.initialMs;
  const flash = storm?.lastChange && now - storm.lastChange.at < 1200 ? storm.lastChange : null;
  const progress = comboProgress(storm?.combo ?? 0);
  const accuracy = storm && storm.moves ? Math.round((100 * (storm.moves - storm.errors)) / storm.moves) : 100;

  return (
    <main className="layout puzzles run-view">
      <div className="board-wrap">
        {/* until the run starts, show the opening position rather than giving away the first puzzle */}
        <Board
          fen={storm ? session.fen : DEFAULT_POSITION}
          orientation={storm ? session.solver : 'w'}
          movableColor={storm && !storm.over && session.phase === 'playing' ? session.solver : null}
          lastMove={storm ? session.lastMove : null}
          onMove={onMove}
        />
      </div>
      <aside className="side">
        <section className={`panel run-panel storm ${storm?.over ? 'over' : ''}`} aria-live="polite">
          <h2>⚡ Puzzle Storm</h2>
          {!storm ? (
            <>
              <p>Solve as many puzzles as you can in 3 minutes. The clock starts with your first move.</p>
              <ul className="small">
                <li>Combos add time: +3 s at 5 correct moves in a row, +5 s at 12, +7 s at 20, +10 s at 30 and every 10 after.</li>
                <li>A wrong move costs 10 seconds, breaks the combo and skips to the next puzzle.</li>
                <li>Puzzles get harder as you go.</li>
              </ul>
              <button type="button" className="primary" onClick={begin}>
                Start the storm
              </button>
            </>
          ) : storm.over ? (
            <>
              <div className="run-score">
                <span className="stat-value">{storm.score}</span>
                <span className="stat-label">puzzles solved</span>
              </div>
              <dl className="puzzle-meta">
                <div>
                  <dt>Moves</dt>
                  <dd>{storm.moves}</dd>
                </div>
                <div>
                  <dt>Accuracy</dt>
                  <dd>{accuracy}%</dd>
                </div>
                <div>
                  <dt>Best combo</dt>
                  <dd>{storm.bestCombo}</dd>
                </div>
                <div>
                  <dt>Mistakes</dt>
                  <dd>{storm.errors}</dd>
                </div>
              </dl>
              {result && (
                <p className={result.error ? 'error' : 'success'} role="status">
                  {result.error ?? (result.newBest ? `New personal best: ${storm.score}!` : `Your best: ${bests.storm.best}`)}
                </p>
              )}
              <button type="button" className="primary" onClick={begin}>
                Play again
              </button>
            </>
          ) : (
            <>
              <div className="storm-clock-row">
                <span className={`storm-clock${left < 20_000 ? ' low' : ''}`} role="timer">
                  {countdown(left)}
                </span>
                {flash && <span className={`storm-flash ${flash.seconds > 0 ? 'up' : 'down'}`}>{flash.seconds > 0 ? `+${flash.seconds}s` : `${flash.seconds}s`}</span>}
              </div>
              <div className="run-score">
                <span className="stat-value">{storm.score}</span>
                <span className="stat-label">solved</span>
              </div>
              <div className="combo" aria-label={`Combo ${storm.combo}, next bonus at ${progress.next}`}>
                <span>Combo {storm.combo}</span>
                <div className="combo-bar">
                  <div style={{ width: `${progress.pct}%` }} />
                </div>
                <span className="muted small">next bonus at {progress.next}</span>
              </div>
              <p className="muted small">
                {storm.deadline === null ? 'Make your first move to start the clock.' : `Puzzle ${index + 1} · rated ${session.puzzle.rating}`}
              </p>
              <button type="button" onClick={() => setStorm(s => (s ? stormEnd(s) : s))}>
                End run
              </button>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Your bests</h2>
          <p>
            Best storm <strong>{bests.storm.best}</strong> · today <strong>{bests.storm.today}</strong>
          </p>
          {!me && (
            <p className="muted small">
              Kept in this browser.{' '}
              <button type="button" className="link-button" onClick={onSignIn}>
                Sign in
              </button>{' '}
              to keep them with your account.
            </p>
          )}
        </section>
      </aside>
    </main>
  );
}

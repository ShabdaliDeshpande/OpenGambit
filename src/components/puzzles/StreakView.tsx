import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_POSITION } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import type { Me } from '../../account/api';
import { usePuzzleRound } from '../../hooks/usePuzzleRound';
import { useRunBests } from '../../hooks/useRunBests';
import { newStreak, runSequence, type StreakState } from '../../puzzles/runs';
import type { Puzzle } from '../../puzzles/types';
import { playSound } from '../../sound/sounds';

interface Props {
  puzzles: readonly Puzzle[];
  me: Me | null;
  onSignIn: () => void;
}

/** Puzzle Streak: harder and harder puzzles, no clock, one wrong move ends the run. */
export function StreakView({ puzzles, me, onSignIn }: Props) {
  const [sequence, setSequence] = useState(() => runSequence(puzzles));
  const [run, setRun] = useState<StreakState | null>(null);
  const [result, setResult] = useState<{ newBest: boolean; error: string | null } | null>(null);
  const { bests, record } = useRunBests(me);
  const round = usePuzzleRound(sequence[0]!, { setup: 600, opponent: 450 });
  const { session } = round;
  const saved = useRef(false);

  const begin = () => {
    const seq = runSequence(puzzles);
    setSequence(seq);
    setRun(newStreak());
    setResult(null);
    saved.current = false;
    round.start(seq[0]!);
    playSound('start');
  };

  // a solved puzzle moves on to the next one; the run ends after the last
  useEffect(() => {
    if (!run || run.over || session.phase !== 'solved') return;
    const score = run.score + 1;
    const index = run.index + 1;
    const next = sequence[index];
    if (!next) return setRun({ ...run, score, index, over: true });
    setRun({ ...run, score, index });
    const id = setTimeout(() => round.start(next), 500);
    return () => clearTimeout(id);
  }, [session.phase, session.attempt]);

  // save the run once it's over
  useEffect(() => {
    if (!run?.over || saved.current) return;
    saved.current = true;
    playSound('end');
    record('streak', run.score)
      .then(newBest => setResult({ newBest, error: null }))
      .catch((e: Error) => setResult({ newBest: false, error: e.message }));
  }, [run?.over, run?.score, record]);

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) => {
      if (!run || run.over) return;
      if (round.play(session, from, to, promotion) === 'wrong') setRun(r => (r ? { ...r, over: true } : r));
    },
    [run, session, round],
  );

  const skip = () => {
    const move = session.puzzle.solution[session.step];
    if (!run || !run.skipAvailable || session.phase !== 'playing' || !move) return;
    setRun({ ...run, skipAvailable: false });
    round.play(session, move.from, move.to, move.promotion);
  };

  const current = run && !run.over ? run.index + 1 : null;
  const solverName = session.solver === 'w' ? 'White' : 'Black';
  const status = useMemo(() => {
    if (!run) return 'Puzzles get harder as you go. No clock, but one wrong move ends your streak.';
    if (run.over) return session.phase === 'wrong' ? 'Wrong move: your streak is over.' : 'You solved every puzzle in the set!';
    if (session.phase === 'solved') return 'Correct! Next puzzle…';
    if (session.phase === 'opponent' || session.phase === 'setup') return 'Good move…';
    return `Find the best move for ${solverName}.`;
  }, [run, session.phase, solverName]);

  return (
    <main className="layout puzzles run-view">
      <div className="board-wrap">
        {/* until the run starts, show the opening position rather than giving away the first puzzle */}
        <Board
          fen={run ? session.fen : DEFAULT_POSITION}
          orientation={run ? session.solver : 'w'}
          movableColor={run && !run.over && session.phase === 'playing' ? session.solver : null}
          lastMove={run ? session.lastMove : null}
          onMove={onMove}
        />
      </div>
      <aside className="side">
        <section className={`panel run-panel ${run?.over ? 'over' : ''}`} aria-live="polite">
          <h2>🔥 Puzzle Streak</h2>
          <div className="run-score">
            <span className="stat-value">{run?.score ?? 0}</span>
            <span className="stat-label">{run ? 'solved in a row' : 'your streak'}</span>
          </div>
          <p className="puzzle-message">{status}</p>
          {current && <p className="muted small">Puzzle {current} · rated {session.puzzle.rating}</p>}
          {run && !run.over && (
            <button type="button" onClick={skip} disabled={!run.skipAvailable || session.phase !== 'playing'} title="Play the right move for you, once per run">
              ⏭ Skip this move{run.skipAvailable ? ' (once)' : ' (used)'}
            </button>
          )}
          {(!run || run.over) && (
            <button type="button" className="primary" onClick={begin}>
              {run ? 'New streak' : 'Start a streak'}
            </button>
          )}
          {run?.over && result && (
            <p className={result.error ? 'error' : 'success'} role="status">
              {result.error ?? (result.newBest ? `New personal best: ${run.score}!` : `Best streak: ${bests.streak.best}`)}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Your bests</h2>
          <p>
            Best streak <strong>{bests.streak.best}</strong> · today <strong>{bests.streak.today}</strong>
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

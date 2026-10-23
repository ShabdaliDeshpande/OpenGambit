import { useEffect, useReducer } from 'react';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import { levelReducer, startLevel, starsFor, type LessonLevel } from '../../learn/level';
import type { LessonStage } from '../../learn/lessons';

interface Props {
  stage: LessonStage;
  level: LessonLevel;
  /** Stars already won on this level, if any. */
  best: number | null;
  onDone: (stars: number) => void;
  onNext: (() => void) | null;
  onBack: () => void;
}

const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** One lesson level: the board, the task, and stars when it's done. */
export function LessonPlayer({ stage, level, best, onDone, onNext, onBack }: Props) {
  const [s, dispatch] = useReducer(levelReducer, level, startLevel);

  // the other side's move in a line comes after a short pause
  useEffect(() => {
    if (s.status !== 'reply') return;
    const t = setTimeout(() => dispatch({ type: 'reply' }), 700);
    return () => clearTimeout(t);
  }, [s.status, s.lineIndex]);

  useEffect(() => {
    if (s.status === 'done') onDone(starsFor(s));
    // report once, when the level is finished
  }, [s.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (from: Square, to: Square, promotion?: PieceSymbol) => dispatch({ type: 'move', uci: from + to + (promotion ?? '') });
  const goal = level.goal;
  const starsLeft = goal.kind === 'collect' ? goal.stars.filter(q => !s.collected.includes(q)) : [];
  const won = s.status === 'done' ? starsFor(s) : null;

  return (
    <main className="layout learn">
      <div className="board-wrap">
        <Board fen={s.fen} orientation={s.learner} movableColor={s.status === 'playing' ? s.learner : null} lastMove={s.lastMove} onMove={onMove} stars={starsLeft} />
      </div>
      <aside className="side">
        <section className="panel">
          <button type="button" className="link-button" onClick={onBack}>
            ← {stage.title}
          </button>
          <h2>
            {stage.icon} {level.title}
          </h2>
          <p className="lesson-task">{level.task}</p>
          {goal.kind === 'collect' && s.status !== 'done' && (
            <p className="muted small">
              {starsLeft.length} star{starsLeft.length === 1 ? '' : 's'} left · {s.moves} move{s.moves === 1 ? '' : 's'} (three stars in {level.par})
            </p>
          )}
          {s.status === 'reply' && <p className="muted">The other side moves…</p>}
          {s.status === 'wrong' && (
            <div className="lesson-wrong" role="alert">
              <p>{s.message}</p>
              <button type="button" className="primary" onClick={() => dispatch({ type: 'retry' })}>
                ↶ Try again
              </button>
            </div>
          )}
          {won !== null && (
            <div className="lesson-done" role="status">
              <p className="lesson-stars" aria-label={`${won} of 3 stars`}>
                {starText(won)}
              </p>
              <p>{won === 3 ? 'Perfect!' : won === 2 ? 'Well done!' : 'Done! Try again for more stars.'}</p>
              <div className="row">
                {onNext && (
                  <button type="button" className="primary" onClick={onNext}>
                    Next →
                  </button>
                )}
                <button type="button" onClick={() => dispatch({ type: 'restart' })}>
                  Play again
                </button>
              </div>
            </div>
          )}
          {s.status === 'playing' && (
            <details className="small">
              <summary>Hint</summary>
              <p>{level.hint}</p>
            </details>
          )}
          {best !== null && won === null && <p className="muted small">Your best: {starText(best)}</p>}
        </section>
      </aside>
    </main>
  );
}

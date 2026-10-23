import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import { currentPosition, drillMove, drillTime, PENALTY_MS, startDrill, timeText, type Drill, type DrillRun } from '../../learn/drills';

interface Props {
  drill: Drill;
  /** Best time so far (ms), if any. */
  best: number | null;
  onFinish: (ms: number) => void;
  onBack: () => void;
}

/** A timed drill: one move per position, as fast as you can. */
export function DrillPlayer({ drill, best, onFinish, onBack }: Props) {
  const [run, setRun] = useState<DrillRun | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!run || run.finishedAt !== null) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [run]);

  const pos = run ? currentPosition(run) : null;
  const done = run?.finishedAt !== null && run !== null;
  const solver = pos ? new Chess(pos.fen).turn() : 'w';
  const lastFen = run && run.index > 0 ? drill.positions[run.order[run.index - 1]!]!.fen : null;

  const onMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    if (!run) return;
    const next = drillMove(run, from + to + (promotion ?? ''), performance.now());
    setRun(next);
    if (next.finishedAt !== null) onFinish(drillTime(next, next.finishedAt));
  };

  const answerSan = (fen: string | null, a: { from: string; to: string; promotion?: string } | undefined) => {
    if (!fen || !a) return '';
    try {
      return new Chess(fen).move(a).san;
    } catch {
      return '';
    }
  };

  return (
    <main className="layout learn">
      <div className="board-wrap">
        <Board fen={pos?.fen ?? lastFen ?? drill.positions[0]?.fen ?? new Chess().fen()} orientation={solver} movableColor={pos ? solver : null} lastMove={null} onMove={onMove} />
      </div>
      <aside className="side">
        <section className="panel">
          <button type="button" className="link-button" onClick={onBack}>
            ← Drills
          </button>
          <h2>⏱ {drill.title}</h2>
          <p>{drill.description}</p>
          <p className="muted small">
            {run ? Math.min(run.order.length, run.index + 1) : 0} of {Math.min(drill.size, drill.positions.length)} · a wrong move adds {PENALTY_MS / 1000} s
          </p>
          {!run && (
            <button type="button" className="primary" onClick={() => setRun(startDrill(drill, performance.now()))}>
              Start
            </button>
          )}
          {run && <p className="drill-clock" aria-live="off">{timeText(drillTime(run, now))}</p>}
          {run?.last && !done && (
            <p className={run.last.ok ? 'drill-ok' : 'drill-wrong'} role="status">
              {run.last.ok ? 'Correct!' : `Not that one: the move was ${answerSan(lastFen, run.last.answer)}.`}
            </p>
          )}
          {done && run && (
            <div className="lesson-done" role="status">
              <p>
                Finished in <strong>{timeText(drillTime(run, run.finishedAt!))}</strong>: {run.correct} right, {run.wrong} wrong.
              </p>
              {best !== null && <p className="muted small">Your best: {timeText(Math.min(best, drillTime(run, run.finishedAt!)))}</p>}
              <button type="button" className="primary" onClick={() => setRun(startDrill(drill, performance.now()))}>
                Go again
              </button>
            </div>
          )}
          {!run && best !== null && <p className="muted small">Your best: {timeText(best)}</p>}
        </section>
      </aside>
    </main>
  );
}

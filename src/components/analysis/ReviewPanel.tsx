import type { Color } from 'chess.js';
import { KIND_LABEL, KIND_MARK, KINDS, type Kind, type SideSummary } from '../../analysis/review';

export interface CurrentVerdict {
  san: string;
  kind: Kind;
  /** Evaluations before and after, as shown ("+0.4"). */
  before: string;
  after: string;
  /** The engine's move, in SAN, when it differs from the one played. */
  bestSan: string | null;
}

interface Props {
  moves: number;
  progress: { done: number; total: number } | null;
  reviewed: boolean;
  summary: Record<Color, SideSummary> | null;
  names: Record<Color, string>;
  current: CurrentVerdict | null;
  onStart: () => void;
  onStop: () => void;
  onJump: (color: Color, dir: 1 | -1) => void;
  onShowBest: () => void;
}

/** "Review game": runs the engine over the game and judges every move, best to blunder. */
export function ReviewPanel({ moves, progress, reviewed, summary, names, current, onStart, onStop, onJump, onShowBest }: Props) {
  return (
    <section className="panel review" aria-label="Game review">
      <h2>Game review</h2>
      {progress ? (
        <>
          <p className="muted small">
            Analysing position {progress.done + 1} of {progress.total}…
          </p>
          <div className="review-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <button type="button" onClick={onStop}>
            Stop
          </button>
        </>
      ) : (
        <button type="button" className="primary" onClick={onStart} disabled={moves < 2}>
          📊 {reviewed ? 'Review again' : 'Review game'}
        </button>
      )}
      {moves < 2 && !reviewed && <p className="muted small">Load or play a game first: the review judges every move of the main line.</p>}

      {summary && (
        <table className="review-table">
          <thead>
            <tr>
              <th scope="col" />
              {(['w', 'b'] as const).map(c => (
                <th key={c} scope="col">
                  {c === 'w' ? '○' : '●'} {names[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="accuracy">
              <th scope="row">Accuracy</th>
              {(['w', 'b'] as const).map(c => (
                <td key={c}>{summary[c].accuracy === null ? '–' : `${summary[c].accuracy}%`}</td>
              ))}
            </tr>
            {KINDS.map(k => (
              <tr key={k} className={`kind-${k}`}>
                <th scope="row">
                  <span className={`review-mark ${k}`}>{KIND_MARK[k]}</span> {KIND_LABEL[k]}
                </th>
                {(['w', 'b'] as const).map(c => (
                  <td key={c}>{summary[c].counts[k]}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Mistakes</th>
              {(['w', 'b'] as const).map(c => (
                <td key={c} className="jump">
                  <button type="button" onClick={() => onJump(c, -1)} aria-label={`Previous mistake by ${names[c]}`} title="Previous inaccuracy or worse">
                    ◀
                  </button>
                  <button type="button" onClick={() => onJump(c, 1)} aria-label={`Next mistake by ${names[c]}`} title="Next inaccuracy or worse">
                    ▶
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      {current && (
        <div className={`review-verdict ${current.kind}`} role="status">
          <p>
            <strong>
              {current.san} <span className={`review-mark ${current.kind}`}>{KIND_MARK[current.kind]}</span> {KIND_LABEL[current.kind]}
            </strong>{' '}
            <span className="muted small">
              {current.before} → {current.after}
            </span>
          </p>
          {current.bestSan && (
            <p className="small">
              Best was <strong>{current.bestSan}</strong>{' '}
              <button type="button" className="link-button" onClick={onShowBest}>
                show it
              </button>
            </p>
          )}
        </div>
      )}
      <p className="muted small">
        Inaccuracy, mistake and blunder use lila’s rules (the drop in winning chances: 0.1, 0.2, 0.3); best, excellent and good are smaller drops. The
        engine is this app’s own and fairly modest, so treat close calls with care.
      </p>
    </section>
  );
}

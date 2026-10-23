import type { Color } from 'chess.js';
import { moveNumber, PHASE_LABEL, type ReviewedMove, type ReviewSummary } from '../../analysis/gameReview';
import { PHASES } from '../../analysis/divider';
import { KIND_LABEL, KIND_MARK, KINDS, type Kind } from '../../analysis/review';
import type { RetryState } from '../../analysis/retry';
import { EvalGraph } from './EvalGraph';
import type { Division } from '../../analysis/divider';

export interface CurrentVerdict {
  move: ReviewedMove;
  /** Evaluations before and after, as shown ("+0.4"). */
  before: string;
  after: string;
  /** The engine's move, in SAN, when it differs from the one played. */
  bestSan: string | null;
  explanation: string;
}

interface Props {
  moves: number;
  progress: { done: number; total: number } | null;
  summary: ReviewSummary | null;
  /** One sentence per side about its phases. */
  phaseNotes: readonly string[];
  reviewed: readonly ReviewedMove[];
  names: Record<Color, string>;
  current: CurrentVerdict | null;
  graph: { points: (number | null)[]; kinds: ReadonlyMap<number, Kind>; division: Division; ply: number } | null;
  /** Errors each side can retry. */
  retryCounts: Record<Color, number>;
  retry: RetryState | null;
  /** About saving the review with the game ("Saved with the game."), or null. */
  savedNote: string | null;
  /** Server-side analysis, when the server offers it. */
  server?: { text: string | null; canRequest: boolean } | null;
  onServer?: () => void;
  onStart: () => void;
  onStop: () => void;
  onJump: (color: Color, dir: 1 | -1) => void;
  onShowBest: () => void;
  onGoto: (ply: number) => void;
  onRetry: (color: Color) => void;
  onRetryAction: (action: 'again' | 'show' | 'next' | 'exit') => void;
}

const SIDES = ['w', 'b'] as const;

const percent = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);

function RetryBox({ retry, names, onRetryAction }: Pick<Props, 'names' | 'onRetryAction'> & { retry: RetryState }) {
  const total = retry.plies.length;
  const name = names[retry.color];
  const text: Record<RetryState['status'], string> = {
    find: `Find a better move for ${name}.`,
    checking: 'Checking your move…',
    win: 'Well done: that keeps the position.',
    fail: 'Not quite. Try again, or see the answer.',
    view: 'Here is the engine’s move.',
    done: total === 0 ? `${name} has no mistakes to retry.` : `All done: you found ${retry.solved.length} of ${total}.`,
  };
  return (
    <div className={`retry-box ${retry.status}`} role="status">
      {retry.status !== 'done' && (
        <p className="muted small">
          Mistake {retry.index + 1} of {total}
        </p>
      )}
      <p>
        <strong>{text[retry.status]}</strong>
      </p>
      <div className="row">
        {retry.status === 'fail' && (
          <button type="button" onClick={() => onRetryAction('again')}>
            Try again
          </button>
        )}
        {(retry.status === 'find' || retry.status === 'fail') && (
          <button type="button" onClick={() => onRetryAction('show')}>
            Show answer
          </button>
        )}
        {retry.status !== 'done' && retry.status !== 'checking' && (
          <button type="button" className={retry.status === 'win' || retry.status === 'view' ? 'primary' : ''} onClick={() => onRetryAction('next')}>
            {retry.status === 'find' ? 'Skip' : 'Next'}
          </button>
        )}
        <button type="button" onClick={() => onRetryAction('exit')}>
          {retry.status === 'done' ? 'Back to the review' : 'Stop'}
        </button>
      </div>
    </div>
  );
}

/** "Review game": runs the engine over the game and judges every move, from brilliant to blunder. */
export function ReviewPanel(props: Props) {
  const { moves, progress, summary, phaseNotes, reviewed, names, current, graph, retryCounts, retry, savedNote, server } = props;
  const { onStart, onStop, onJump, onShowBest, onGoto, onRetry, onRetryAction } = props;

  if (retry)
    return (
      <section className="panel review" aria-label="Retry mistakes">
        <h2>Retry mistakes</h2>
        <RetryBox retry={retry} names={names} onRetryAction={onRetryAction} />
      </section>
    );

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
        !summary?.complete && (
          <button type="button" className="primary" onClick={onStart} disabled={moves < 2}>
            📊 {summary ? 'Finish the review' : 'Review game'}
          </button>
        )
      )}
      {moves < 2 && !summary && <p className="muted small">Load or play a game first: the review judges every move of the main line.</p>}
      {server?.canRequest && (
        <button type="button" onClick={props.onServer} title="The server analyses the game and saves the review with it, so you can close this page">
          ☁ Analyse on the server instead
        </button>
      )}
      {server?.text && (
        <p className="muted small" role="status">
          {server.text}
        </p>
      )}

      {graph && <EvalGraph points={graph.points} kinds={graph.kinds} division={graph.division} current={graph.ply} onSelect={onGoto} />}

      {summary && (
        <table className="review-table">
          <thead>
            <tr>
              <th scope="col" />
              {SIDES.map(c => (
                <th key={c} scope="col">
                  {c === 'w' ? '○' : '●'} {names[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="accuracy">
              <th scope="row">Accuracy</th>
              {SIDES.map(c => (
                <td key={c}>{percent(summary.sides[c].accuracy)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" title="A rough estimate from accuracy, not a rating">
                Est. performance
              </th>
              {SIDES.map(c => (
                <td key={c}>{summary.sides[c].performance ?? '–'}</td>
              ))}
            </tr>
            {KINDS.map(k => (
              <tr key={k} className={`kind-${k}`}>
                <th scope="row">
                  <span className={`review-mark ${k}`}>{KIND_MARK[k]}</span> {KIND_LABEL[k]}
                </th>
                {SIDES.map(c => (
                  <td key={c}>{summary.sides[c].counts[k]}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Mistakes</th>
              {SIDES.map(c => (
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

      {summary && (
        <table className="review-table phases">
          <caption>Accuracy by phase</caption>
          <tbody>
            {PHASES.map(p => (
              <tr key={p}>
                <th scope="row">{PHASE_LABEL[p]}</th>
                {SIDES.map(c => {
                  const s = summary.sides[c].phases[p];
                  return (
                    <td key={c} title={`${s.moves} move${s.moves === 1 ? '' : 's'}, ${s.errors} error${s.errors === 1 ? '' : 's'}`}>
                      {s.moves ? percent(s.accuracy) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary?.complete && phaseNotes.length > 0 && (
        <ul className="phase-notes small">
          {phaseNotes.map(n => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {summary && summary.keyMoments.length > 0 && (
        <div className="key-moments">
          <h3>Key moments</h3>
          <ul>
            {summary.keyMoments.map(m => (
              <li key={m.ply}>
                <button type="button" className="link-button" onClick={() => onGoto(m.ply)}>
                  {moveNumber(m)} {m.san} <span className={`review-mark ${m.judgement.kind}`}>{KIND_MARK[m.judgement.kind]}</span>
                </button>{' '}
                <span className="muted small">
                  {KIND_LABEL[m.judgement.kind]} by {names[m.color]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current && (
        <div className={`review-verdict ${current.move.judgement.kind}`} role="status">
          <p>
            <strong>
              {current.move.san} <span className={`review-mark ${current.move.judgement.kind}`}>{KIND_MARK[current.move.judgement.kind]}</span>{' '}
              {KIND_LABEL[current.move.judgement.kind]}
            </strong>{' '}
            <span className="muted small">
              {current.before} → {current.after}
            </span>
          </p>
          <p className="small">{current.explanation}</p>
          {current.bestSan && (
            <p className="small">
              <button type="button" className="link-button" onClick={onShowBest}>
                Play {current.bestSan} on the board
              </button>
            </p>
          )}
        </div>
      )}

      {summary && !progress && (
        <div className="row retry-start">
          {SIDES.map(c => (
            <button key={c} type="button" onClick={() => onRetry(c)} disabled={retryCounts[c] === 0}>
              🔁 Retry {names[c]}’s mistakes ({retryCounts[c]})
            </button>
          ))}
        </div>
      )}
      {savedNote && <p className="muted small">{savedNote}</p>}
      {reviewed.length > 0 && (
        <p className="muted small">
          Inaccuracy, mistake and blunder use lila’s rules (a drop in winning chances of 0.1, 0.2 or 0.3). Brilliant, great, miss and the rest are this
          app’s own; book moves need imported master games. The engine is this app’s own and fairly modest, so treat close calls with care.
        </p>
      )}
    </section>
  );
}

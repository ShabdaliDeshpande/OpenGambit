import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import type { Score } from '../../analysis/accuracy';
import type { UciMove } from '../../engine/search';
import { endgameOutcome, practiceVerdict, type Endgame, type Outcome, type Verdict } from '../../learn/endgames';
import { analyseOnce } from '../../hooks/evaluateOnce';

/** Engine time for judging a move and for its reply. */
const THINK_MS = 800;

const VERDICT_TEXT: Record<Verdict, string> = { good: 'Good move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };

interface Props {
  endgame: Endgame;
  done: boolean;
  onWin: () => void;
  onBack: () => void;
}

interface Played {
  san: string;
  verdict: Verdict | null;
}

/** An endgame played against the engine, with a goal and a grade for each of your moves. */
export function EndgamePlayer({ endgame, done, onWin, onBack }: Props) {
  const you = new Chess(endgame.fen).turn();
  const [moves, setMoves] = useState<UciMove[]>([]);
  const [status, setStatus] = useState<'you' | 'thinking' | Outcome>('thinking');
  const [message, setMessage] = useState<string | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const before = useRef<Score | null>(null);
  const promoted = useRef(false);
  const run = useRef(0);

  const fenAfter = (list: readonly UciMove[]) => {
    const c = new Chess(endgame.fen);
    for (const m of list) c.move(m);
    return c.fen();
  };

  const restart = useCallback(() => {
    const token = ++run.current;
    setMoves([]);
    setPlayed([]);
    setMessage(null);
    promoted.current = false;
    before.current = null;
    setStatus('thinking');
    void analyseOnce(endgame.fen, [], THINK_MS).promise.then(r => {
      if (run.current !== token) return;
      before.current = r.score;
      setStatus('you');
    });
  }, [endgame.fen]);

  useEffect(() => {
    restart();
    return () => {
      run.current++;
    };
  }, [restart]);

  const yourMoves = played.length;

  const onMove = async (from: Square, to: Square, promotion?: PieceSymbol) => {
    if (status !== 'you') return;
    const token = run.current;
    const mine: UciMove = { from, to, ...(promotion ? { promotion } : {}) };
    const afterMine = [...moves, mine];
    const san = new Chess(fenAfter(moves)).move(mine).san;
    if (promotion) promoted.current = true;
    setMoves(afterMine);
    setStatus('thinking');

    const judged = await analyseOnce(endgame.fen, afterMine, THINK_MS).promise;
    if (run.current !== token) return;
    const verdict = before.current ? practiceVerdict(before.current, judged.score, you) : null;
    const count = yourMoves + 1;
    setPlayed(p => [...p, { san, verdict }]);
    const first = endgameOutcome(endgame.goal, fenAfter(afterMine), count, you, promoted.current, judged.score);
    if (first.outcome !== 'playing') return finish(first.outcome, first.message);

    // the engine replies with its best move
    const reply = judged.pv[0];
    if (!reply) return finish('lost', 'The game is over.');
    const afterReply = [...afterMine, reply];
    setMoves(afterReply);
    const next = await analyseOnce(endgame.fen, afterReply, THINK_MS).promise;
    if (run.current !== token) return;
    before.current = next.score;
    const second = endgameOutcome(endgame.goal, fenAfter(afterReply), count, you, promoted.current, next.score);
    if (second.outcome !== 'playing') return finish(second.outcome, second.message);
    setStatus('you');
  };

  const finish = (outcome: Outcome, text: string | null) => {
    setStatus(outcome);
    setMessage(text);
    if (outcome === 'won') onWin();
  };

  const fen = fenAfter(moves);
  const last = moves.at(-1);
  const goal = endgame.goal;
  const limit = goal.kind === 'hold' ? goal.moves : goal.within;

  return (
    <main className="layout learn">
      <div className="board-wrap">
        <Board fen={fen} orientation={you} movableColor={status === 'you' ? you : null} lastMove={last ? { from: last.from, to: last.to } : null} onMove={(f, t, p) => void onMove(f, t, p)} />
      </div>
      <aside className="side">
        <section className="panel">
          <button type="button" className="link-button" onClick={onBack}>
            ← Endgames
          </button>
          <h2>
            {endgame.title}
            {done ? ' ✓' : ''}
          </h2>
          <p className="lesson-task">{endgame.task}</p>
          <p className="muted small">
            Move {Math.min(limit, yourMoves + (status === 'you' ? 1 : 0))} of {limit} · you play {you === 'w' ? 'White' : 'Black'} against the engine
          </p>
          {status === 'thinking' && <p className="muted">The engine is thinking…</p>}
          {message && (
            <div className={status === 'won' ? 'lesson-done' : 'lesson-wrong'} role="status">
              <p>{message}</p>
              <button type="button" className={status === 'won' ? '' : 'primary'} onClick={restart}>
                {status === 'won' ? 'Play it again' : '↶ Try again'}
              </button>
            </div>
          )}
          {played.length > 0 && (
            <ol className="endgame-moves small">
              {played.map((p, i) => (
                <li key={i}>
                  {p.san} {p.verdict && <span className={`verdict ${p.verdict}`}>{VERDICT_TEXT[p.verdict]}</span>}
                </li>
              ))}
            </ol>
          )}
          {status === 'you' && (
            <details className="small">
              <summary>Hint</summary>
              <p>{endgame.hint}</p>
            </details>
          )}
          <p className="muted small">Each move is graded by how much it changes your winning chances.</p>
        </section>
      </aside>
    </main>
  );
}

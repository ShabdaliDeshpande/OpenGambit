import { useEffect, useRef, useState } from 'react';
import type { PositionEval } from '../../analysis/gameReview';
import { KIND_MARK } from '../../analysis/review';
import { analyseOnce } from '../../hooks/evaluateOnce';
import { explainSolution, puzzleStart } from '../../learn/puzzleExplain';
import type { Puzzle } from '../../puzzles/types';

/** Engine time per position of the solution. */
const EXPLAIN_MS = 700;

/** "Explain the solution": the solver's moves, classified and described like Game Review does. */
export function SolutionExplainer({ puzzle }: { puzzle: Puzzle }) {
  const [evals, setEvals] = useState<PositionEval[] | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => () => cancel.current?.(), []);

  const start = async () => {
    const fen = puzzleStart(puzzle);
    const found: PositionEval[] = [];
    setEvals([]);
    // one position at a time, so the explanations appear as they're ready
    for (let i = 0; i <= puzzle.solution.length; i++) {
      const job = analyseOnce(fen, puzzle.solution.slice(0, i), EXPLAIN_MS, 2);
      let stopped = false;
      cancel.current = () => {
        stopped = true;
        job.cancel();
      };
      const r = await job.promise;
      if (stopped) return;
      found.push({ score: r.score, best: r.pv[0] ?? null, second: r.second, pv: r.pv });
      setEvals([...found]);
    }
    cancel.current = null;
  };

  if (evals === null)
    return (
      <button type="button" onClick={() => void start()}>
        💡 Explain the solution
      </button>
    );

  const explained = explainSolution(puzzle, evals);
  const solverMoves = Math.ceil(puzzle.solution.length / 2);
  return (
    <div className="puzzle-explain" aria-live="polite">
      <h3>Why it works</h3>
      <ol>
        {explained.map(m => (
          <li key={m.ply}>
            <strong>{m.san}</strong> <span className={`review-mark ${m.kind}`}>{KIND_MARK[m.kind]}</span> {m.label}
            <p className="small">{m.text}</p>
          </li>
        ))}
      </ol>
      {explained.length < solverMoves && <p className="muted small">The engine is looking at move {explained.length + 1} of {solverMoves}…</p>}
    </div>
  );
}

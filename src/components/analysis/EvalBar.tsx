import type { Color } from 'chess.js';
import type { AnalysisLine } from '../../engine/search';
import { formatEval, whiteShare } from '../../analysis/evalFormat';

/** Vertical bar: White's share fills from White's side of the board. */
export function EvalBar({ line, orientation }: { line: AnalysisLine | null; orientation: Color }) {
  const share = whiteShare(line);
  const label = line ? formatEval(line) : '–';
  const whiteAhead = share >= 0.5;
  return (
    <div className={`eval-bar${orientation === 'b' ? ' flipped' : ''}`} role="meter" aria-label="Evaluation" aria-valuetext={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <div className="eval-white" style={{ height: `${share * 100}%` }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}

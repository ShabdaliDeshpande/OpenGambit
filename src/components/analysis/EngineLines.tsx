import { Chess } from 'chess.js';
import type { AnalysisState } from '../../hooks/useAnalysis';
import type { UciMove } from '../../engine/search';
import { formatEval } from '../../analysis/evalFormat';

interface Props {
  fen: string;
  enabled: boolean;
  multiPv: number;
  analysis: AnalysisState;
  onToggle: () => void;
  onMultiPv: (n: number) => void;
  /** Plays these moves (a prefix of an engine line) into the tree. */
  onPlayLine: (pv: UciMove[]) => void;
}

/** "12... Nf6" style tokens for each move of a line, each clickable. */
function lineMoves(fen: string, pv: UciMove[]) {
  const chess = new Chess(fen);
  const out: { label: string; upto: number }[] = [];
  for (const [i, m] of pv.slice(0, 12).entries()) {
    const white = chess.turn() === 'w';
    const n = chess.moveNumber();
    try {
      const san = chess.move(m).san;
      out.push({ label: white ? `${n}. ${san}` : i === 0 ? `${n}... ${san}` : san, upto: i + 1 });
    } catch {
      break;
    }
  }
  return out;
}

function positionStatus(fen: string): string | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return 'Checkmate';
  if (chess.isStalemate()) return 'Stalemate';
  if (chess.isInsufficientMaterial()) return 'Insufficient material';
  return null;
}

export function EngineLines({ fen, enabled, multiPv, analysis, onToggle, onMultiPv, onPlayLine }: Props) {
  const { info, running, error } = analysis;
  const status = positionStatus(fen);
  const nps = info && info.elapsedMs > 0 ? Math.round(info.nodes / info.elapsedMs) : null;

  return (
    <section className="panel engine" aria-label="Engine analysis">
      <div className="engine-head">
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span>Engine</span>
        </label>
        <span className="muted engine-meta">
          {enabled && info ? `depth ${info.depth}${running ? '' : ' (done)'}${nps ? ` · ${nps} kN/s` : ''}` : enabled && running ? 'thinking…' : ''}
        </span>
        <label className="lines-select">
          <span className="sr-only">Lines</span>
          <select value={multiPv} onChange={e => onMultiPv(Number(e.target.value))} aria-label="Number of lines">
            {[1, 2, 3, 4, 5].map(n => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'line' : 'lines'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">Engine error: {error}</p>}
      {enabled && status && <p className="muted">{status}. No moves to analyse.</p>}
      {enabled && !status && info && (
        <ol className="pv-lines">
          {info.lines.map((line, i) => (
            <li key={i} className="pv-line">
              <span className={`pv-eval${(line.mate ?? line.cp ?? 0) >= 0 ? ' plus' : ' minus'}`}>{formatEval(line)}</span>
              <span className="pv-moves">
                {lineMoves(fen, line.pv).map(m => (
                  <button key={m.upto} type="button" className="pv-move" onClick={() => onPlayLine(line.pv.slice(0, m.upto))}>
                    {m.label}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!enabled && <p className="muted">Turn on the engine to see evaluations and best moves.</p>}
    </section>
  );
}

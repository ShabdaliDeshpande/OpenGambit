import { useState } from 'react';
import { Chess } from 'chess.js';
import type { AnalysisState } from '../../hooks/useAnalysis';
import type { UciMove } from '../../engine/search';
import { formatEval } from '../../analysis/evalFormat';
import { limitText, MAX_DEPTH, MAX_LINES, TIME_STEPS, type EngineSettings } from '../../analysis/engineSettings';

interface Props {
  fen: string;
  settings: EngineSettings;
  onSettings: (s: EngineSettings) => void;
  /** Most workers the device can spare. */
  maxThreads: number;
  analysis: AnalysisState;
  /** What the opponent threatens, when threat mode is on and available. */
  threat: { fen: string; analysis: AnalysisState } | null;
  /** The engine is paused (e.g. while retrying a mistake). */
  paused?: boolean;
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

export function SettingsForm({ settings: s, onSettings, maxThreads }: Pick<Props, 'settings' | 'onSettings' | 'maxThreads'>) {
  const set = (patch: Partial<EngineSettings>) => onSettings({ ...s, ...patch });
  const timeIndex = Math.max(0, TIME_STEPS.indexOf(s.seconds));
  return (
    <fieldset className="engine-settings">
      <legend className="sr-only">Engine settings</legend>
      <div className="row">
        <span>Search by</span>
        <label>
          <input type="radio" name="search-by" checked={s.by === 'time'} disabled={s.infinite} onChange={() => set({ by: 'time' })} /> time
        </label>
        <label>
          <input type="radio" name="search-by" checked={s.by === 'depth'} disabled={s.infinite} onChange={() => set({ by: 'depth' })} /> depth
        </label>
      </div>
      {s.by === 'time' ? (
        <label className="row">
          <span>Time per position</span>
          <input
            type="range"
            min={0}
            max={TIME_STEPS.length - 1}
            value={timeIndex}
            disabled={s.infinite}
            onChange={e => set({ seconds: TIME_STEPS[Number(e.target.value)]! })}
          />
          <output>{s.seconds} s</output>
        </label>
      ) : (
        <label className="row">
          <span>Depth</span>
          <input type="range" min={1} max={MAX_DEPTH} value={s.depth} disabled={s.infinite} onChange={e => set({ depth: Number(e.target.value) })} />
          <output>{s.depth}</output>
        </label>
      )}
      <label className="row">
        <input type="checkbox" checked={s.infinite} onChange={e => set({ infinite: e.target.checked })} /> Infinite analysis (until you move on)
      </label>
      <label className="row">
        <span>Lines</span>
        <input type="range" min={1} max={MAX_LINES} value={s.lines} onChange={e => set({ lines: Number(e.target.value) })} />
        <output>{s.lines}</output>
      </label>
      <label className="row">
        <span>Threads</span>
        <input type="range" min={1} max={maxThreads} value={s.threads} disabled={maxThreads === 1} onChange={e => set({ threads: Number(e.target.value) })} />
        <output>
          {s.threads} / {maxThreads}
        </output>
      </label>
      <label className="row">
        <input type="checkbox" checked={s.threat} onChange={e => set({ threat: e.target.checked })} /> Show threat (what the opponent would play if it were their move)
      </label>
      <div className="row">
        <span>Arrows</span>
        {(['best', 'threat', 'drawn'] as const).map(k => (
          <label key={k}>
            <input type="checkbox" checked={s.arrows[k]} onChange={e => set({ arrows: { ...s.arrows, [k]: e.target.checked } })} />{' '}
            {k === 'best' ? 'best moves' : k === 'threat' ? 'threat' : 'drawn'}
          </label>
        ))}
      </div>
      <p className="muted small">Right-click and drag on the board to draw an arrow, or right-click a square to circle it. Hold Shift, Alt or Ctrl for other colours; a left click clears them.</p>
    </fieldset>
  );
}

export function EngineLines({ fen, settings, onSettings, maxThreads, analysis, threat, paused = false, onPlayLine }: Props) {
  const [open, setOpen] = useState(false);
  const { info, running, error } = analysis;
  const enabled = settings.on && !paused;
  const status = positionStatus(fen);
  const nps = info && info.elapsedMs > 0 ? Math.round(info.nodes / info.elapsedMs) : null;
  const threatLine = threat?.analysis.info?.lines[0];

  return (
    <section className="panel engine" aria-label="Engine analysis">
      <div className="engine-head">
        <label className="switch">
          <input type="checkbox" checked={settings.on} onChange={() => onSettings({ ...settings, on: !settings.on })} />
          <span>Engine</span>
        </label>
        <span className="muted engine-meta">
          {enabled && info ? `depth ${info.depth}${running ? '' : ' (done)'}${nps ? ` · ${nps} kN/s` : ''}` : enabled && running ? 'thinking…' : ''}
          {enabled && ` · ${limitText(settings)}${settings.threads > 1 ? ` · ${settings.threads} threads` : ''}`}
        </span>
        <button type="button" className="engine-gear" aria-expanded={open} aria-label="Engine settings" title="Engine settings" onClick={() => setOpen(o => !o)}>
          ⚙
        </button>
      </div>

      {open && <SettingsForm settings={settings} onSettings={onSettings} maxThreads={maxThreads} />}

      {error && <p className="error">Engine error: {error}</p>}
      {paused && settings.on && <p className="muted">The engine is hidden while you retry a mistake.</p>}
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
      {enabled && settings.threat && !status && (
        <p className="threat-line small">
          <strong>Threat:</strong>{' '}
          {!threat
            ? 'none while in check.'
            : threatLine
              ? `${lineMoves(threat.fen, threatLine.pv.slice(0, 3))
                  .map(m => m.label)
                  .join(' ')} (${formatEval(threatLine)})`
              : 'thinking…'}
        </p>
      )}
      {!settings.on && <p className="muted">Turn on the engine to see evaluations and best moves.</p>}
    </section>
  );
}

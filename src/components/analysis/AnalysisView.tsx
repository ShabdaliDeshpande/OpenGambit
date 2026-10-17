import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { Board, type Arrow } from '../Board';
import { PgnFenPanel } from '../PgnFenPanel';
import { EvalBar } from './EvalBar';
import { EngineLines } from './EngineLines';
import { NodeTools } from './NodeTools';
import { TreeView } from './TreeView';
import { analysisReducer, initialAnalysis } from '../../analysis/analysisState';
import { readPgn, writePgn } from '../../analysis/pgn';
import { emptyTree, isMainline, movesAlong, nodeAt } from '../../analysis/tree';
import { checkFen } from '../../chess/game';
import { useAnalysis } from '../../hooks/useAnalysis';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';

const ENGINE_KEY = 'chess-app:analysis-engine';

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: preference just isn't remembered
  }
}

interface Props {
  /** Whether this view is on screen (keyboard and engine run only then). */
  active: boolean;
  orientation: Color;
  onFlip: () => void;
  /** A PGN to load, sent from the play screen; `nonce` changes on every request. */
  request: { pgn: string; nonce: number } | null;
}

export function AnalysisView({ active, orientation, onFlip, request }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, undefined, initialAnalysis);
  const [engineOn, setEngineOn] = useState<boolean>(() => loadPref(ENGINE_KEY, { on: true, lines: 3 }).on);
  const [multiPv, setMultiPv] = useState<number>(() => loadPref(ENGINE_KEY, { on: true, lines: 3 }).lines);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    savePref(ENGINE_KEY, { on: engineOn, lines: multiPv });
  }, [engineOn, multiPv]);

  useEffect(() => {
    if (!request) return;
    try {
      dispatch({ type: 'load', tree: readPgn(request.pgn) });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [request]);

  const { root } = state.tree;
  const node = nodeAt(root, state.path) ?? root;

  const target = useMemo(
    () => ({ startFen: root.fen, moves: movesAlong(root, state.path), key: `${root.fen}|${state.path.join(' ')}` }),
    [root, state.path],
  );
  const analysis = useAnalysis(target, active && engineOn, { multiPv });
  const lines = analysis.info?.lines ?? [];

  const arrows: Arrow[] = useMemo(() => {
    if (!engineOn) return [];
    return lines.slice(0, 2).flatMap((l, i) => (l.pv[0] ? [{ from: l.pv[0].from, to: l.pv[0].to, tone: i === 0 ? 'best' : 'alt' } as Arrow] : []));
  }, [lines, engineOn]);

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) =>
      dispatch({ type: 'play', moves: [{ from, to, ...(promotion ? { promotion } : {}) }] }),
    [],
  );

  useKeyboardNav(
    {
      prev: () => dispatch({ type: 'prev' }),
      next: () => dispatch({ type: 'next' }),
      first: () => dispatch({ type: 'first' }),
      last: () => dispatch({ type: 'last' }),
      flip: onFlip,
    },
    active,
  );

  const turn: Color = node.fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const pgn = useMemo(() => writePgn(state.tree), [state.tree]);

  return (
    <main className="layout analysis">
      <div className="board-wrap with-eval">
        {engineOn && <EvalBar line={lines[0] ?? null} orientation={orientation} />}
        <Board
          fen={node.fen}
          orientation={orientation}
          movableColor={turn}
          lastMove={node.uci ? { from: node.uci.from, to: node.uci.to } : null}
          onMove={onMove}
          arrows={arrows}
        />
      </div>

      <aside className="side">
        <EngineLines
          fen={node.fen}
          enabled={engineOn}
          multiPv={multiPv}
          analysis={analysis}
          onToggle={() => setEngineOn(on => !on)}
          onMultiPv={setMultiPv}
          onPlayLine={pv => dispatch({ type: 'play', moves: pv })}
        />

        <section className="panel">
          <TreeView root={root} path={state.path} onSelect={path => dispatch({ type: 'goto', path })} />
          <div className="nav row" aria-label="Move navigation">
            <button type="button" onClick={() => dispatch({ type: 'first' })} title="Start (Home)" aria-label="Start position">⏮</button>
            <button type="button" onClick={() => dispatch({ type: 'prev' })} title="Back (←)" aria-label="Previous move">◀</button>
            <button type="button" onClick={() => dispatch({ type: 'next' })} title="Forward (→)" aria-label="Next move">▶</button>
            <button type="button" onClick={() => dispatch({ type: 'last' })} title="End of line (End)" aria-label="End of line">⏭</button>
          </div>
          <div className="row tree-actions">
            <button type="button" onClick={() => dispatch({ type: 'load', tree: emptyTree() })}>New analysis</button>
            <button type="button" onClick={onFlip} title="Flip board (f)">⇅ Flip</button>
          </div>
        </section>

        <NodeTools
          node={node}
          isRoot={state.path.length === 0}
          isMainline={isMainline(root, state.path)}
          onNag={nag => dispatch({ type: 'nag', nag })}
          onComment={text => dispatch({ type: 'comment', text })}
          onDelete={() => dispatch({ type: 'delete' })}
          onPromote={() => dispatch({ type: 'promote' })}
          onMainline={() => dispatch({ type: 'mainline' })}
        />

        {loadError && <p className="error">{loadError}</p>}
        <PgnFenPanel
          pgn={pgn}
          fen={node.fen}
          onLoadPgn={text => dispatch({ type: 'load', tree: readPgn(text) })}
          onLoadFen={text => dispatch({ type: 'load', tree: emptyTree(checkFen(text)) })}
        />
      </aside>
    </main>
  );
}

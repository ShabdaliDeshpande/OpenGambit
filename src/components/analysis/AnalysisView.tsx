import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { ReviewPanel, type CurrentVerdict } from './ReviewPanel';
import { judge, summarize, type Judgement, type Kind, type Score } from '../../analysis/review';
import { formatEval } from '../../analysis/evalFormat';
import { mainlinePositions, useGameReview } from '../../hooks/useGameReview';
import type { UciMove } from '../../engine/search';
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

  // a game sent here (from Play, an online game or a profile) is reviewed straight away
  const [reviewRequested, setReviewRequested] = useState(false);
  useEffect(() => {
    if (!request) return;
    try {
      dispatch({ type: 'load', tree: readPgn(request.pgn) });
      setLoadError(null);
      setReviewRequested(true);
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

  // game review: a verdict for every main-line move whose positions before and after are analysed
  const review = useGameReview(root);
  useEffect(() => {
    if (!reviewRequested || !active) return;
    setReviewRequested(false);
    if (mainlinePositions(root).length > 2) review.start();
  }, [reviewRequested, active, root, review.start]);
  const reviewed = useMemo(() => {
    const positions = mainlinePositions(root);
    const out: { key: string; path: string[]; color: Color; san: string; judgement: Judgement; before: Score; after: Score; best: UciMove | null; fenBefore: string }[] = [];
    for (let i = 1; i < positions.length; i++) {
      const [prev, cur] = [positions[i - 1]!, positions[i]!];
      const [a, b] = [review.evalAt(prev), review.evalAt(cur)];
      if (!a || !b || !cur.node.uci) continue;
      const color: Color = prev.node.fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const m = cur.node.uci;
      const playedBest = !!a.best && a.best.from === m.from && a.best.to === m.to && (a.best.promotion ?? '') === (m.promotion ?? '');
      out.push({ key: cur.key, path: cur.path, color, san: cur.node.san, judgement: judge(a.score, b.score, color, playedBest), before: a.score, after: b.score, best: playedBest ? null : a.best, fenBefore: prev.node.fen });
    }
    return out;
  }, [root, review.evalAt]);
  const marks = useMemo(() => new Map<string, Kind>(reviewed.map(r => [r.key, r.judgement.kind])), [reviewed]);
  const summary = useMemo(() => (reviewed.length ? summarize(reviewed) : null), [reviewed]);

  const showScore = (s: Score) =>
    'mated' in s ? (s.mated === 'w' ? '0–1' : '1–0') : formatEval('mate' in s ? { cp: null, mate: s.mate } : { cp: s.cp, mate: null });
  const here = reviewed.find(r => r.key === state.path.join(' '));
  const bestSan = (r: (typeof reviewed)[number]) => {
    if (!r.best) return null;
    try {
      return new Chess(r.fenBefore).move(r.best).san;
    } catch {
      return null;
    }
  };
  const current: CurrentVerdict | null = here
    ? { san: here.san, kind: here.judgement.kind, before: showScore(here.before), after: showScore(here.after), bestSan: bestSan(here) }
    : null;

  /** Jumps to the previous or next inaccuracy (or worse) by `color`. */
  const jump = (color: Color, dir: 1 | -1) => {
    const bad = reviewed.filter(r => r.color === color && ['inaccuracy', 'mistake', 'blunder'].includes(r.judgement.kind));
    const at = state.path.length;
    const target = dir === 1 ? bad.find(r => r.path.length > at) : [...bad].reverse().find(r => r.path.length < at);
    const fallback = dir === 1 ? bad[0] : bad.at(-1);
    const go = target ?? fallback;
    if (go) dispatch({ type: 'goto', path: go.path });
  };

  /** Plays the engine's move instead, as a variation from the position before. */
  const showBest = () => {
    if (!here?.best) return;
    dispatch({ type: 'goto', path: here.path.slice(0, -1) });
    dispatch({ type: 'play', moves: [here.best] });
  };

  const names: Record<Color, string> = { w: state.tree.headers.White || 'White', b: state.tree.headers.Black || 'Black' };

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
          <TreeView root={root} path={state.path} onSelect={path => dispatch({ type: 'goto', path })} marks={marks} />
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

        <ReviewPanel
          moves={mainlinePositions(root).length - 1}
          progress={review.progress}
          reviewed={reviewed.length > 0}
          summary={summary}
          names={names}
          current={current}
          onStart={review.start}
          onStop={review.stop}
          onJump={jump}
          onShowBest={showBest}
        />

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

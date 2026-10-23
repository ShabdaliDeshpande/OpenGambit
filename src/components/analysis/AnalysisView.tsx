import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { ReviewPanel, type CurrentVerdict } from './ReviewPanel';
import { winningChances, type Kind, type Score } from '../../analysis/review';
import { phaseSummary, reviewMoves, summarizeReview, type GameMove } from '../../analysis/gameReview';
import { explainMove } from '../../analysis/explain';
import { afterMove } from '../../analysis/material';
import { judgeTry, quickVerdict, retryCandidates, retryReducer, startRetry, type RetryAction, type RetryState } from '../../analysis/retry';
import { decodeUci, encodeUci } from '../../analysis/reviewData';
import { fromStoredReview, toStoredReview } from '../../analysis/savedReview';
import { formatEval } from '../../analysis/evalFormat';
import { mainlinePositions, REVIEW_ENGINE, REVIEW_MS, useGameReview, type PositionEval } from '../../hooks/useGameReview';
import { evaluateOnce } from '../../hooks/evaluateOnce';
import { fetchBook, fetchOpening, fetchReview, fetchServerAnalysis, requestServerAnalysis, saveReview, ApiError, type ServerAnalysis } from '../../account/api';
import { isStandardStart } from '../../explorer/key';
import { ExplorerPanel } from './ExplorerPanel';
import { availableThreads, checkSettings, searchLimits, type EngineSettings } from '../../analysis/engineSettings';
import { threatFen } from '../../analysis/rootSplit';
import type { Shape } from '../../analysis/shapes';
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

/** A saved online game sent to the board, so its review can be loaded and saved with it. */
export interface AnalysedGame {
  id: string;
  /** The game's moves in UCI, to check the board still shows that game before saving. */
  moves: readonly string[];
  /** The viewer played in it, so the server will accept a review from them. */
  canSave: boolean;
}

export interface AnalysisRequest {
  pgn: string;
  nonce: number;
  game?: AnalysedGame;
}

interface Props {
  /** Whether this view is on screen (keyboard and engine run only then). */
  active: boolean;
  orientation: Color;
  onFlip: () => void;
  /** A PGN to load, sent from another screen; `nonce` changes on every request. */
  request: AnalysisRequest | null;
  /** Someone is signed in (the explorer's "My games" needs an account). */
  signedIn?: boolean;
}

/** What the review panel says about server analysis (null when the server doesn't offer it). */
function serverText(s: ServerAnalysis | null, complete: boolean): { text: string | null; canRequest: boolean } | null {
  if (!s?.enabled) return null;
  switch (s.status) {
    case 'queued':
      return { text: `Waiting for the server: number ${s.position} in the queue.`, canRequest: false };
    case 'running':
      return { text: `The server is analysing: position ${s.done} of ${s.total}.`, canRequest: false };
    case 'failed':
      return { text: 'The server analysis failed. You can review the game here instead.', canRequest: !complete };
    default:
      return { text: null, canRequest: s.status === 'none' && !complete };
  }
}

const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

const showScore = (s: Score) =>
  'mated' in s ? (s.mated === 'w' ? '0–1' : '1–0') : formatEval('mate' in s ? { cp: null, mate: s.mate } : { cp: s.cp, mate: null });

export function AnalysisView({ active, orientation, onFlip, request, signedIn = false }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, undefined, initialAnalysis);
  const maxThreads = useMemo(() => availableThreads(), []);
  // older versions stored only { on, lines }; checkSettings fills in the rest
  const [settings, setSettings] = useState<EngineSettings>(() => checkSettings(loadPref(ENGINE_KEY, null), maxThreads));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    savePref(ENGINE_KEY, settings);
  }, [settings]);

  const { root } = state.tree;
  const review = useGameReview(root);
  const [retry, setRetry] = useState<RetryState | null>(null);

  // a game sent here (from Play, an online game or a profile) is reviewed straight away,
  // or its saved review is loaded
  const [reviewRequested, setReviewRequested] = useState(false);
  const [game, setGame] = useState<AnalysedGame | null>(null);
  const [savedEvals, setSavedEvals] = useState<PositionEval[] | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const savedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    try {
      dispatch({ type: 'load', tree: readPgn(request.pgn) });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      return;
    }
    setRetry(null);
    setSavedNote(null);
    savedKey.current = null;
    setGame(request.game ?? null);
    if (!request.game) setReviewRequested(true);
    else
      fetchReview(request.game.id)
        .then(saved => {
          if (cancelled) return;
          if (saved) setSavedEvals(fromStoredReview(saved));
          else setReviewRequested(true);
        })
        .catch(() => !cancelled && setReviewRequested(true));
    return () => {
      cancelled = true;
    };
  }, [request]);

  // optional server-side analysis, when the server has it switched on
  const [server, setServer] = useState<ServerAnalysis | null>(null);
  useEffect(() => {
    setServer(null);
    if (!game?.canSave) return;
    let cancelled = false;
    fetchServerAnalysis(game.id)
      .then(s => !cancelled && setServer(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [game]);
  // while it waits or runs, check every few seconds, and load the review once it's done
  useEffect(() => {
    if (!game || (server?.status !== 'queued' && server?.status !== 'running')) return;
    const t = setTimeout(() => {
      fetchServerAnalysis(game.id)
        .then(s => {
          setServer(s);
          if (s.status === 'done') void fetchReview(game.id).then(saved => saved && setSavedEvals(fromStoredReview(saved)));
        })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [game, server]);
  const requestServer = () => {
    if (!game) return;
    review.stop();
    requestServerAnalysis(game.id)
      .then(setServer)
      .catch((e: unknown) => setSavedNote(`Couldn’t start the server analysis: ${e instanceof Error ? e.message : String(e)}`));
  };

  // the board has the game by now: use the saved evaluations, or review it if they don't fit
  useEffect(() => {
    if (!savedEvals) return;
    if (review.seed(savedEvals)) {
      savedKey.current = `${game?.id}|${savedEvals.length - 1}`;
      setSavedNote('This review was saved with the game.');
    } else setReviewRequested(true);
    setSavedEvals(null);
  }, [savedEvals, review.seed, game]);

  useEffect(() => {
    if (!reviewRequested || !active) return;
    setReviewRequested(false);
    if (mainlinePositions(root).length > 2) review.start();
  }, [reviewRequested, active, root, review.start]);

  // the main line as moves, with what the engine found for each position
  const positions = useMemo(() => mainlinePositions(root), [root]);
  const gameMoves: GameMove[] = useMemo(
    () =>
      positions.slice(1).map((p, i) => {
        const prev = positions[i]!.node;
        return { ply: i + 1, color: turnOf(prev.fen), fenBefore: prev.fen, fenAfter: p.node.fen, uci: p.node.uci!, san: p.node.san };
      }),
    [positions],
  );
  const evals = useMemo(() => positions.map(p => review.evalAt(p)), [positions, review.evalAt]);
  // book moves: master moves played in more than one game (needs imported games on the server)
  const standard = isStandardStart(root.fen);
  const mainUcis = useMemo(() => gameMoves.map(m => encodeUci(m.uci)).join(','), [gameMoves]);
  const [book, setBook] = useState<{ moves: string; set: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!standard || !mainUcis) return setBook({ moves: mainUcis, set: new Set() });
    let cancelled = false;
    const t = setTimeout(() => {
      fetchBook(mainUcis.split(','))
        .then(flags => !cancelled && setBook({ moves: mainUcis, set: new Set(gameMoves.filter((_m, i) => flags[i]).map(m => `${m.fenBefore}|${encodeUci(m.uci)}`)) }))
        .catch(() => !cancelled && setBook({ moves: mainUcis, set: new Set() }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mainUcis, standard]); // eslint-disable-line react-hooks/exhaustive-deps
  const bookReady = book?.moves === mainUcis;
  const reviewed = useMemo(
    () => reviewMoves(gameMoves, evals, { isBook: (fen, m) => !!book?.set.has(`${fen}|${encodeUci(m)}`) }),
    [gameMoves, evals, book],
  );
  const headers = state.tree.headers;
  const summary = useMemo(() => {
    if (reviewed.length === 0) return null;
    const elo = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
    return summarizeReview(gameMoves, reviewed, evals, { w: elo(headers.WhiteElo), b: elo(headers.BlackElo) });
  }, [gameMoves, reviewed, evals, headers]);
  const names: Record<Color, string> = { w: headers.White || 'White', b: headers.Black || 'Black' };
  const phaseNotes = useMemo(() => (summary ? phaseSummary(summary, reviewed, names) : []), [summary, reviewed, names.w, names.b]);
  const marks = useMemo(() => new Map<string, Kind>(reviewed.map(m => [positions[m.ply]!.key, m.judgement.kind])), [reviewed, positions]);

  // a finished review of the viewer's own game is saved with it
  useEffect(() => {
    if (!game?.canSave || !summary?.complete || review.progress || !bookReady) return;
    if (gameMoves.map(m => encodeUci(m.uci)).join(' ') !== game.moves.join(' ')) return;
    const key = `${game.id}|${gameMoves.length}`;
    if (savedKey.current === key) return;
    savedKey.current = key;
    saveReview(game.id, toStoredReview(evals as PositionEval[], reviewed, REVIEW_ENGINE, REVIEW_MS))
      .then(r => setSavedNote(r.saved ? 'Saved with the game: its accuracy now shows in your game history.' : 'A deeper review of this game is already saved.'))
      .catch((e: unknown) => {
        // guests, spectators and games the server doesn't keep just aren't saved
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) return;
        setSavedNote(`Couldn’t save the review: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [game, summary, review.progress, gameMoves, evals, reviewed, bookReady]);

  // retry mistakes: the board goes to the position before each error
  const retryJob = useRef<{ cancel: () => void } | null>(null);
  const dispatchRetry = useCallback((a: RetryAction) => setRetry(s => (s ? retryReducer(s, a) : s)), []);
  const fault = retry ? reviewed.find(m => m.ply === retry.plies[retry.index]) : undefined;
  useEffect(() => {
    if (fault) dispatch({ type: 'goto', path: positions[fault.ply - 1]!.path });
  }, [fault?.ply]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => retryJob.current?.cancel(), []);

  const retryCounts = useMemo(() => ({ w: retryCandidates(reviewed, 'w').length, b: retryCandidates(reviewed, 'b').length }), [reviewed]);

  const onRetryAction = (action: 'again' | 'show' | 'next' | 'exit') => {
    retryJob.current?.cancel();
    if (action === 'exit') return setRetry(null);
    if (action === 'show') {
      const answer = fault?.before.best && afterMove(fault.fenBefore, fault.before.best);
      if (answer) dispatchRetry({ type: 'show', fen: answer.fen });
      return;
    }
    dispatchRetry({ type: action });
  };

  const tryMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    if (!fault || !retry || retry.status !== 'find') return;
    const attempt = { from, to, ...(promotion ? { promotion } : {}) };
    const next = afterMove(fault.fenBefore, attempt);
    if (!next) return;
    const verdict = quickVerdict(fault, attempt);
    dispatchRetry({ type: 'try', fen: next.fen, verdict });
    if (verdict !== 'check') return;
    const job = evaluateOnce(next.fen, REVIEW_MS);
    retryJob.current = job;
    void job.promise.then(score => dispatchRetry({ type: 'checked', verdict: judgeTry(fault, score) }));
  };

  const node = nodeAt(root, state.path) ?? root;
  const target = useMemo(
    () => ({ startFen: root.fen, moves: movesAlong(root, state.path), fen: node.fen, key: `${root.fen}|${state.path.join(' ')}` }),
    [root, state.path, node.fen],
  );
  // the name of the opening reached (from the imported list), for the position on the board
  const pathUcis = useMemo(() => movesAlong(root, state.path).map(encodeUci).join(','), [root, state.path]);
  const [opening, setOpening] = useState<{ eco: string; name: string } | null>(null);
  useEffect(() => {
    if (!standard || !pathUcis) return setOpening(null);
    let cancelled = false;
    const t = setTimeout(() => {
      fetchOpening(pathUcis.split(','))
        .then(o => !cancelled && setOpening(o))
        .catch(() => !cancelled && setOpening(null));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pathUcis, standard]);

  // the engine keeps quiet while you retry, so it doesn't give the answer away
  const showEngine = settings.on && !retry;
  const limits = searchLimits(settings);
  const analysis = useAnalysis(target, active && showEngine, { multiPv: settings.lines, ...limits, threads: settings.threads });
  const lines = analysis.info?.lines ?? [];

  // threat mode: the best move for the other side, as if this side passed
  const threatPosition = showEngine && settings.threat ? threatFen(node.fen) : null;
  const threatTarget = useMemo(
    () => ({ startFen: threatPosition ?? node.fen, moves: [], fen: threatPosition ?? node.fen, key: `threat|${threatPosition}` }),
    [threatPosition, node.fen],
  );
  const threat = useAnalysis(threatTarget, active && !!threatPosition, { multiPv: 1, maxDepth: limits.maxDepth, maxMs: Math.min(limits.maxMs, 5_000) });
  const threatMove = threat.info?.lines[0]?.pv[0];

  const arrows: Arrow[] = useMemo(() => {
    if (!showEngine) return [];
    const best = settings.arrows.best
      ? lines.slice(0, 2).flatMap((l, i) => (l.pv[0] ? [{ from: l.pv[0].from, to: l.pv[0].to, tone: i === 0 ? 'best' : 'alt' } as Arrow] : []))
      : [];
    const threats = settings.arrows.threat && threatPosition && threatMove ? [{ from: threatMove.from, to: threatMove.to, tone: 'threat' } as Arrow] : [];
    return [...best, ...threats];
  }, [lines, showEngine, settings.arrows, threatPosition, threatMove]);

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
    active && !retry,
  );

  const turn = turnOf(node.fen);
  const pgn = useMemo(() => writePgn(state.tree), [state.tree]);

  const goto = (ply: number) => {
    const p = positions[ply];
    if (p) dispatch({ type: 'goto', path: p.path });
  };

  const here = isMainline(root, state.path) ? reviewed.find(m => m.ply === state.path.length) : undefined;
  const bestSan = here?.before.best && !here.playedBest ? (afterMove(here.fenBefore, here.before.best)?.san ?? null) : null;
  const explanation = useMemo(() => (here ? explainMove(here) : ''), [here]);
  const current: CurrentVerdict | null = here
    ? { move: here, before: showScore(here.before.score), after: showScore(here.after.score), bestSan, explanation }
    : null;

  /** Jumps to the previous or next inaccuracy (or worse) by `color`. */
  const jump = (color: Color, dir: 1 | -1) => {
    const bad = reviewed.filter(r => r.color === color && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(r.judgement.kind));
    const at = state.path.length;
    const found = dir === 1 ? bad.find(r => r.ply > at) : [...bad].reverse().find(r => r.ply < at);
    const go = found ?? (dir === 1 ? bad[0] : bad.at(-1));
    if (go) goto(go.ply);
  };

  /** Plays the engine's move instead, as a variation from the position before. */
  const showBest = () => {
    if (!here?.before.best) return;
    goto(here.ply - 1);
    dispatch({ type: 'play', moves: [here.before.best as UciMove] });
  };

  const graph = useMemo(() => {
    if (!evals.some(Boolean)) return null;
    return {
      points: evals.map(e => (e ? winningChances(e.score, 'w') : null)),
      kinds: new Map<number, Kind>(reviewed.map(m => [m.ply, m.judgement.kind])),
      division: summary?.division ?? { middle: null, end: null },
      ply: isMainline(root, state.path) ? state.path.length : Math.max(0, state.path.length - 1),
    };
  }, [evals, reviewed, summary, root, state.path]);

  const clearGame = () => {
    setGame(null);
    setRetry(null);
    setSavedNote(null);
  };

  const boardFen = retry && fault ? (retry.tryFen ?? fault.fenBefore) : node.fen;

  return (
    <main className="layout analysis">
      <div className="board-wrap with-eval">
        {showEngine && <EvalBar line={lines[0] ?? null} orientation={orientation} />}
        <Board
          fen={boardFen}
          orientation={orientation}
          movableColor={retry ? (retry.status === 'find' && fault ? fault.color : null) : turn}
          lastMove={retry ? null : node.uci ? { from: node.uci.from, to: node.uci.to } : null}
          onMove={retry ? tryMove : onMove}
          arrows={arrows}
          shapes={settings.arrows.drawn && !retry ? (node.shapes ?? []) : []}
          {...(settings.arrows.drawn && !retry ? { onShapes: (shapes: Shape[]) => dispatch({ type: 'shapes', shapes }) } : {})}
        />
      </div>

      <aside className="side">
        {opening && (
          <p className="opening-name" title="Opening name from the imported list">
            <strong>{opening.eco}</strong> {opening.name}
          </p>
        )}
        <EngineLines
          fen={node.fen}
          settings={settings}
          onSettings={setSettings}
          maxThreads={maxThreads}
          analysis={analysis}
          threat={threatPosition ? { fen: threatPosition, analysis: threat } : null}
          paused={!!retry}
          onPlayLine={pv => dispatch({ type: 'play', moves: pv })}
        />

        {!retry && (
          <ExplorerPanel
            fen={node.fen}
            standard={standard}
            signedIn={signedIn}
            onPlay={uci => {
              const m = decodeUci(uci);
              if (m) dispatch({ type: 'play', moves: [m as UciMove] });
            }}
          />
        )}

        <ReviewPanel
          moves={positions.length - 1}
          progress={review.progress}
          summary={summary}
          phaseNotes={phaseNotes}
          reviewed={reviewed}
          names={names}
          current={retry ? null : current}
          graph={retry ? null : graph}
          retryCounts={retryCounts}
          retry={retry}
          savedNote={savedNote}
          server={serverText(server, !!summary?.complete)}
          onServer={requestServer}
          onStart={review.start}
          onStop={review.stop}
          onJump={jump}
          onShowBest={showBest}
          onGoto={goto}
          onRetry={color => setRetry(startRetry(reviewed, color))}
          onRetryAction={onRetryAction}
        />

        <section className="panel">
          <TreeView root={root} path={state.path} onSelect={path => !retry && dispatch({ type: 'goto', path })} marks={marks} />
          <div className="nav row" aria-label="Move navigation">
            <button type="button" onClick={() => dispatch({ type: 'first' })} disabled={!!retry} title="Start (Home)" aria-label="Start position">⏮</button>
            <button type="button" onClick={() => dispatch({ type: 'prev' })} disabled={!!retry} title="Back (←)" aria-label="Previous move">◀</button>
            <button type="button" onClick={() => dispatch({ type: 'next' })} disabled={!!retry} title="Forward (→)" aria-label="Next move">▶</button>
            <button type="button" onClick={() => dispatch({ type: 'last' })} disabled={!!retry} title="End of line (End)" aria-label="End of line">⏭</button>
          </div>
          <div className="row tree-actions">
            <button
              type="button"
              onClick={() => {
                clearGame();
                dispatch({ type: 'load', tree: emptyTree() });
              }}
            >
              New analysis
            </button>
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
          onLoadPgn={text => {
            clearGame();
            dispatch({ type: 'load', tree: readPgn(text) });
          }}
          onLoadFen={text => {
            clearGame();
            dispatch({ type: 'load', tree: emptyTree(checkFen(text)) });
          }}
        />
      </aside>
    </main>
  );
}

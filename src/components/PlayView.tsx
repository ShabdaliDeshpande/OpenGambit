import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { Board } from './Board';
import { ClockDisplay } from './ClockDisplay';
import { GameControls } from './GameControls';
import { MoveList } from './MoveList';
import { PgnFenPanel } from './PgnFenPanel';
import { SetupPanel } from './SetupPanel';
import { opposite, remainingMs } from '../chess/clock';
import {
  buildChess,
  checkFen,
  createGame,
  DEFAULT_SETUP,
  exportPgn,
  fenAt,
  gameReducer,
  importPgn,
  isLive,
  liveFen,
  type GameSetup,
} from '../chess/game';
import { describeResult } from '../chess/gameEnd';
import { acceptsDraw } from '../engine/search';
import { useEngine } from '../hooks/useEngine';
import { useKeyboardNav } from '../hooks/useKeyboardNav';

const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');
const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

interface Props {
  /** Whether this view is on screen (keyboard shortcuts only apply then). */
  active: boolean;
  orientation: Color;
  setOrientation: (o: Color) => void;
  /** Opens the analysis board with this game's PGN. */
  onAnalyse: (pgn: string) => void;
}

export function PlayView({ active, orientation, setOrientation, onAnalyse }: Props) {
  const [game, dispatch] = useReducer(gameReducer, DEFAULT_SETUP, s => createGame(s));
  const [now, setNow] = useState(() => performance.now());
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngine();

  const { setup } = game;
  const live = liveFen(game);
  const turn = turnOf(live);
  const engineColor = setup.mode === 'computer' ? opposite(setup.humanColor) : null;
  const clockRunning = !!game.clock?.active && !game.result;

  // drive the clock display and flag detection (also while another tab is shown)
  useEffect(() => {
    if (!clockRunning) return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      dispatch({ type: 'tick', now: t });
    }, 100);
    return () => clearInterval(id);
  }, [clockRunning]);

  // ask the engine for a move whenever it is its turn
  useEffect(() => {
    if (!engineColor || game.result || turn !== engineColor) return;
    let cancelled = false;
    engine
      .requestMove({
        startFen: game.startFen,
        moves: game.moves.map(m => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })),
        level: setup.level,
      })
      .then(m => {
        if (cancelled || !m) return;
        dispatch({ type: 'move', from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}), now: performance.now() });
      })
      .catch(err => setNotice(`Engine error: ${err instanceof Error ? err.message : String(err)}`));
    return () => {
      cancelled = true;
      engine.cancel();
    };
    // re-run only when the position or game changes
  }, [game.id, game.moves.length, game.result, engineColor, turn]);

  const startGame = useCallback(
    (s: GameSetup, startFen?: string) => {
      dispatch({ type: 'new', setup: s, ...(startFen ? { startFen } : {}) });
      setOrientation(s.mode === 'computer' ? s.humanColor : 'w');
      setNotice(null);
      setNow(performance.now());
    },
    [setOrientation],
  );

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) =>
      dispatch({ type: 'move', from, to, ...(promotion ? { promotion } : {}), now: performance.now() }),
    [],
  );

  const view = (ply: number) => dispatch({ type: 'view', ply });
  useKeyboardNav(
    {
      prev: () => view(game.viewPly - 1),
      next: () => view(game.viewPly + 1),
      first: () => view(0),
      last: () => view(game.moves.length),
      flip: () => setOrientation(opposite(orientation)),
    },
    active,
  );

  const shownFen = fenAt(game, game.viewPly);
  const lastMove = game.viewPly > 0 ? (game.moves[game.viewPly - 1] ?? null) : null;
  const viewingLive = isLive(game);
  const movableColor = game.result || !viewingLive ? null : engineColor ? (turn === engineColor ? null : turn) : turn;
  const pgn = useMemo(() => exportPgn(game), [game]);

  const resultText = game.result ? describeResult(game.result) : null;
  const status = resultText
    ? resultText
    : !viewingLive
      ? `Viewing move ${game.viewPly} of ${game.moves.length}. Press → or End to return.`
      : engineColor && turn === engineColor
        ? 'Computer is thinking…'
        : `${colorName(turn)} to move${buildChess(game).inCheck() ? ' (check)' : ''}`;

  // in local play the buttons belong to the side to move, or to the side answering a draw offer
  const actor: Color = setup.mode === 'computer' ? setup.humanColor : game.drawOfferBy ? opposite(game.drawOfferBy) : turn;

  const offerDraw = () => {
    if (!engineColor) return dispatch({ type: 'offerDraw', color: actor });
    if (acceptsDraw(buildChess(game), engineColor)) {
      dispatch({ type: 'offerDraw', color: actor });
      dispatch({ type: 'acceptDraw', now: performance.now() });
    } else setNotice('The computer declines your draw offer.');
  };

  const playerLabel = (c: Color) =>
    setup.mode === 'computer' ? (c === setup.humanColor ? 'You' : `Computer · level ${setup.level}`) : colorName(c);

  const clockFor = (c: Color) =>
    game.clock && (
      <ClockDisplay ms={remainingMs(game.clock, c, now)} running={clockRunning && game.clock.active === c} label={colorName(c)} />
    );

  const top = opposite(orientation);
  const bottom = orientation;

  return (
    <main className="layout">
      <div className="board-wrap">
        <Board fen={shownFen} orientation={orientation} movableColor={movableColor} lastMove={lastMove} onMove={onMove} />
      </div>

      <aside className="side">
        <section className="panel game">
          <div className={`player top${turn === top && !game.result ? ' to-move' : ''}`}>
            <span className="name">{playerLabel(top)}</span>
            {clockFor(top)}
          </div>

          <MoveList moves={game.moves} startFen={game.startFen} viewPly={game.viewPly} resultText={game.result?.result ?? null} onSelect={view} />

          <div className="nav row" aria-label="Move navigation">
            <button type="button" onClick={() => view(0)} title="First (Home)" aria-label="First move">⏮</button>
            <button type="button" onClick={() => view(game.viewPly - 1)} title="Previous (←)" aria-label="Previous move">◀</button>
            <button type="button" onClick={() => view(game.viewPly + 1)} title="Next (→)" aria-label="Next move">▶</button>
            <button type="button" onClick={() => view(game.moves.length)} title="Last (End)" aria-label="Last move">⏭</button>
          </div>

          <p className={`status${game.result ? ' over' : ''}`} role="status">
            {status}
          </p>
          {notice && <p className="muted">{notice}</p>}

          <GameControls
            actor={actor}
            canAct={!game.result}
            drawOfferBy={game.drawOfferBy}
            onResign={() => dispatch({ type: 'resign', color: actor, now: performance.now() })}
            onOfferDraw={offerDraw}
            onAcceptDraw={() => dispatch({ type: 'acceptDraw', now: performance.now() })}
            onDeclineDraw={() => dispatch({ type: 'declineDraw' })}
          />

          <div className={`player bottom${turn === bottom && !game.result ? ' to-move' : ''}`}>
            <span className="name">{playerLabel(bottom)}</span>
            {clockFor(bottom)}
          </div>

          <button type="button" className="analyse-game" onClick={() => onAnalyse(pgn)} disabled={game.moves.length === 0}>
            🔍 Analyse this game
          </button>
        </section>

        <SetupPanel initial={setup} onStart={s => startGame(s)} />

        <PgnFenPanel
          pgn={pgn}
          fen={shownFen}
          onLoadPgn={text => {
            const state = importPgn(text, setup);
            dispatch({ type: 'replace', state });
            setOrientation('w');
            setNotice(null);
          }}
          onLoadFen={text => startGame(setup, checkFen(text))}
        />
      </aside>
    </main>
  );
}

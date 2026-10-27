import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { Board, type Arrow } from '../Board';
import { MoveList } from '../MoveList';
import { GameControls } from '../GameControls';
import { EvalBar } from '../analysis/EvalBar';
import { opposite } from '../../chess/clock';
import { buildChess, createGame, exportPgn, fenAt, gameReducer, isLive, liveFen, type GameState, type MoveRecord } from '../../chess/game';
import { describeResult } from '../../chess/gameEnd';
import type { Score } from '../../analysis/accuracy';
import { threatFen } from '../../analysis/rootSplit';
import { acceptsDraw, type AnalysisLine, type EngineMove, type UciMove } from '../../engine/search';
import { BOOK_PLIES } from '../../explorer/book';
import { fetchBookMove } from '../../explorer/fetchBookMove';
import { analyseOnce } from '../../hooks/evaluateOnce';
import { useEngine } from '../../hooks/useEngine';
import { useGameEndSound } from '../../hooks/useGameSounds';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { playSound } from '../../sound/sounds';
import { STYLE_LABEL, type Bot } from '../../bots/bots';
import { repertoireMove } from '../../bots/repertoire';
import { chatLine, endEvent, engineScore, moveEvent, wasBlunder } from '../../bots/chat';
import { activeAssists, ASSIST_KEYS, ASSIST_LABEL, needsAnalysis, resultValue, takeBackTo, type Assists, type BotMode } from '../../bots/botGame';
import { BotAvatar } from './BotAvatar';

/** An opening move (the bot's own line or the book) still waits a moment. */
const OPENING_REPLY_MS = 500;
/** Engine time for the assists on your turn. */
const ASSIST_MS = 900;

const uciOf = (m: Pick<MoveRecord, 'from' | 'to' | 'promotion'>): UciMove => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
const uciText = (m: UciMove) => m.from + m.to + (m.promotion ?? '');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function sanToUci(fen: string, san: string): UciMove | null {
  try {
    return uciOf(new Chess(fen).move(san));
  } catch {
    return null;
  }
}

const lineOf = (s: Score): AnalysisLine => ({ pv: [], cp: 'cp' in s ? s.cp : null, mate: 'mate' in s ? s.mate : null });

function startState(bot: Bot, player: Color, moves: readonly string[]): GameState {
  let s = createGame({ mode: 'computer', humanColor: player, level: 1, timeControlId: null });
  const name = `${bot.name} (OpenGambit bot)`;
  s = { ...s, headers: { Event: `Game against ${bot.name}`, White: player === 'w' ? 'You' : name, Black: player === 'b' ? 'You' : name } };
  for (const m of moves) s = gameReducer(s, { type: 'move', from: m.slice(0, 2) as Square, to: m.slice(2, 4) as Square, ...(m[4] ? { promotion: m[4] as PieceSymbol } : {}), now: 0 });
  return s;
}

interface Props {
  bot: Bot;
  player: Color;
  mode: BotMode;
  assists: Assists;
  /** Moves already played (a resumed game), in UCI. */
  moves: readonly string[];
  active: boolean;
  onAssists: (a: Assists) => void;
  /** The game so far, to keep in the browser; null once it's over. */
  onSave: (moves: string[] | null) => void;
  /** A finished Challenge game: 2 a win, 1 a draw, null a loss. */
  onResult: (value: 1 | 2 | null) => void;
  onAgain: () => void;
  onExit: () => void;
  onAnalyse: (pgn: string) => void;
}

/** A game against one bot, in Challenge or Assisted mode. */
export function BotGame({ bot, player, mode, assists, moves: initial, active, onAssists, onSave, onResult, onAgain, onExit, onAnalyse }: Props) {
  const [game, dispatch] = useReducer(gameReducer, undefined, () => startState(bot, player, initial));
  const [orientation, setOrientation] = useState<Color>(player);
  const [chat, setChat] = useState<{ text: string; n: number } | null>(() => {
    const text = initial.length === 0 ? chatLine(bot, 'start') : null;
    return text ? { text, n: 0 } : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [help, setHelp] = useState<{ ply: number; score: Score; best: UciMove | null } | null>(null);
  const [threat, setThreat] = useState<{ ply: number; move: UciMove | null } | null>(null);
  /** The bot's score after its last engine move, to spot your blunders. */
  const expect = useRef<Score | null>(null);
  const engine = useEngine();

  const botColor = opposite(player);
  const live = liveFen(game);
  const turn: Color = live.split(' ')[1] === 'b' ? 'b' : 'w';
  const shown = activeAssists(mode, assists);
  const analyse = needsAnalysis(shown);
  const say = (text: string | null) => text && setChat(c => ({ text, n: (c?.n ?? 0) + 1 }));

  useEffect(() => {
    playSound('start');
  }, []);
  useGameEndSound(!!game.result);

  // the bot's move: its own opening line, then master moves (if it uses them), then the engine
  useEffect(() => {
    if (game.result || turn !== botColor) return;
    let cancelled = false;
    const own = repertoireMove(bot.repertoire[botColor === 'w' ? 'white' : 'black'], game.moves.map(m => m.san));
    const ownMove = own ? sanToUci(live, own) : null;
    const choose = async (): Promise<{ move: UciMove | null; found: EngineMove | null }> => {
      if (ownMove) {
        await wait(OPENING_REPLY_MS);
        return { move: ownMove, found: null };
      }
      if (bot.book && game.moves.length < BOOK_PLIES) {
        const book = await fetchBookMove(live);
        if (book) {
          await wait(OPENING_REPLY_MS);
          return { move: book, found: null };
        }
      }
      const found = await engine.requestMove({ startFen: game.startFen, moves: game.moves.map(uciOf), level: 1, settings: bot.engine });
      return { move: found, found };
    };
    choose()
      .then(({ move, found }) => {
        if (cancelled || !move) return;
        const san = new Chess(live).move(move).san;
        // your blunder gets a comment first; otherwise the bot may comment on its own move
        const blundered = found && expect.current && wasBlunder(expect.current, engineScore(found.best, botColor), player);
        const event = blundered ? 'blunder' : moveEvent(san);
        if (event) say(chatLine(bot, event));
        expect.current = found ? engineScore(found.score, botColor) : null;
        dispatch({ type: 'move', ...move, now: performance.now() });
      })
      .catch(err => setNotice(`Engine error: ${err instanceof Error ? err.message : String(err)}`));
    return () => {
      cancelled = true;
      engine.cancel();
    };
    // re-run only when the position or game changes
  }, [game.id, game.moves.length, game.result, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // the end of the game: a last word, and the result for the bot's card
  useEffect(() => {
    if (!game.result) return;
    say(chatLine(bot, endEvent(game.result, botColor)));
    if (mode === 'challenge') onResult(resultValue(game.result, player));
  }, [game.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the game in progress in the browser
  useEffect(() => {
    onSave(game.result ? null : game.moves.map(m => uciText(uciOf(m))));
  }, [game.moves.length, game.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // assists: the engine's view of your position, and the bot's threat
  useEffect(() => {
    if (!analyse || game.result || turn !== player) return;
    const ply = game.moves.length;
    const job = analyseOnce(game.startFen, game.moves.map(uciOf), ASSIST_MS);
    let cancelled = false;
    void job.promise.then(r => !cancelled && setHelp({ ply, score: r.score, best: r.pv[0] ?? null }));
    return () => {
      cancelled = true;
      job.cancel();
    };
  }, [game.id, game.moves.length, game.result, turn, analyse]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shown.threats || game.result || turn !== player) return;
    const ply = game.moves.length;
    const fen = threatFen(live);
    if (!fen) return setThreat({ ply, move: null });
    const job = analyseOnce(fen, [], ASSIST_MS);
    let cancelled = false;
    void job.promise.then(r => !cancelled && setThreat({ ply, move: r.pv[0] ?? null }));
    return () => {
      cancelled = true;
      job.cancel();
    };
  }, [game.id, game.moves.length, game.result, turn, shown.threats]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = (ply: number) => dispatch({ type: 'view', ply });
  useKeyboardNav(
    {
      prev: () => view(game.viewPly - 1),
      next: () => view(game.viewPly + 1),
      first: () => view(0),
      last: () => view(game.moves.length),
      flip: () => setOrientation(o => opposite(o)),
    },
    active,
  );

  const viewingLive = isLive(game);
  const yourTurn = !game.result && viewingLive && turn === player;
  const fresh = help && help.ply === game.moves.length && yourTurn ? help : null;
  const freshThreat = threat && threat.ply === game.moves.length && yourTurn ? threat : null;
  const arrows = useMemo(() => {
    const out: Arrow[] = [];
    if (shown.bestMove && fresh?.best) out.push({ from: fresh.best.from, to: fresh.best.to, tone: 'best' });
    if (shown.threats && freshThreat?.move) out.push({ from: freshThreat.move.from, to: freshThreat.move.to, tone: 'threat' });
    return out;
  }, [shown.bestMove, shown.threats, fresh, freshThreat]);

  const takeBack = () => {
    const n = takeBackTo(game.moves, player);
    if (n === null) return;
    expect.current = null;
    setNotice(null);
    dispatch({ type: 'replace', state: { ...game, moves: game.moves.slice(0, n), viewPly: n, result: null, drawOfferBy: null } });
  };

  const offerDraw = () => {
    if (acceptsDraw(buildChess(game), botColor)) {
      dispatch({ type: 'offerDraw', color: player });
      dispatch({ type: 'acceptDraw', now: performance.now() });
    } else setNotice(`${bot.name} declines your draw offer.`);
  };

  const status = game.result
    ? describeResult(game.result)
    : !viewingLive
      ? `Viewing move ${game.viewPly} of ${game.moves.length}. Press → or End to return.`
      : turn === botColor
        ? `${bot.name} is thinking…`
        : `Your move${buildChess(game).inCheck() ? ' (check)' : ''}`;

  const lastMove = game.viewPly > 0 ? (game.moves[game.viewPly - 1] ?? null) : null;
  const canTakeBack = shown.takebacks && takeBackTo(game.moves, player) !== null;

  return (
    <main className="layout bot-game">
      <div className={`board-wrap${shown.evalBar ? ' with-eval' : ''}`}>
        {shown.evalBar && <EvalBar line={help ? lineOf(help.score) : null} orientation={orientation} />}
        <Board
          fen={fenAt(game, game.viewPly)}
          orientation={orientation}
          movableColor={yourTurn ? player : null}
          lastMove={lastMove}
          onMove={(from, to, promotion) => dispatch({ type: 'move', from, to, ...(promotion ? { promotion } : {}), now: performance.now() })}
          arrows={arrows}
          marks={shown.hints && fresh?.best ? [fresh.best.from] : []}
        />
      </div>

      <aside className="side">
        <section className="panel bot-header">
          <button type="button" className="link-button" onClick={onExit}>
            ← All bots
          </button>
          <div className="bot-who">
            <BotAvatar bot={bot} size={52} />
            <div>
              <h2>{bot.name}</h2>
              <p className="muted small">
                ≈{bot.rating} · {STYLE_LABEL[bot.style]} · {mode === 'challenge' ? 'Challenge' : 'Assisted'}
              </p>
            </div>
          </div>
          {chat && (
            <p key={chat.n} className="bot-chat" aria-live="polite">
              {chat.text}
            </p>
          )}
        </section>

        <section className="panel game">
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
          {canTakeBack && (
            <button type="button" onClick={takeBack}>
              ↶ Take back
            </button>
          )}
          <GameControls
            actor={player}
            canAct={!game.result}
            drawOfferBy={game.drawOfferBy}
            onResign={() => dispatch({ type: 'resign', color: player, now: performance.now() })}
            onOfferDraw={offerDraw}
            onAcceptDraw={() => dispatch({ type: 'acceptDraw', now: performance.now() })}
            onDeclineDraw={() => dispatch({ type: 'declineDraw' })}
          />
          {game.result && (
            <div className="row">
              <button type="button" className="primary" onClick={onAgain}>
                Play again
              </button>
              <button type="button" onClick={onExit}>
                Choose a bot
              </button>
            </div>
          )}
          <button type="button" className="analyse-game" onClick={() => onAnalyse(exportPgn(game))} disabled={game.moves.length === 0}>
            🔍 Analyse this game
          </button>
        </section>

        {mode === 'assisted' && (
          <section className="panel">
            <h2>Assists</h2>
            <div className="bot-assists">
              {ASSIST_KEYS.map(k => (
                <label key={k}>
                  <input type="checkbox" checked={assists[k]} onChange={e => onAssists({ ...assists, [k]: e.target.checked })} /> {ASSIST_LABEL[k]}
                </label>
              ))}
            </div>
            {analyse && yourTurn && !fresh && <p className="muted small">The engine is looking at your position…</p>}
            <p className="muted small">Assisted games don’t count on {bot.name}’s card. Play in Challenge mode for that.</p>
          </section>
        )}
      </aside>
    </main>
  );
}

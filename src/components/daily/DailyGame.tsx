import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { ApiError, ratingText } from '../../account/api';
import type { MoveRecord } from '../../chess/game';
import { daysLabel, timeLeftText } from '../../daily/rules';
import { dailyDraw, fetchDailyGame, playDailyMove, resignDaily, saveLines, type DailyGameView, type DailyPlayer } from '../../daily/api';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { Board } from '../Board';
import { Flair } from '../Flair';
import { MoveList } from '../MoveList';

const REFRESH_MS = 30_000;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
const uciOf = (from: string, to: string, promotion?: string) => from + to + (promotion ?? '');

function replay(moves: readonly string[]): { chess: Chess; records: MoveRecord[] } {
  const chess = new Chess();
  const records: MoveRecord[] = [];
  for (const m of moves) {
    const mv = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
    records.push({ san: mv.san, from: mv.from, to: mv.to, color: mv.color, fen: mv.after, ...(mv.promotion ? { promotion: mv.promotion } : {}) });
  }
  return { chess, records };
}

/** A line of UCI moves from `fen`, written in SAN. */
function lineText(fen: string, line: readonly string[]): string {
  const chess = new Chess(fen);
  try {
    return line.map(m => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) }).san).join(' ');
  } catch {
    return line.join(' ');
  }
}

const RESULT_TEXT = (g: DailyGameView) =>
  g.result === '1/2-1/2' ? 'Draw' : `${g.result === '1-0' ? g.white.name : g.black.name} won`;

interface Props {
  id: string;
  active: boolean;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onOpenTour: (id: string) => void;
  onAnalyse: (pgn: string) => void;
}

/** One daily game: moves, draws, resigning and conditional moves. */
export function DailyGame({ id, active, onBack, onOpenProfile, onOpenTour, onAnalyse }: Props) {
  const [game, setGame] = useState<DailyGameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Color>('w');
  const [confirmResign, setConfirmResign] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [lines, setLines] = useState<string[][]>([]);
  const [linesSaved, setLinesSaved] = useState(true);
  const [, tick] = useState(0);

  const load = useCallback(() => {
    fetchDailyGame(id)
      .then(g => {
        setGame(g);
        setError(null);
      })
      .catch(e => setError(errorText(e)));
  }, [id]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => tick(n => n + 1), 60_000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  // the orientation and saved lines follow the game as it loads
  useEffect(() => {
    if (!game) return;
    if (game.you) setOrientation(game.you);
    if (linesSaved) setLines(game.lines ?? []);
  }, [game?.id, game?.you, game?.moves.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const { chess, records } = useMemo(() => replay(game?.moves ?? []), [game?.moves]);
  const liveFen = chess.fen();
  const plies = records.length;
  const shownPly = viewPly === null ? plies : Math.min(viewPly, plies);

  const view = (ply: number) => setViewPly(ply >= plies ? null : Math.max(0, ply));
  useKeyboardNav({ prev: () => view(shownPly - 1), next: () => view(shownPly + 1), first: () => view(0), last: () => view(plies), flip: () => setOrientation(o => (o === 'w' ? 'b' : 'w')) }, active && draft === null);

  if (!game) return <main className="daily">{error ? <p className="error">{error}</p> : <p role="status">Loading the game…</p>}</main>;

  const playing = game.status === 'playing';
  const yourMove = playing && game.you !== null && game.turn === game.you;
  const waiting = playing && game.you !== null && game.turn !== game.you;

  const act = async (fn: () => Promise<DailyGameView | void>) => {
    try {
      const g = await fn();
      if (g) setGame(g);
      else load();
      setError(null);
    } catch (e) {
      setError(errorText(e));
      load();
    }
  };

  const onMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    const uci = uciOf(from, to, promotion);
    if (draft !== null) {
      const c = new Chess(liveFen);
      try {
        for (const m of [...draft, uci]) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
        setDraft([...draft, uci]);
      } catch {
        // not legal there: ignore
      }
      return;
    }
    if (yourMove && shownPly === plies) void act(() => playDailyMove(id, uci, plies));
  };

  // the board shows the draft line while you're preparing conditional moves
  const draftChess = draft ? (() => {
    const c = new Chess(liveFen);
    for (const m of draft) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
    return c;
  })() : null;
  const boardFen = draftChess ? draftChess.fen() : shownPly === plies ? liveFen : records[shownPly - 1]?.fen ?? new Chess().fen();
  const lastRecord = draftChess ? null : shownPly > 0 ? records[shownPly - 1] : null;
  const draftLast = draft?.at(-1);
  const movable: Color | null = draftChess ? draftChess.turn() : yourMove && shownPly === plies ? game.you : null;

  const addLine = () => {
    if (!draft || draft.length < 2) return;
    setLines(l => [...l, draft.slice(0, draft.length - (draft.length % 2))]);
    setLinesSaved(false);
    setDraft(null);
  };

  const pgn = () => {
    const c = new Chess();
    for (const r of records) c.move(r.san);
    c.setHeader('Event', game.tour ? `${game.tour.name} (daily)` : 'Daily game');
    c.setHeader('White', game.white.name);
    c.setHeader('Black', game.black.name);
    c.setHeader('TimeControl', `${game.days}d per move`);
    if (game.result) c.setHeader('Result', game.result);
    return c.pgn();
  };

  const player = (p: DailyPlayer, color: Color, where: 'top' | 'bottom') => (
    <div className={`player ${where}${playing && game.turn === color ? ' to-move' : ''}`}>
      <span className="name">
        <button type="button" className="link-button player-link" onClick={() => onOpenProfile(p.name)}>
          {p.name}
        </button>
        <Flair flair={p.flair} />
        {p.rating && <span className="muted rating"> {ratingText(p.rating)}</span>}
      </span>
      {playing && game.turn === color && <span className="daily-clock">{timeLeftText(game.deadline - Date.now())} left</span>}
    </div>
  );
  const top = orientation === 'w' ? 'b' : 'w';
  const side = (c: Color) => (c === 'w' ? game.white : game.black);
  const opponentName = game.you ? side(game.you === 'w' ? 'b' : 'w').name : '';

  return (
    <main className="layout daily-game">
      <div className="board-wrap">
        <Board
          fen={boardFen}
          orientation={orientation}
          movableColor={movable}
          lastMove={draftLast ? { from: draftLast.slice(0, 2) as Square, to: draftLast.slice(2, 4) as Square } : lastRecord ? { from: lastRecord.from, to: lastRecord.to } : null}
          onMove={onMove}
        />
      </div>
      <aside className="side">
        <section className="panel game">
          <button type="button" className="link-button" onClick={onBack}>
            ← Daily games
          </button>
          <p className="muted small">
            {daysLabel(game.days)} · {game.rated ? 'rated' : 'casual'}
            {game.tour && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => onOpenTour(game.tour!.id)}>
                  🏆 {game.tour.name}
                </button>
              </>
            )}
          </p>
          {player(side(top), top, 'top')}
          <MoveList moves={records} startFen={new Chess().fen()} viewPly={shownPly} resultText={game.result} onSelect={view} />
          <div className="nav row" aria-label="Move navigation">
            <button type="button" onClick={() => view(0)} aria-label="First move">⏮</button>
            <button type="button" onClick={() => view(shownPly - 1)} aria-label="Previous move">◀</button>
            <button type="button" onClick={() => view(shownPly + 1)} aria-label="Next move">▶</button>
            <button type="button" onClick={() => view(plies)} aria-label="Last move">⏭</button>
          </div>
          <p className={`status${playing ? '' : ' over'}`} role="status">
            {!playing
              ? `${RESULT_TEXT(game)} (${(game.reason ?? '').replace(/-/g, ' ')}).`
              : draft !== null
                ? 'Preparing a conditional line: play their move, then your reply.'
                : yourMove
                  ? `Your move · ${timeLeftText(game.deadline - Date.now())} left.`
                  : game.you
                    ? `Waiting for ${opponentName}.`
                    : `${game.turn === 'w' ? 'White' : 'Black'} to move.`}
          </p>
          {error && <p className="error">{error}</p>}
          {playing && game.you && game.drawOffer && game.drawOffer !== game.you && (
            <div className="offer" role="alert">
              <span>{opponentName} offers a draw.</span>
              <button type="button" className="primary" onClick={() => void act(() => dailyDraw(id, 'accept'))}>
                Accept
              </button>
              <button type="button" onClick={() => void act(() => dailyDraw(id, 'decline'))}>
                Decline
              </button>
            </div>
          )}
          {playing && game.you && (
            <div className="row">
              <button type="button" disabled={game.drawOffer === game.you} onClick={() => void act(() => dailyDraw(id, 'offer'))}>
                {game.drawOffer === game.you ? 'Draw offered' : '½ Offer draw'}
              </button>
              {confirmResign ? (
                <>
                  <button type="button" className="danger" onClick={() => void act(() => resignDaily(id))}>
                    Resign the game
                  </button>
                  <button type="button" onClick={() => setConfirmResign(false)}>
                    Keep playing
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmResign(true)}>
                  ⚑ Resign
                </button>
              )}
            </div>
          )}
          <button type="button" className="analyse-game" onClick={() => onAnalyse(pgn())} disabled={plies === 0}>
            🔍 Analyse this game
          </button>
        </section>

        {waiting && (
          <section className="panel daily-lines">
            <h2>Conditional moves</h2>
            <p className="muted small">Prepare replies while you wait. If {opponentName} plays the first move of a line, your reply is played straight away. Lines that don’t match are dropped.</p>
            {lines.length > 0 && (
              <ol>
                {lines.map((l, i) => (
                  <li key={i}>
                    <span>{lineText(liveFen, l)}</span>{' '}
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => {
                        setLines(ls => ls.filter((_x, k) => k !== i));
                        setLinesSaved(false);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {draft === null ? (
              <div className="row">
                <button type="button" onClick={() => setDraft([])}>
                  ✎ New line
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={linesSaved}
                  onClick={() =>
                    void saveLines(id, lines)
                      .then(saved => {
                        setLines(saved);
                        setLinesSaved(true);
                        setError(null);
                      })
                      .catch(e => setError(errorText(e)))
                  }
                >
                  {linesSaved ? 'Saved' : 'Save conditional moves'}
                </button>
              </div>
            ) : (
              <>
                <p className="small">{draft.length ? lineText(liveFen, draft) : 'Play the move you expect from your opponent.'}</p>
                <div className="row">
                  <button type="button" className="primary" disabled={draft.length < 2} onClick={addLine}>
                    Add this line
                  </button>
                  <button type="button" disabled={draft.length === 0} onClick={() => setDraft(draft.slice(0, -1))}>
                    Undo
                  </button>
                  <button type="button" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </aside>
    </main>
  );
}

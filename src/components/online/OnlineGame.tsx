import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { Board } from '../Board';
import { ClockDisplay } from '../ClockDisplay';
import { MoveList } from '../MoveList';
import { findTimeControl, opposite } from '../../chess/clock';
import { describeResult } from '../../chess/gameEnd';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useGameEndSound, useLowTimeWarning } from '../../hooks/useGameSounds';
import { resolvePremove, type Premove } from '../../chess/premove';
import { playSound } from '../../sound/sounds';
import type { OnlineClient, OnlineState } from '../../online/client';
import { clockMs, fenAfter, onlinePgn, replay, withPending } from '../../online/view';
import { diffText, ratingText } from '../../account/api';

const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');
const seconds = (ms: number) => Math.ceil(ms / 1000);

interface Props {
  gameId: string;
  active: boolean;
  client: OnlineClient;
  state: OnlineState;
  onBack: () => void;
  onAnalyse: (pgn: string) => void;
  onOpenProfile: (name: string) => void;
  backLabel: string;
}

export function OnlineGame({ gameId, active, client, state, onBack, onAnalyse, onOpenProfile, backLabel }: Props) {
  const received = state.games[gameId];
  const snap = received?.snap;
  const [pending, setPending] = useState<{ uci: string; ply: number } | null>(null);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [premove, setPremove] = useState<Premove | null>(null);
  const [now, setNow] = useState(() => performance.now());

  // the server's snapshot replaces the move we sent, whether it was accepted or not
  useEffect(() => {
    setPending(null);
  }, [received]);

  const error = state.error?.game === gameId ? state.error : null;
  useEffect(() => {
    if (error) setPending(null);
  }, [error]);

  const ticking = !!snap && snap.status === 'playing' && (snap.clock.running !== null || snap.firstMoveMs !== null || snap.opponentGone !== null);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [ticking]);

  const moves = useMemo(() => withPending(snap?.moves ?? [], pending), [snap, pending]);
  const records = useMemo(() => replay(moves), [moves]);
  const ply = viewPly === null ? records.length : Math.min(viewPly, records.length);
  const live = ply === records.length;
  const view = (p: number) => setViewPly(p >= records.length ? null : Math.max(0, p));

  const you = snap?.you ?? null;
  const orientation: Color = flipped ? opposite(you ?? 'w') : (you ?? 'w');
  const turn: Color = records.length % 2 === 0 ? 'w' : 'b';
  const playing = snap?.status === 'playing';
  const movable = playing && live && you === turn && !pending ? you : null;

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) => {
      if (!snap) return;
      const uci = `${from}${to}${promotion ?? ''}`;
      if (client.send({ t: 'move', game: gameId, uci, ply: snap.moves.length })) setPending({ uci, ply: snap.moves.length });
    },
    [client, gameId, snap],
  );

  useGameEndSound(!!snap && snap.status !== 'playing');
  // a start chime for players when a fresh game opens
  const greeted = useRef(false);
  useEffect(() => {
    if (!greeted.current && snap?.you && snap.status === 'playing' && snap.moves.length === 0) playSound('start');
    if (snap) greeted.current = true;
  }, [snap]);
  useLowTimeWarning(snap && you ? clockMs(snap, received!.at, now, you) : null, playing && snap?.clock.running === you);

  // play a queued premove the moment the opponent's move arrives
  useEffect(() => {
    if (!premove || !snap) return;
    if (snap.status !== 'playing') return setPremove(null);
    if (you !== turn || pending) return;
    const move = resolvePremove(fenAfter(records, records.length), premove);
    setPremove(null);
    if (move) onMove(move.from, move.to, move.promotion);
  }, [snap?.moves.length, snap?.status, turn]);

  useKeyboardNav(
    {
      prev: () => view(ply - 1),
      next: () => view(ply + 1),
      first: () => view(0),
      last: () => view(records.length),
      flip: () => setFlipped(f => !f),
    },
    active,
  );

  if (!snap || !received) {
    return (
      <main className="lobby">
        <section className="panel">
          <p role="status">{error ? error.message : 'Loading the game…'}</p>
          <button type="button" onClick={onBack}>
            ← Back to the lobby
          </button>
        </section>
      </main>
    );
  }

  const elapsed = now - received.at;
  const seat = (c: Color) => (c === 'w' ? snap.white : snap.black);
  const opponent = you ? seat(opposite(you)) : null;
  const tc = findTimeControl(snap.tc);
  const lastMove = ply > 0 ? (records[ply - 1] ?? null) : null;
  const send = (msg: Parameters<OnlineClient['send']>[0]) => client.send(msg);

  const status =
    snap.status === 'aborted'
      ? 'Game aborted.'
      : snap.result
        ? describeResult(snap.result)
        : !live
          ? `Viewing move ${ply} of ${records.length}. Press → or End to return.`
          : snap.firstMoveMs !== null
            ? `${you === turn ? 'Your' : `${colorName(turn)}’s`} first move: ${seconds(Math.max(0, snap.firstMoveMs - elapsed))} s, or the game is aborted.`
            : you
              ? you === turn
                ? 'Your turn.'
                : `Waiting for ${opponent?.name}…`
              : `${colorName(turn)} to move.`;

  const goneLeft = snap.opponentGone === null ? null : Math.max(0, snap.opponentGone - elapsed);

  const playerBar = (c: Color, where: 'top' | 'bottom') => {
    const s = seat(c);
    return (
      <div className={`player ${where}${playing && turn === c ? ' to-move' : ''}`}>
        <span className="name">
          <span className={`presence ${s.online ? 'on' : 'off'}`} title={s.online ? 'Connected' : 'Disconnected'} aria-label={s.online ? 'connected' : 'disconnected'} />
          {s.registered ? (
            <button type="button" className="link-button player-link" onClick={() => onOpenProfile(s.name)}>
              {s.name}
            </button>
          ) : (
            s.name
          )}
          {s.rating && <span className="muted rating"> {ratingText(s.rating)}</span>}
          {s.diff !== null && <strong className={`diff ${s.diff >= 0 ? 'up' : 'down'}`}> {diffText(s.diff)}</strong>}
          {you === c && <span className="muted"> (you)</span>}
          {snap.berserk[c] && <span title="Berserk: half the clock, an extra point for a win"> ⚡</span>}
        </span>
        <ClockDisplay ms={clockMs(snap, received.at, now, c)} running={playing && snap.clock.running === c} label={colorName(c)} />
      </div>
    );
  };

  return (
    <main className="layout online">
      <div className="board-wrap">
        <Board
          fen={fenAfter(records, ply)}
          orientation={orientation}
          movableColor={movable}
          lastMove={lastMove}
          onMove={onMove}
          premoveColor={playing && live && you ? you : null}
          premove={premove}
          onPremove={setPremove}
          onCancelPremove={() => setPremove(null)}
        />
      </div>

      <aside className="side">
        <section className="panel game">
          <p className="muted game-meta">
            {snap.tournament && <>🏆 {snap.tournament.name} · </>}
            {tc?.label ?? snap.tc} · {snap.rated ? 'Rated' : 'Casual'} · {you ? `playing ${colorName(you)}` : 'spectating'}
            {snap.spectators > 0 && ` · 👁 ${snap.spectators} watching`}
          </p>

          {playerBar(opposite(orientation), 'top')}

          <MoveList moves={records} startFen={fenAfter(records, 0)} viewPly={ply} resultText={snap.result?.result ?? null} onSelect={view} />

          <div className="nav row" aria-label="Move navigation">
            <button type="button" onClick={() => view(0)} title="First (Home)" aria-label="First move">⏮</button>
            <button type="button" onClick={() => view(ply - 1)} title="Previous (←)" aria-label="Previous move">◀</button>
            <button type="button" onClick={() => view(ply + 1)} title="Next (→)" aria-label="Next move">▶</button>
            <button type="button" onClick={() => view(records.length)} title="Last (End)" aria-label="Last move">⏭</button>
            <button type="button" onClick={() => setFlipped(f => !f)} title="Flip board (f)" aria-label="Flip board">⇅</button>
          </div>

          <p className={`status${playing ? '' : ' over'}`} role="status">
            {status}
          </p>
          {error && (
            <p className="error" role="alert" key={error.n}>
              {error.message}
            </p>
          )}

          {you && playing && goneLeft !== null && opponent && (
            <div className="offer" role="alert">
              {goneLeft > 0 ? (
                <span>
                  {opponent.name} left the game. You can claim victory in {seconds(goneLeft)} s.
                </span>
              ) : (
                <>
                  <span>{opponent.name} left the game.</span>
                  <button type="button" className="primary" onClick={() => send({ t: 'claim', game: gameId, outcome: 'win' })}>
                    Claim victory
                  </button>
                  <button type="button" onClick={() => send({ t: 'claim', game: gameId, outcome: 'draw' })}>
                    Call it a draw
                  </button>
                </>
              )}
            </div>
          )}

          {you && playing && (
            <div className="controls">
              {snap.drawOffer && snap.drawOffer !== you ? (
                <div className="offer" role="alert">
                  <span>{opponent?.name} offers a draw.</span>
                  <button type="button" className="primary" onClick={() => send({ t: 'draw', game: gameId, action: 'accept' })}>
                    Accept
                  </button>
                  <button type="button" onClick={() => send({ t: 'draw', game: gameId, action: 'decline' })}>
                    Decline
                  </button>
                </div>
              ) : snap.canBerserk || snap.canAbort ? (
                <>
                  {snap.canBerserk && (
                    <button type="button" className="berserk" onClick={() => send({ t: 'berserk', game: gameId })} title="Halve your clock for an extra point if you win">
                      ⚡ Berserk
                    </button>
                  )}
                  {snap.canAbort && (
                    <button type="button" onClick={() => send({ t: 'abort', game: gameId })} title="Abort the game (allowed until both sides have moved)">
                      ✕ Abort
                    </button>
                  )}
                </>
              ) : confirmResign ? (
                <div className="offer">
                  <span>Resign this game?</span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setConfirmResign(false);
                      send({ t: 'resign', game: gameId });
                    }}
                  >
                    Yes, resign
                  </button>
                  <button type="button" onClick={() => setConfirmResign(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => send({ t: 'draw', game: gameId, action: 'offer' })}
                    disabled={!snap.canOfferDraw}
                    title={snap.drawOffer === you ? 'Waiting for an answer' : 'Offer a draw'}
                  >
                    {snap.drawOffer === you ? 'Draw offered' : '½ Offer draw'}
                  </button>
                  <button type="button" onClick={() => setConfirmResign(true)} title="Resign">
                    ⚑ Resign
                  </button>
                </>
              )}
            </div>
          )}

          {playerBar(orientation, 'bottom')}

          {you && !playing && (snap.canRematch || snap.nextGame) && (
            <div className="controls rematch">
              {snap.nextGame ? (
                <span className="muted">Starting the rematch…</span>
              ) : snap.rematchOffer && snap.rematchOffer !== you ? (
                <div className="offer" role="alert">
                  <span>{opponent?.name} wants a rematch.</span>
                  <button type="button" className="primary" onClick={() => send({ t: 'rematch', game: gameId, offer: true })}>
                    Accept
                  </button>
                  <button type="button" onClick={() => send({ t: 'rematch', game: gameId, offer: false })}>
                    Decline
                  </button>
                </div>
              ) : snap.rematchOffer === you ? (
                <button type="button" onClick={() => send({ t: 'rematch', game: gameId, offer: false })} title="Withdraw the offer">
                  Rematch offered… (cancel)
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => send({ t: 'rematch', game: gameId, offer: true })}>
                  ↻ Rematch
                </button>
              )}
            </div>
          )}

          <div className="row">
            <button type="button" onClick={onBack}>
              {backLabel}
            </button>
            {!playing && (
              <button type="button" className="analyse-game" onClick={() => onAnalyse(onlinePgn(snap))} disabled={snap.moves.length === 0}>
                🔍 Analyse this game
              </button>
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}

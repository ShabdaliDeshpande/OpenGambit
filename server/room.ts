import { Chess } from 'chess.js';
import type { Color, PieceSymbol } from 'chess.js';
import { opposite, type TimeControl } from '../src/chess/clock.ts';
import {
  abandonedResult,
  noStartResult,
  agreementResult,
  detectBoardEnd,
  resignResult,
  timeoutResult,
  type GameResult,
} from '../src/chess/gameEnd.ts';
import type { DrawAction, GameSnapshot, GameStatus, ShownRating } from '../src/online/protocol.ts';
import type { ServerConfig } from './config.ts';
import type { Conn, Player } from './types.ts';

export interface TournamentRules {
  id: string;
  name: string;
  berserk: boolean;
  /** No draw offers before this many plies (Swiss). */
  drawMinPlies: number;
}

interface Seat {
  player: Player;
  lastDrawOfferPly: number;
  /** When the player's last connection to this game closed; null while connected. */
  offlineSince: number | null;
  /** The player closed the page on purpose, so the shorter timeout applies. */
  bye: boolean;
  /** Lag-compensation budget left, in ms. */
  quota: number;
}

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

/**
 * One game between two players. The server is authoritative: it validates
 * every move, keeps the clocks and decides how the game ends. Watchers
 * (players' connections and spectators) get a full snapshot after each change.
 */
export class GameRoom {
  readonly chess = new Chess();
  readonly moves: string[] = [];
  /** The mover's remaining time (ms, increment included) after each move, for insights. */
  readonly clocks: number[] = [];
  status: GameStatus = 'playing';
  result: GameResult | null = null;
  endedAt: number | null = null;
  readonly watchers = new Set<Conn>();

  private readonly seats: Record<Color, Seat>;
  private readonly remaining: Record<Color, number>;
  /** When the side to move started thinking. */
  private turnStart: number;
  private drawOffer: Color | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly id: string;
  readonly tc: TimeControl;
  readonly rated: boolean;
  readonly createdAt: number;
  /** Ratings shown next to the names (taken when the game started), and the change once scored. */
  readonly ratings: Record<Color, ShownRating | null>;
  readonly diffs: Record<Color, number | null> = { w: null, b: null };
  /** Set for tournament games: no abort, a missed first move loses, optional berserk. */
  readonly tournament: TournamentRules | null;
  readonly berserked: Record<Color, boolean> = { w: false, b: false };
  rematchOffer: Color | null = null;
  nextGame: string | null = null;
  private readonly startRematch: ((room: GameRoom) => string) | null;
  private readonly increment: Record<Color, number>;
  private readonly cfg: ServerConfig;
  private readonly onChange: (room: GameRoom) => void;

  constructor(
    id: string,
    tc: TimeControl,
    white: Player,
    black: Player,
    cfg: ServerConfig,
    onChange: (room: GameRoom) => void,
    options: {
      rated?: boolean;
      ratings?: Record<Color, ShownRating | null>;
      tournament?: TournamentRules;
      /** Starts the rematch game (colours swapped) and returns its id. */
      startRematch?: (room: GameRoom) => string;
    } = {},
  ) {
    this.id = id;
    this.tc = tc;
    this.cfg = cfg;
    this.onChange = onChange;
    this.rated = options.rated ?? false;
    this.ratings = options.ratings ?? { w: null, b: null };
    this.tournament = options.tournament ?? null;
    this.startRematch = options.startRematch ?? null;
    this.increment = { w: tc.incrementMs, b: tc.incrementMs };
    this.createdAt = cfg.now();
    const seat = (player: Player): Seat => ({
      player,
      lastDrawOfferPly: -Infinity,
      offlineSince: cfg.now(),
      bye: false,
      quota: cfg.lagQuotaStartMs,
    });
    this.seats = { w: seat(white), b: seat(black) };
    this.remaining = { w: tc.initialMs, b: tc.initialMs };
    this.turnStart = cfg.now();
    this.armFirstMove();
  }

  get plies(): number {
    return this.moves.length;
  }

  /** Clocks run once both sides have made their first move. */
  get clockRunning(): boolean {
    return this.status === 'playing' && this.plies >= 2;
  }

  /** Before both sides have made their first move. */
  get opening(): boolean {
    return this.status === 'playing' && this.plies < 2;
  }

  /** Casual and rated games can be aborted in the opening; tournament games can't. */
  get abortable(): boolean {
    return this.opening && !this.tournament;
  }

  player(color: Color): Player {
    return this.seats[color].player;
  }

  colorOf(player: Player | null): Color | null {
    if (!player) return null;
    return this.seats.w.player === player ? 'w' : this.seats.b.player === player ? 'b' : null;
  }

  isOnline(color: Color): boolean {
    for (const c of this.watchers) if (c.player === this.seats[color].player) return true;
    return false;
  }

  remainingMs(color: Color, now = this.cfg.now()): number {
    const left = this.remaining[color];
    return this.clockRunning && this.chess.turn() === color ? Math.max(0, left - (now - this.turnStart)) : left;
  }

  join(conn: Conn): void {
    this.watchers.add(conn);
    const color = this.colorOf(conn.player);
    if (color) {
      const seat = this.seats[color];
      seat.offlineSince = null;
      seat.bye = false;
      this.clearTimer(`gone-${color}`);
    }
    this.broadcast();
  }

  leave(conn: Conn): void {
    if (!this.watchers.delete(conn)) return;
    const color = this.colorOf(conn.player);
    if (color && !this.isOnline(color)) {
      this.seats[color].offlineSince = this.cfg.now();
      this.armGone(color);
    }
    this.broadcast();
  }

  /** The player is closing the page: a later disconnect uses the shorter timeout. */
  bye(player: Player): void {
    const color = this.colorOf(player);
    if (!color) return;
    this.seats[color].bye = true;
    if (this.seats[color].offlineSince !== null) this.armGone(color);
  }

  /** Returns an error message, or null when the move was played. */
  move(conn: Conn, uci: string, ply: number): string | null {
    if (this.status !== 'playing') return 'The game is over.';
    const color = this.colorOf(conn.player);
    if (!color) return 'You are not playing in this game.';
    if (color !== this.chess.turn()) return 'It is not your turn.';
    if (ply !== this.plies) return 'That move was for an older position.';
    const parsed = UCI.exec(uci);
    if (!parsed) return 'Illegal move.';
    const [, from, to, promotion] = parsed;
    const legal = this.chess
      .moves({ verbose: true })
      .find(m => m.from === from && m.to === to && (m.promotion ?? undefined) === (promotion ?? undefined));
    if (!legal) return 'Illegal move.';

    const now = this.cfg.now();
    const seat = this.seats[color];
    if (this.clockRunning) {
      const elapsed = Math.max(0, now - this.turnStart);
      const comp = Math.min(conn.lagMs, seat.quota, this.cfg.maxLagCompMs, elapsed);
      seat.quota = Math.min(this.cfg.lagQuotaMaxMs, seat.quota - comp + this.cfg.lagQuotaGainMs);
      const left = this.remaining[color] - (elapsed - comp);
      if (left <= 0) {
        this.remaining[color] = 0;
        this.end(timeoutResult(this.chess, color));
        return 'Your time ran out.';
      }
      this.remaining[color] = left + this.increment[color];
    }

    this.chess.move({ from: legal.from, to: legal.to, ...(legal.promotion ? { promotion: legal.promotion as PieceSymbol } : {}) });
    this.moves.push(uci);
    this.clocks.push(Math.round(this.remaining[color]));
    this.turnStart = now;
    // moving instead of answering declines the opponent's draw offer
    if (this.drawOffer === opposite(color)) this.drawOffer = null;

    const boardEnd = detectBoardEnd(this.chess);
    if (boardEnd) this.end(boardEnd);
    else {
      this.clearTimer('first-move');
      if (this.plies < 2) this.armFirstMove();
      else this.armFlag();
      // the game can no longer be aborted, so a player who is away now counts as gone
      if (this.plies === 2) for (const c of ['w', 'b'] as const) if (this.seats[c].offlineSince !== null) this.armGone(c);
      this.broadcast();
    }
    return null;
  }

  /**
   * After the game: offer a rematch, accept the opponent's offer (which starts
   * the new game with colours swapped), or withdraw / decline with offer=false.
   */
  rematch(conn: Conn, offer: boolean): string | null {
    const color = this.colorOf(conn.player);
    if (!color) return 'You are not playing in this game.';
    if (this.status === 'playing') return 'The game is still being played.';
    if (this.tournament || !this.startRematch) return 'Tournament games can’t be rematched.';
    if (this.nextGame) return null;
    if (!offer) this.rematchOffer = null;
    else if (this.rematchOffer === opposite(color)) {
      this.rematchOffer = null;
      this.nextGame = this.startRematch(this);
    } else this.rematchOffer = color;
    this.broadcast();
    return null;
  }

  /** Tournament option: halve your own clock and drop the increment, for an extra point on a win. */
  berserk(conn: Conn): string | null {
    const color = this.colorOf(conn.player);
    if (!color || !this.canBerserk(color)) return 'You can’t berserk now.';
    this.berserked[color] = true;
    this.remaining[color] = Math.floor(this.tc.initialMs / 2);
    this.increment[color] = 0;
    this.broadcast();
    return null;
  }

  resign(conn: Conn): string | null {
    const color = this.colorOf(conn.player);
    if (!color || this.status !== 'playing') return 'You can’t resign this game.';
    if (this.abortable) return this.abort(conn);
    this.end(resignResult(color));
    return null;
  }

  abort(conn: Conn): string | null {
    if (!this.colorOf(conn.player)) return 'You are not playing in this game.';
    if (!this.abortable) return 'The game can no longer be aborted.';
    this.end(null);
    return null;
  }

  draw(conn: Conn, action: DrawAction): string | null {
    const color = this.colorOf(conn.player);
    if (!color || this.status !== 'playing') return 'You can’t do that in this game.';
    const incoming = this.drawOffer === opposite(color);
    if (action === 'accept' || (action === 'offer' && incoming)) {
      if (!incoming) return 'There is no draw offer to accept.';
      this.end(agreementResult());
      return null;
    }
    if (action === 'decline') {
      if (incoming) this.drawOffer = null;
      this.broadcast();
      return null;
    }
    if (this.drawOffer === color) return null;
    if (!this.canOfferDraw(color)) return 'You can’t offer a draw again yet.';
    this.drawOffer = color;
    this.seats[color].lastDrawOfferPly = this.plies;
    this.broadcast();
    return null;
  }

  claim(conn: Conn, outcome: 'win' | 'draw'): string | null {
    const color = this.colorOf(conn.player);
    if (!color || this.status !== 'playing') return 'You can’t do that in this game.';
    if (this.goneFor(opposite(color)) !== 0) return 'Your opponent hasn’t been away long enough.';
    this.end(abandonedResult(outcome === 'win' ? color : null));
    return null;
  }

  snapshot(viewer: Conn | null): GameSnapshot {
    const now = this.cfg.now();
    const you = this.colorOf(viewer?.player ?? null);
    const seat = (c: Color) => ({
      id: this.seats[c].player.id,
      name: this.seats[c].player.name,
      online: this.isOnline(c),
      registered: this.seats[c].player.account !== null,
      rating: this.ratings[c],
      diff: this.diffs[c],
    });
    const spectators = [...this.watchers].filter(c => !this.colorOf(c.player)).length;
    return {
      id: this.id,
      tc: this.tc.id,
      rated: this.rated,
      white: seat('w'),
      black: seat('b'),
      you,
      moves: [...this.moves],
      status: this.status,
      result: this.result,
      clock: { w: this.remainingMs('w', now), b: this.remainingMs('b', now), running: this.clockRunning ? this.chess.turn() : null },
      firstMoveMs: this.opening ? Math.max(0, this.turnStart + this.cfg.firstMoveMs(this.tc) - now) : null,
      canAbort: this.abortable,
      tournament: this.tournament ? { id: this.tournament.id, name: this.tournament.name } : null,
      berserk: { ...this.berserked },
      canBerserk: you !== null && this.canBerserk(you),
      rematchOffer: this.rematchOffer,
      canRematch: you !== null && this.status !== 'playing' && !this.tournament && !!this.startRematch && !this.nextGame,
      nextGame: this.nextGame,
      drawOffer: this.drawOffer,
      canOfferDraw: you !== null && this.canOfferDraw(you),
      opponentGone: you ? this.goneFor(opposite(you), now) : null,
      spectators,
    };
  }

  broadcast(): void {
    for (const conn of this.watchers) conn.send({ t: 'game', game: this.snapshot(conn) });
    this.onChange(this);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private canBerserk(color: Color): boolean {
    // only before your own first move
    const ownMoves = color === 'w' ? Math.ceil(this.plies / 2) : Math.floor(this.plies / 2);
    return !!this.tournament?.berserk && this.status === 'playing' && ownMoves === 0 && !this.berserked[color];
  }

  private canOfferDraw(color: Color): boolean {
    return (
      this.status === 'playing' &&
      !this.opening &&
      this.plies >= (this.tournament?.drawMinPlies ?? 0) &&
      this.drawOffer === null &&
      this.plies - this.seats[color].lastDrawOfferPly >= this.cfg.drawOfferGapPlies
    );
  }

  private goneTimeout(color: Color): number {
    return this.seats[color].bye ? this.cfg.byeMs : Math.max(this.cfg.byeMs, this.cfg.disconnectMs(this.tc));
  }

  /** Ms until the opponent of `color` can claim (0 = now), or null if `color` isn't away. */
  private goneFor(color: Color, now = this.cfg.now()): number | null {
    const since = this.seats[color].offlineSince;
    if (since === null || this.status !== 'playing' || this.opening) return null;
    return Math.max(0, since + this.goneTimeout(color) - now);
  }

  /** Ends the game; a null result means it was aborted. */
  private end(result: GameResult | null): void {
    const now = this.cfg.now();
    if (this.clockRunning) {
      const turn = this.chess.turn();
      this.remaining[turn] = this.remainingMs(turn, now);
    }
    this.status = result ? 'finished' : 'aborted';
    this.result = result;
    this.drawOffer = null;
    this.endedAt = now;
    this.dispose();
    this.broadcast();
  }

  private armFirstMove(): void {
    this.setTimer('first-move', this.cfg.firstMoveMs(this.tc), () => {
      if (!this.opening) return;
      // in a tournament the player who didn't move loses; otherwise the game is called off
      this.end(this.tournament ? noStartResult(this.chess.turn()) : null);
    });
  }

  private armFlag(): void {
    const color = this.chess.turn();
    // give a move that is already on its way the same credit it would get on arrival
    const grace = Math.min(this.seats[color].quota, this.cfg.maxLagCompMs);
    this.setTimer('flag', this.remaining[color] + grace, () => {
      if (!this.clockRunning || this.chess.turn() !== color) return;
      this.remaining[color] = 0;
      this.end(timeoutResult(this.chess, color));
    });
  }

  private armGone(color: Color): void {
    const wait = this.goneFor(color);
    if (wait === null) return;
    // tell the opponent once the claim becomes available
    this.setTimer(`gone-${color}`, wait, () => this.broadcast());
  }

  private setTimer(name: string, ms: number, fn: () => void): void {
    this.clearTimer(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        fn();
      }, ms),
    );
  }

  private clearTimer(name: string): void {
    const t = this.timers.get(name);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(name);
  }
}

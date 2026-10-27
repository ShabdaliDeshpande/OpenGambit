// Daily (correspondence) chess: seeks, challenges, moves, draws, timeouts,
// reminders, conditional moves, vacations and notifications. Games are kept
// in the database while they're played; a finished one is saved like any
// other online game, rated in the correspondence category. A sweep every
// minute ends games past their deadline and sends reminders.

import { Chess } from 'chess.js';
import type { Color } from 'chess.js';
import { agreementResult, detectBoardEnd, resignResult, timeoutResult, type GameResult } from '../../src/chess/gameEnd.ts';
import {
  advanceConditional,
  checkConditional,
  DAY_MS,
  dailyTc,
  daysLabel,
  endVacation,
  isDaysPerMove,
  moveDeadline,
  onVacation,
  reminderAt,
  startVacation,
  timeLeftText,
  vacationLeft,
  VACATION_DAYS,
} from '../../src/daily/rules.ts';
import { HttpError } from '../http.ts';
import { currentGlicko, displayRating, type Store, type User } from '../store.ts';
import { DailyStore, newId, type DailyGame } from './dailyStore.ts';
import { DailyTours, type TourSpec } from './dailyTours.ts';

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export const DAILY_LIMITS = { seeksPerUser: 5, challengesPerUser: 10, gamesPerUser: 100 };

export interface DailyOptions {
  now?: () => number;
  random?: () => number;
}

function replay(moves: readonly string[]): Chess {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
  return chess;
}

function tryMove(chess: Chess, uci: string): boolean {
  if (!UCI.test(uci)) return false;
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
    return true;
  } catch {
    return false;
  }
}

export class DailyService {
  readonly ds: DailyStore;
  readonly tours: DailyTours;
  private readonly store: Store;
  readonly now: () => number;
  private readonly random: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Store, options: DailyOptions = {}) {
    this.store = store;
    this.ds = new DailyStore(store.db);
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.tours = new DailyTours(this.ds, {
      now: this.now,
      random: this.random,
      startGame: (tourId, white, black, days, rated) => this.createGame(white, black, days, rated, tourId),
      notify: (userId, text, tourId) => this.ds.notify(userId, 'tour', tourId, text, this.now()),
      rating: async userId => (await this.ratingOf(userId)).rating,
    });
  }

  /** Runs the sweep every `ms` (one minute by default). */
  start(ms = 60_000): void {
    this.stop();
    this.timer = setInterval(() => void this.sweep().catch(err => console.error('Daily sweep:', err)), ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async ratingOf(userId: string) {
    return displayRating(currentGlicko((await this.store.ratings(userId)).correspondence, this.now()));
  }

  private async player(id: string) {
    const u = (await this.ds.users([id])).get(id);
    return { id, name: u?.username ?? 'Deleted player', flair: u?.flair ?? null, rating: await this.ratingOf(id) };
  }

  private async noNewGames(user: User): Promise<void> {
    if (onVacation(await this.ds.vacation(user.id), this.now())) throw new HttpError(409, 'You’re on vacation. End it first to start new daily games.');
    if ((await this.ds.countGames(user.id)) >= DAILY_LIMITS.gamesPerUser) throw new HttpError(429, `You already have ${DAILY_LIMITS.gamesPerUser} daily games going.`);
  }

  // ---------------------------------------------------------------- games

  /** Starts a game; White's clock starts now. */
  async createGame(whiteId: string, blackId: string, days: number, rated: boolean, tourId: string | null = null): Promise<string> {
    const now = this.now();
    const deadline = moveDeadline(now, days, (await this.ds.vacation(whiteId)).until);
    const id = newId();
    await this.ds.insertGame({
      id,
      whiteId,
      blackId,
      days,
      rated,
      moves: [],
      turnStarted: now,
      deadline,
      remindAt: reminderAt(now, deadline),
      drawOffer: null,
      lines: { w: [], b: [] },
      tourId,
      createdAt: now,
    });
    const names = await this.ds.users([whiteId, blackId]);
    const label = `${daysLabel(days)}${rated ? ', rated' : ''}`;
    await this.ds.notify(whiteId, 'started', id, `New daily game against ${names.get(blackId)?.username ?? '?'} (${label}). You play White: your move.`, now);
    await this.ds.notify(blackId, 'started', id, `New daily game against ${names.get(whiteId)?.username ?? '?'} (${label}). You play Black.`, now);
    return id;
  }

  /** The game as its players and watchers see it; a finished one comes from the saved games. */
  async view(id: string, viewer: User | undefined) {
    const g = await this.ds.game(id);
    if (g) {
      const you: Color | null = viewer?.id === g.whiteId ? 'w' : viewer?.id === g.blackId ? 'b' : null;
      const tour = g.tourId ? await this.ds.tour(g.tourId) : undefined;
      return {
        id: g.id,
        status: 'playing' as const,
        days: g.days,
        rated: g.rated,
        white: await this.player(g.whiteId),
        black: await this.player(g.blackId),
        moves: g.moves,
        turn: (g.moves.length % 2 ? 'b' : 'w') as Color,
        turnStarted: g.turnStarted,
        deadline: g.deadline,
        drawOffer: g.drawOffer,
        you,
        lines: you ? g.lines[you] : null,
        tour: tour ? { id: tour.id, name: tour.name } : null,
        result: null,
        reason: null,
      };
    }
    const done = await this.store.game(id);
    if (!done || done.category !== 'correspondence') return null;
    const flair = await this.ds.users([done.whiteId ?? '', done.blackId ?? ''].filter(Boolean));
    const side = (c: 'white' | 'black') => ({
      id: done[`${c}Id`] ?? '',
      name: done[`${c}Name`],
      flair: flair.get(done[`${c}Id`] ?? '')?.flair ?? null,
      rating: done[`${c}Rating`] === null ? null : { rating: done[`${c}Rating`]!, provisional: false },
    });
    return {
      id: done.id,
      status: 'ended' as const,
      days: Number.parseInt(done.tc, 10) || 0,
      rated: done.rated,
      white: side('white'),
      black: side('black'),
      moves: done.moves,
      turn: (done.moves.length % 2 ? 'b' : 'w') as Color,
      turnStarted: done.endedAt,
      deadline: done.endedAt,
      drawOffer: null,
      you: (viewer?.id === done.whiteId ? 'w' : viewer?.id === done.blackId ? 'b' : null) as Color | null,
      lines: null,
      tour: null,
      result: done.result,
      reason: done.reason,
    };
  }

  /** A player's running daily games, the ones where it's their move first. */
  async myGames(user: User) {
    const games = await this.ds.gamesOf(user.id);
    const names = await this.ds.users(games.flatMap(g => [g.whiteId, g.blackId]));
    return games
      .map(g => {
        const you: Color = g.whiteId === user.id ? 'w' : 'b';
        const opponentId = you === 'w' ? g.blackId : g.whiteId;
        const turn: Color = g.moves.length % 2 ? 'b' : 'w';
        return {
          id: g.id,
          opponent: names.get(opponentId)?.username ?? 'Deleted player',
          opponentFlair: names.get(opponentId)?.flair ?? null,
          you,
          yourMove: turn === you,
          moves: g.moves,
          days: g.days,
          rated: g.rated,
          deadline: g.deadline,
          tourId: g.tourId,
        };
      })
      .sort((a, b) => Number(b.yourMove) - Number(a.yourMove) || a.deadline - b.deadline);
  }

  private async load(id: string, user: User): Promise<{ g: DailyGame; color: Color }> {
    const g = await this.ds.game(id);
    if (!g) throw new HttpError(404, 'No such daily game (it may have finished).');
    const color: Color | null = user.id === g.whiteId ? 'w' : user.id === g.blackId ? 'b' : null;
    if (!color) throw new HttpError(403, 'You’re not playing this game.');
    return { g, color };
  }

  /** Hands the move to `color`: its clock starts now, after any vacation it's on. */
  private async startTurn(g: DailyGame, color: Color, now: number): Promise<void> {
    const id = color === 'w' ? g.whiteId : g.blackId;
    g.turnStarted = now;
    g.deadline = moveDeadline(now, g.days, (await this.ds.vacation(id)).until);
    g.remindAt = reminderAt(now, g.deadline);
  }

  async move(user: User, id: string, uci: string, ply: number) {
    const { g, color } = await this.load(id, user);
    const chess = replay(g.moves);
    if (chess.turn() !== color) throw new HttpError(409, 'It’s not your move.');
    if (ply !== g.moves.length) throw new HttpError(409, 'The game has moved on. Reload it.');
    if (!tryMove(chess, uci)) throw new HttpError(400, 'That move isn’t legal.');
    const now = this.now();
    g.moves.push(uci);
    // moving answers a draw offer made to you with a no
    if (g.drawOffer === other(color)) g.drawOffer = null;
    await this.afterMove(g, chess, color, uci, now);
    return this.view(id, user);
  }

  /**
   * After `mover` played `uci`: the game may be over; otherwise the other
   * player's conditional lines may answer at once, and so on.
   */
  private async afterMove(g: DailyGame, chess: Chess, mover: Color, uci: string, now: number): Promise<void> {
    let color = mover;
    let last = uci;
    for (let steps = 0; steps < 64; steps++) {
      const end = detectBoardEnd(chess);
      if (end) return this.finish(g, end, now);
      const next = other(color);
      const answered = advanceConditional(g.lines[next], last);
      g.lines[next] = answered.lines;
      if (!answered.reply || !tryMove(chess, answered.reply)) {
        // an unexpected move (or an illegal reply) drops every line
        g.lines[next] = [];
        await this.startTurn(g, next, now);
        await this.ds.saveGame(g);
        const name = (await this.ds.users([color === 'w' ? g.whiteId : g.blackId])).get(color === 'w' ? g.whiteId : g.blackId)?.username ?? '?';
        await this.ds.notify(next === 'w' ? g.whiteId : g.blackId, 'move', g.id, `${name} moved. Your move (${timeLeftText(g.deadline - now)} left).`, now);
        return;
      }
      g.moves.push(answered.reply);
      const san = chess.history().at(-1);
      await this.ds.notify(next === 'w' ? g.whiteId : g.blackId, 'conditional', g.id, `Your conditional move ${san} was played.`, now);
      color = next;
      last = answered.reply;
    }
    await this.startTurn(g, other(color), now);
    await this.ds.saveGame(g);
  }

  async resign(user: User, id: string) {
    const { g, color } = await this.load(id, user);
    await this.finish(g, resignResult(color), this.now());
  }

  async draw(user: User, id: string, action: 'offer' | 'accept' | 'decline') {
    const { g, color } = await this.load(id, user);
    const now = this.now();
    const opponentId = color === 'w' ? g.blackId : g.whiteId;
    if (action === 'offer') {
      if (g.drawOffer === other(color)) return this.finish(g, agreementResult(), now);
      if (g.drawOffer === color) return;
      g.drawOffer = color;
      await this.ds.saveGame(g);
      await this.ds.notify(opponentId, 'move', g.id, `${user.username} offers a draw.`, now);
    } else if (action === 'accept') {
      if (g.drawOffer !== other(color)) throw new HttpError(409, 'There’s no draw offer to accept.');
      await this.finish(g, agreementResult(), now);
    } else {
      if (g.drawOffer !== other(color)) throw new HttpError(409, 'There’s no draw offer to decline.');
      g.drawOffer = null;
      await this.ds.saveGame(g);
      await this.ds.notify(opponentId, 'move', g.id, `${user.username} declined your draw offer.`, now);
    }
  }

  /** Saves your conditional lines; only while it's your opponent's move. */
  async setLines(user: User, id: string, raw: unknown): Promise<string[][]> {
    const { g, color } = await this.load(id, user);
    const chess = replay(g.moves);
    if (chess.turn() === color) throw new HttpError(409, 'Conditional moves are for while you wait: it’s your move now.');
    const lines = checkConditional(chess.fen(), raw);
    if (typeof lines === 'string') throw new HttpError(400, lines);
    g.lines[color] = lines;
    await this.ds.saveGame(g);
    return lines;
  }

  private async finish(g: DailyGame, result: GameResult, now: number): Promise<void> {
    const names = await this.ds.users([g.whiteId, g.blackId]);
    await this.store.finishGame({
      id: g.id,
      whiteId: g.whiteId,
      blackId: g.blackId,
      whiteName: names.get(g.whiteId)?.username ?? 'Deleted player',
      blackName: names.get(g.blackId)?.username ?? 'Deleted player',
      tc: dailyTc(g.days),
      category: 'correspondence',
      rated: g.rated,
      moves: g.moves,
      clocks: null,
      result: result.result,
      reason: result.reason,
      startedAt: g.createdAt,
      endedAt: now,
      tournamentId: g.tourId,
    });
    await this.ds.deleteGame(g.id);
    const text = (c: Color) =>
      `Your daily game against ${names.get(c === 'w' ? g.blackId : g.whiteId)?.username ?? '?'} ended: ${result.winner === null ? 'a draw' : result.winner === c ? 'you won' : 'you lost'} (${result.reason.replace(/-/g, ' ')}).`;
    await this.ds.notify(g.whiteId, 'ended', g.id, text('w'), now);
    await this.ds.notify(g.blackId, 'ended', g.id, text('b'), now);
    if (g.tourId) await this.tours.gameEnded(g.tourId, g.id, result.result, g.moves.length);
  }

  /** Ends games past their deadline, sends reminders and moves tournaments on. */
  async sweep(): Promise<void> {
    const now = this.now();
    for (const g of await this.ds.overdue(now)) {
      const chess = replay(g.moves);
      await this.finish(g, timeoutResult(chess, chess.turn()), now);
    }
    for (const g of await this.ds.remindersDue(now)) {
      const turn: Color = g.moves.length % 2 ? 'b' : 'w';
      g.remindAt = null;
      await this.ds.saveGame(g);
      const opponent = (await this.ds.users([turn === 'w' ? g.blackId : g.whiteId])).get(turn === 'w' ? g.blackId : g.whiteId)?.username ?? '?';
      await this.ds.notify(turn === 'w' ? g.whiteId : g.blackId, 'reminder', g.id, `Only ${timeLeftText(g.deadline - now)} left to move against ${opponent}.`, now);
    }
    await this.tours.sweep();
    await this.ds.pruneNotifications(now - 60 * DAY_MS);
  }

  // ---------------------------------------------------------------- seeks and challenges

  async seeks(viewer: User | undefined) {
    const seeks = await this.ds.seeks();
    const names = await this.ds.users(seeks.map(s => s.userId));
    return Promise.all(
      seeks.map(async s => ({
        id: s.id,
        name: names.get(s.userId)?.username ?? '?',
        flair: names.get(s.userId)?.flair ?? null,
        rating: await this.ratingOf(s.userId),
        days: s.days,
        color: s.color,
        rated: s.rated,
        mine: viewer?.id === s.userId,
      })),
    );
  }

  private static checkSpec(days: unknown, color: unknown, rated: unknown) {
    if (!isDaysPerMove(days)) throw new HttpError(400, 'Choose 1, 2, 3, 5, 7 or 14 days per move.');
    if (color !== 'w' && color !== 'b' && color !== 'random') throw new HttpError(400, 'Choose White, Black or random.');
    return { days, color: color as Color | 'random', rated: rated === true };
  }

  async createSeek(user: User, days: unknown, color: unknown, rated: unknown): Promise<string> {
    const spec = DailyService.checkSpec(days, color, rated);
    await this.noNewGames(user);
    const mine = (await this.ds.seeks()).filter(s => s.userId === user.id);
    if (mine.length >= DAILY_LIMITS.seeksPerUser) throw new HttpError(429, `You can have ${DAILY_LIMITS.seeksPerUser} open daily seeks at a time.`);
    const id = newId();
    await this.ds.insertSeek({ id, userId: user.id, ...spec, createdAt: this.now() });
    return id;
  }

  async cancelSeek(user: User, id: string): Promise<void> {
    const s = await this.ds.seek(id);
    if (!s || s.userId !== user.id) throw new HttpError(404, 'No such seek of yours.');
    await this.ds.takeSeek(id);
  }

  private sides(ownerId: string, otherId: string, color: Color | 'random'): [string, string] {
    const ownerWhite = color === 'random' ? this.random() < 0.5 : color === 'w';
    return ownerWhite ? [ownerId, otherId] : [otherId, ownerId];
  }

  async acceptSeek(user: User, id: string): Promise<string> {
    const s = await this.ds.seek(id);
    if (!s) throw new HttpError(404, 'That seek is gone.');
    if (s.userId === user.id) throw new HttpError(409, 'That’s your own seek.');
    await this.noNewGames(user);
    if (!(await this.ds.takeSeek(id))) throw new HttpError(404, 'That seek is gone.');
    const [white, black] = this.sides(s.userId, user.id, s.color);
    return this.createGame(white, black, s.days, s.rated);
  }

  async challenge(user: User, to: unknown, days: unknown, color: unknown, rated: unknown): Promise<string> {
    const spec = DailyService.checkSpec(days, color, rated);
    const target = typeof to === 'string' && to.length <= 40 ? await this.store.userByName(to) : undefined;
    if (!target) throw new HttpError(404, 'No player by that name.');
    if (target.id === user.id) throw new HttpError(400, 'You can’t challenge yourself.');
    await this.noNewGames(user);
    const outgoing = (await this.ds.challengesOf(user.id)).filter(c => c.fromId === user.id);
    if (outgoing.length >= DAILY_LIMITS.challengesPerUser) throw new HttpError(429, `You can have ${DAILY_LIMITS.challengesPerUser} open challenges at a time.`);
    const id = newId();
    await this.ds.insertChallenge({ id, fromId: user.id, toId: target.id, ...spec, createdAt: this.now() });
    await this.ds.notify(target.id, 'challenge', null, `${user.username} challenges you to a daily game (${daysLabel(spec.days)}${spec.rated ? ', rated' : ''}).`, this.now());
    return id;
  }

  async challenges(user: User) {
    const list = await this.ds.challengesOf(user.id);
    const names = await this.ds.users(list.flatMap(c => [c.fromId, c.toId]));
    return list.map(c => ({
      id: c.id,
      incoming: c.toId === user.id,
      name: names.get(c.toId === user.id ? c.fromId : c.toId)?.username ?? '?',
      flair: names.get(c.toId === user.id ? c.fromId : c.toId)?.flair ?? null,
      days: c.days,
      color: c.color,
      rated: c.rated,
      createdAt: c.createdAt,
    }));
  }

  async answerChallenge(user: User, id: string, action: 'accept' | 'decline' | 'cancel'): Promise<string | null> {
    const c = await this.ds.challenge(id);
    if (!c || (action === 'cancel' ? c.fromId !== user.id : c.toId !== user.id)) throw new HttpError(404, 'No such challenge.');
    if (action === 'accept') await this.noNewGames(user);
    if (!(await this.ds.takeChallenge(id))) throw new HttpError(404, 'No such challenge.');
    if (action === 'accept') {
      const [white, black] = this.sides(c.fromId, c.toId, c.color);
      return this.createGame(white, black, c.days, c.rated);
    }
    if (action === 'decline') await this.ds.notify(c.fromId, 'challenge', null, `${user.username} declined your daily challenge.`, this.now());
    return null;
  }

  // ---------------------------------------------------------------- vacation and notifications

  async vacation(user: User) {
    const v = await this.ds.vacation(user.id);
    const now = this.now();
    return { on: onVacation(v, now), until: onVacation(v, now) ? v.until : null, left: vacationLeft(v, now), perYear: VACATION_DAYS };
  }

  /** Starts or ends a vacation; the deadlines of games where it's your move move with it. */
  async setVacation(user: User, days: number | null) {
    const now = this.now();
    const v = await this.ds.vacation(user.id);
    const change = days === null ? endVacation(v, now) : startVacation(v, now, days);
    if (typeof change === 'string') throw new HttpError(409, change);
    // read first: queries outside the transaction would wait for it to finish
    const games = await this.ds.gamesOf(user.id);
    await this.store.db.transaction(async tx => {
      await this.ds.setVacation(user.id, change.vacation, tx);
      for (const g of games) {
        const turn: Color = g.moves.length % 2 ? 'b' : 'w';
        if ((turn === 'w' ? g.whiteId : g.blackId) !== user.id) continue;
        g.deadline += change.shift;
        g.remindAt = reminderAt(g.turnStarted, g.deadline) > now ? reminderAt(g.turnStarted, g.deadline) : null;
        await this.ds.saveGame(g, tx);
      }
    });
    if (days !== null) await this.ds.deleteSeeksOf(user.id);
    return this.vacation(user);
  }

  notifications = (user: User) => this.ds.notifications(user.id);
  markSeen = (user: User, ids: string[] | null) => this.ds.markSeen(user.id, ids);
  createTour = (user: User, spec: TourSpec) => this.tours.create(user.id, spec);
}

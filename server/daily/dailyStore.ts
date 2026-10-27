// Daily (correspondence) chess in the database: running games, open seeks,
// challenges, notifications, vacations and daily tournaments. A finished
// game moves to the ordinary games table (Store.finishGame).

import { randomBytes } from 'node:crypto';
import type { Color } from 'chess.js';
import type { Db, Queryable } from '../db/db.ts';
import type { Vacation } from '../../src/daily/rules.ts';

export interface DailyGame {
  id: string;
  whiteId: string;
  blackId: string;
  days: number;
  rated: boolean;
  /** Moves so far, in UCI. */
  moves: string[];
  /** When the side to move's turn began. */
  turnStarted: number;
  /** When the side to move loses on time. */
  deadline: number;
  /** When to remind the side to move; null once reminded. */
  remindAt: number | null;
  drawOffer: Color | null;
  /** Each player's conditional lines (the opponent's move, then their reply, …). */
  lines: Record<Color, string[][]>;
  tourId: string | null;
  createdAt: number;
}

export interface DailySeek {
  id: string;
  userId: string;
  days: number;
  color: Color | 'random';
  rated: boolean;
  createdAt: number;
}

export interface DailyChallenge {
  id: string;
  fromId: string;
  toId: string;
  days: number;
  color: Color | 'random';
  rated: boolean;
  createdAt: number;
}

export type NotificationKind = 'move' | 'reminder' | 'started' | 'ended' | 'challenge' | 'conditional' | 'tour';

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** The daily game it's about (or the tournament, for 'tour'). */
  link: string | null;
  text: string;
  createdAt: number;
  seen: boolean;
}

export interface DailyTourRow {
  id: string;
  kind: 'swiss' | 'arena';
  name: string;
  days: number;
  rated: boolean;
  createdBy: string | null;
  status: 'created' | 'started' | 'finished';
  startsAt: number;
  endsAt: number | null;
  nbRounds: number | null;
  round: number;
  data: string;
  createdAt: number;
}

export const newId = (bytes = 6) => randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x');

interface GameRow {
  id: string;
  white_id: string;
  black_id: string;
  days: number;
  rated: number;
  moves: string;
  turn_started: number;
  deadline: number;
  remind_at: number | null;
  draw_offer: string | null;
  white_lines: string;
  black_lines: string;
  tour_id: string | null;
  created_at: number;
}

const toGame = (r: GameRow): DailyGame => ({
  id: r.id,
  whiteId: r.white_id,
  blackId: r.black_id,
  days: Number(r.days),
  rated: !!Number(r.rated),
  moves: r.moves ? r.moves.split(' ') : [],
  turnStarted: Number(r.turn_started),
  deadline: Number(r.deadline),
  remindAt: r.remind_at === null ? null : Number(r.remind_at),
  drawOffer: r.draw_offer === 'w' || r.draw_offer === 'b' ? r.draw_offer : null,
  lines: { w: JSON.parse(r.white_lines) as string[][], b: JSON.parse(r.black_lines) as string[][] },
  tourId: r.tour_id,
  createdAt: Number(r.created_at),
});

const toSeek = (r: { id: string; user_id: string; days: number; color: string; rated: number; created_at: number }): DailySeek => ({
  id: r.id,
  userId: r.user_id,
  days: Number(r.days),
  color: r.color as DailySeek['color'],
  rated: !!Number(r.rated),
  createdAt: Number(r.created_at),
});

const toChallenge = (r: { id: string; from_id: string; to_id: string; days: number; color: string; rated: number; created_at: number }): DailyChallenge => ({
  id: r.id,
  fromId: r.from_id,
  toId: r.to_id,
  days: Number(r.days),
  color: r.color as DailyChallenge['color'],
  rated: !!Number(r.rated),
  createdAt: Number(r.created_at),
});

type TourRowDb = {
  id: string;
  kind: string;
  name: string;
  days: number;
  rated: number;
  created_by: string | null;
  status: string;
  starts_at: number;
  ends_at: number | null;
  nb_rounds: number | null;
  round: number;
  data: string;
  created_at: number;
};

const toTour = (r: TourRowDb): DailyTourRow => ({
  id: r.id,
  kind: r.kind as DailyTourRow['kind'],
  name: r.name,
  days: Number(r.days),
  rated: !!Number(r.rated),
  createdBy: r.created_by,
  status: r.status as DailyTourRow['status'],
  startsAt: Number(r.starts_at),
  endsAt: r.ends_at === null ? null : Number(r.ends_at),
  nbRounds: r.nb_rounds === null ? null : Number(r.nb_rounds),
  round: Number(r.round),
  data: r.data,
  createdAt: Number(r.created_at),
});

export class DailyStore {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // ------------------------------------------------------------ games

  async insertGame(g: DailyGame, q: Queryable = this.db): Promise<void> {
    await q.run(
      `INSERT INTO daily_games (id, white_id, black_id, days, rated, moves, turn_started, deadline, remind_at, draw_offer, white_lines, black_lines, tour_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [g.id, g.whiteId, g.blackId, g.days, g.rated ? 1 : 0, g.moves.join(' '), g.turnStarted, g.deadline, g.remindAt, g.drawOffer, JSON.stringify(g.lines.w), JSON.stringify(g.lines.b), g.tourId, g.createdAt],
    );
  }

  async saveGame(g: DailyGame, q: Queryable = this.db): Promise<void> {
    await q.run(
      `UPDATE daily_games SET moves = ?, turn_started = ?, deadline = ?, remind_at = ?, draw_offer = ?, white_lines = ?, black_lines = ? WHERE id = ?`,
      [g.moves.join(' '), g.turnStarted, g.deadline, g.remindAt, g.drawOffer, JSON.stringify(g.lines.w), JSON.stringify(g.lines.b), g.id],
    );
  }

  async deleteGame(id: string, q: Queryable = this.db): Promise<void> {
    await q.run('DELETE FROM daily_games WHERE id = ?', [id]);
  }

  async game(id: string, q: Queryable = this.db): Promise<DailyGame | undefined> {
    const row = await q.get<GameRow>('SELECT * FROM daily_games WHERE id = ?', [id]);
    return row && toGame(row);
  }

  async gamesOf(userId: string): Promise<DailyGame[]> {
    const rows = await this.db.all<GameRow>('SELECT * FROM daily_games WHERE white_id = ? OR black_id = ? ORDER BY deadline', [userId, userId]);
    return rows.map(toGame);
  }

  async countGames(userId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM daily_games WHERE white_id = ? OR black_id = ?', [userId, userId]);
    return Number(row?.n ?? 0);
  }

  async overdue(now: number): Promise<DailyGame[]> {
    return (await this.db.all<GameRow>('SELECT * FROM daily_games WHERE deadline <= ? ORDER BY deadline LIMIT 500', [now])).map(toGame);
  }

  async remindersDue(now: number): Promise<DailyGame[]> {
    return (await this.db.all<GameRow>('SELECT * FROM daily_games WHERE remind_at IS NOT NULL AND remind_at <= ? LIMIT 500', [now])).map(toGame);
  }

  // ------------------------------------------------------------ users

  async users(ids: readonly string[]): Promise<Map<string, { username: string; flair: string | null }>> {
    const out = new Map<string, { username: string; flair: string | null }>();
    for (const id of new Set(ids)) {
      const row = await this.db.get<{ username: string; flair: string | null }>('SELECT username, flair FROM users WHERE id = ?', [id]);
      if (row) out.set(id, { username: row.username, flair: row.flair ?? null });
    }
    return out;
  }

  async vacation(userId: string, q: Queryable = this.db): Promise<Vacation> {
    const row = await q.get<{ vacation_until: number | null; vacation_year: number; vacation_used: number }>(
      'SELECT vacation_until, vacation_year, vacation_used FROM users WHERE id = ?',
      [userId],
    );
    return { year: Number(row?.vacation_year ?? 0), used: Number(row?.vacation_used ?? 0), until: row?.vacation_until == null ? null : Number(row.vacation_until) };
  }

  async setVacation(userId: string, v: Vacation, q: Queryable = this.db): Promise<void> {
    await q.run('UPDATE users SET vacation_until = ?, vacation_year = ?, vacation_used = ? WHERE id = ?', [v.until, v.year, v.used, userId]);
  }

  // ------------------------------------------------------------ seeks and challenges

  async insertSeek(s: DailySeek): Promise<void> {
    await this.db.run('INSERT INTO daily_seeks (id, user_id, days, color, rated, created_at) VALUES (?, ?, ?, ?, ?, ?)', [s.id, s.userId, s.days, s.color, s.rated ? 1 : 0, s.createdAt]);
  }

  async seeks(): Promise<DailySeek[]> {
    return (await this.db.all<Parameters<typeof toSeek>[0]>('SELECT * FROM daily_seeks ORDER BY created_at DESC LIMIT 200')).map(toSeek);
  }

  async seek(id: string): Promise<DailySeek | undefined> {
    const row = await this.db.get<Parameters<typeof toSeek>[0]>('SELECT * FROM daily_seeks WHERE id = ?', [id]);
    return row && toSeek(row);
  }

  /** Deletes a seek; whether it was there (so two players can't both accept it). */
  async takeSeek(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM daily_seeks WHERE id = ?', [id])).changes > 0;
  }

  async deleteSeeksOf(userId: string): Promise<void> {
    await this.db.run('DELETE FROM daily_seeks WHERE user_id = ?', [userId]);
  }

  async insertChallenge(c: DailyChallenge): Promise<void> {
    await this.db.run('INSERT INTO daily_challenges (id, from_id, to_id, days, color, rated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      c.id,
      c.fromId,
      c.toId,
      c.days,
      c.color,
      c.rated ? 1 : 0,
      c.createdAt,
    ]);
  }

  async challenge(id: string): Promise<DailyChallenge | undefined> {
    const row = await this.db.get<Parameters<typeof toChallenge>[0]>('SELECT * FROM daily_challenges WHERE id = ?', [id]);
    return row && toChallenge(row);
  }

  async challengesOf(userId: string): Promise<DailyChallenge[]> {
    const rows = await this.db.all<Parameters<typeof toChallenge>[0]>('SELECT * FROM daily_challenges WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC', [userId, userId]);
    return rows.map(toChallenge);
  }

  async takeChallenge(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM daily_challenges WHERE id = ?', [id])).changes > 0;
  }

  // ------------------------------------------------------------ notifications

  async notify(userId: string, kind: NotificationKind, link: string | null, text: string, now: number): Promise<void> {
    await this.db.run('INSERT INTO notifications (id, user_id, kind, game_id, text, created_at, seen) VALUES (?, ?, ?, ?, ?, ?, 0)', [newId(9), userId, kind, link, text, now]);
  }

  async notifications(userId: string, limit = 30): Promise<{ list: Notification[]; unseen: number }> {
    const rows = await this.db.all<{ id: string; kind: string; game_id: string | null; text: string; created_at: number; seen: number }>(
      'SELECT id, kind, game_id, text, created_at, seen FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit],
    );
    const unseen = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND seen = 0', [userId]);
    return {
      list: rows.map(r => ({ id: r.id, kind: r.kind as NotificationKind, link: r.game_id, text: r.text, createdAt: Number(r.created_at), seen: !!Number(r.seen) })),
      unseen: Number(unseen?.n ?? 0),
    };
  }

  async markSeen(userId: string, ids: readonly string[] | null): Promise<void> {
    if (ids === null) await this.db.run('UPDATE notifications SET seen = 1 WHERE user_id = ?', [userId]);
    else for (const id of ids) await this.db.run('UPDATE notifications SET seen = 1 WHERE user_id = ? AND id = ?', [userId, id]);
  }

  /** Drops notifications older than `before`. */
  async pruneNotifications(before: number): Promise<void> {
    await this.db.run('DELETE FROM notifications WHERE created_at < ?', [before]);
  }

  // ------------------------------------------------------------ tournaments

  async insertTour(t: DailyTourRow): Promise<void> {
    await this.db.run(
      `INSERT INTO daily_tours (id, kind, name, days, rated, created_by, status, starts_at, ends_at, nb_rounds, round, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.kind, t.name, t.days, t.rated ? 1 : 0, t.createdBy, t.status, t.startsAt, t.endsAt, t.nbRounds, t.round, t.data, t.createdAt],
    );
  }

  async saveTour(t: DailyTourRow, q: Queryable = this.db): Promise<void> {
    await q.run('UPDATE daily_tours SET status = ?, round = ?, data = ? WHERE id = ?', [t.status, t.round, t.data, t.id]);
  }

  async tour(id: string, q: Queryable = this.db): Promise<DailyTourRow | undefined> {
    const row = await q.get<TourRowDb>('SELECT * FROM daily_tours WHERE id = ?', [id]);
    return row && toTour(row);
  }

  async tours(limit = 40): Promise<DailyTourRow[]> {
    return (await this.db.all<TourRowDb>("SELECT * FROM daily_tours ORDER BY CASE status WHEN 'finished' THEN 1 ELSE 0 END, starts_at DESC LIMIT ?", [limit])).map(toTour);
  }

  async activeTours(): Promise<DailyTourRow[]> {
    return (await this.db.all<TourRowDb>("SELECT * FROM daily_tours WHERE status <> 'finished'")).map(toTour);
  }

  async openToursBy(userId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM daily_tours WHERE created_by = ? AND status <> 'finished'", [userId]);
    return Number(row?.n ?? 0);
  }
}

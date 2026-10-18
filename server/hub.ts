import { randomBytes } from 'node:crypto';
import type { Color } from 'chess.js';
import { findTimeControl, type TimeControl } from '../src/chess/clock.ts';
import { SEEK_RANGES, type ClientMessage, type CreateTour, type LobbySnapshot, type SeekColor, type ServerMessage, type ShownRating } from '../src/online/protocol.ts';
import { speedOf, type ServerConfig } from './config.ts';
import { GameRoom, type TournamentRules } from './room.ts';
import { TournamentManager, type TourLimits } from './tournament/manager.ts';
import { currentGlicko, displayRating, type Store } from './store.ts';
import type { Account, Conn, Player } from './types.ts';

interface Seek {
  id: string;
  owner: Player;
  /** The lobby connection that created it; the seek goes away with it. */
  conn: Conn;
  tc: TimeControl;
  color: SeekColor;
  rated: boolean;
  range: number | null;
  createdAt: number;
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const GAME_ID = /^[A-Za-z0-9]{1,16}$/;

function randomId(length: number): string {
  const bytes = randomBytes(length);
  let id = '';
  for (const b of bytes) id += ID_CHARS[b % ID_CHARS.length];
  return id;
}

const isString = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;

/** Checks the shape of an incoming message; anything unexpected is dropped. */
function parseMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const game = isString(o.game, 16) && GAME_ID.test(o.game);
  switch (o.t) {
    case 'hello':
      return o.token === undefined || isString(o.token) ? { t: 'hello', ...(isString(o.token) ? { token: o.token } : {}) } : null;
    case 'pong':
      return typeof o.s === 'number' ? { t: 'pong', s: o.s } : null;
    case 'lobby':
      return typeof o.on === 'boolean' ? { t: 'lobby', on: o.on } : null;
    case 'seek':
      return isString(o.tc, 8) &&
        (o.color === 'w' || o.color === 'b' || o.color === 'random') &&
        (o.rated === undefined || typeof o.rated === 'boolean')
        ? {
            t: 'seek',
            tc: o.tc,
            color: o.color,
            rated: o.rated === true,
            range: SEEK_RANGES.includes(o.range as (typeof SEEK_RANGES)[number]) ? (o.range as number) : null,
          }
        : null;
    case 'cancelSeek':
    case 'acceptSeek':
      return isString(o.id, 16) ? { t: o.t, id: o.id } : null;
    case 'watch':
    case 'leave':
    case 'resign':
    case 'abort':
    case 'berserk':
      return game ? { t: o.t, game: o.game as string } : null;
    case 'rematch':
      return game && typeof o.offer === 'boolean' ? { t: 'rematch', game: o.game as string, offer: o.offer } : null;
    case 'tours':
      return typeof o.on === 'boolean' ? { t: 'tours', on: o.on } : null;
    case 'watchTour':
    case 'leaveTour':
    case 'joinTour':
    case 'withdrawTour':
      return isString(o.id, 16) && GAME_ID.test(o.id) ? { t: o.t, id: o.id } : null;
    case 'createTour': {
      const t = o.tour as Record<string, unknown> | null;
      if (!t || typeof t !== 'object') return null;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      return {
        t: 'createTour',
        tour: {
          kind: t.kind as CreateTour['kind'],
          name: isString(t.name, 60) ? t.name : '',
          tc: isString(t.tc, 8) ? t.tc : '',
          rated: t.rated === true,
          startInMin: num(t.startInMin),
          durationMin: num(t.durationMin),
          berserk: t.berserk === true,
          nbRounds: num(t.nbRounds),
          roundIntervalSec: num(t.roundIntervalSec),
        },
      };
    }
    case 'move':
      return game && isString(o.uci, 5) && Number.isInteger(o.ply)
        ? { t: 'move', game: o.game as string, uci: o.uci, ply: o.ply as number }
        : null;
    case 'draw':
      return game && (o.action === 'offer' || o.action === 'accept' || o.action === 'decline')
        ? { t: 'draw', game: o.game as string, action: o.action }
        : null;
    case 'claim':
      return game && (o.outcome === 'win' || o.outcome === 'draw') ? { t: 'claim', game: o.game as string, outcome: o.outcome } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

/**
 * Everything the game server knows, kept in memory: anonymous players, the
 * lobby's open seeks and the game rooms. It doesn't know about sockets; the
 * transport calls connect / receive / disconnect.
 */
export class Hub {
  /** Guests by token. */
  private readonly players = new Map<string, Player>();
  /** Signed-in players by user id. */
  private readonly accounts = new Map<string, Player>();
  private readonly conns = new Set<Conn>();
  private readonly seeks = new Map<string, Seek>();
  private readonly rooms = new Map<string, GameRoom>();
  private nextConnId = 1;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private readonly cleanup = new Set<ReturnType<typeof setTimeout>>();

  private readonly cfg: ServerConfig;
  private readonly store: Store | null;
  private readonly announced = new Set<string>();
  private readonly writes = new Set<Promise<void>>();

  readonly tournaments: TournamentManager;

  constructor(cfg: ServerConfig, store: Store | null = null, tourLimits: Partial<TourLimits> = {}) {
    this.cfg = cfg;
    this.store = store;
    this.pingTimer = setInterval(() => this.pingAll(), cfg.pingMs);
    this.tournaments = new TournamentManager(
      {
        now: () => this.cfg.now(),
        random: () => this.cfg.random(),
        isOnline: userId => (this.accounts.get(userId)?.conns.size ?? 0) > 0,
        liveAccount: userId => this.accounts.get(userId)?.account ?? null,
        startGame: (tc, white, black, rated, rules) => this.startGame(tc, this.accountPlayer(white), this.accountPlayer(black), rated, rules),
      },
      store,
      tourLimits,
    );
  }

  stop(): void {
    clearInterval(this.pingTimer);
    this.tournaments.stop();
    for (const t of this.cleanup) clearTimeout(t);
    for (const room of this.rooms.values()) room.dispose();
  }

  room(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  /** Resolves once every finished game handed to the database has been saved. */
  async settled(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes]);
    await this.tournaments.settled();
  }

  connect(send: (msg: ServerMessage) => void, close: () => void, account: Account | null = null): Conn {
    const now = this.cfg.now();
    const conn: Conn = {
      id: this.nextConnId++,
      player: null,
      account,
      send,
      close,
      lobby: false,
      rooms: new Set(),
      lagMs: 0,
      lastPong: now,
      tokens: this.cfg.rateBurst,
      tokensAt: now,
    };
    this.conns.add(conn);
    return conn;
  }

  disconnect(conn: Conn): void {
    if (!this.conns.delete(conn)) return;
    if (conn.player) {
      conn.player.conns.delete(conn);
      conn.player.lastSeen = this.cfg.now();
    }
    for (const id of conn.rooms) this.rooms.get(id)?.leave(conn);
    for (const seek of this.seeks.values()) if (seek.conn === conn) this.seeks.delete(seek.id);
    this.tournaments.dropConn(conn);
    this.broadcastLobby();
  }

  receive(conn: Conn, raw: string): void {
    if (!this.allow(conn)) return;
    const msg = parseMessage(raw);
    if (!msg) return;
    if (msg.t === 'hello') return this.hello(conn, msg.token);
    if (msg.t === 'pong') return this.pong(conn, msg.s);
    const player = conn.player;
    if (!player) return;

    switch (msg.t) {
      case 'lobby':
        conn.lobby = msg.on;
        if (!msg.on) this.dropSeeks(s => s.conn === conn);
        if (msg.on) conn.send({ t: 'lobby', lobby: this.lobbySnapshot() });
        return;
      case 'seek':
        return this.report(conn, this.seek(conn, player, msg.tc, msg.color, msg.rated, msg.range ?? null));
      case 'cancelSeek': {
        const seek = this.seeks.get(msg.id);
        if (seek?.owner === player) this.dropSeeks(s => s === seek);
        return;
      }
      case 'acceptSeek': {
        const seek = this.seeks.get(msg.id);
        if (!seek) return this.report(conn, 'That seek is no longer available.');
        if (seek.owner === player) return this.report(conn, 'You can’t accept your own seek.');
        if (seek.rated && !player.account) return this.report(conn, 'Sign in to play rated games.');
        if (!this.inRange(seek, player)) return this.report(conn, 'Your rating is outside the range this player asked for.');
        const ownerColor: Color = seek.color === 'random' ? (this.cfg.random() < 0.5 ? 'w' : 'b') : seek.color;
        this.startGame(seek.tc, ownerColor === 'w' ? seek.owner : player, ownerColor === 'w' ? player : seek.owner, seek.rated);
        return;
      }
      case 'watch': {
        const room = this.rooms.get(msg.game);
        if (!room) return conn.send({ t: 'error', message: 'Game not found.', game: msg.game });
        if (conn.rooms.has(room.id)) return conn.send({ t: 'game', game: room.snapshot(conn) });
        conn.rooms.add(room.id);
        room.join(conn);
        return;
      }
      case 'leave':
        if (conn.rooms.delete(msg.game)) this.rooms.get(msg.game)?.leave(conn);
        return;
      case 'bye':
        for (const id of conn.rooms) this.rooms.get(id)?.bye(player);
        return;
      case 'tours':
        return this.tournaments.setListening(conn, msg.on);
      case 'watchTour':
        return this.tournaments.watch(conn, msg.id);
      case 'leaveTour':
        return this.tournaments.unwatch(conn, msg.id);
      case 'createTour':
        return this.report(conn, this.tournaments.create(conn, msg.tour));
      case 'joinTour':
        return this.report(conn, this.tournaments.join(conn, msg.id), msg.id);
      case 'withdrawTour':
        return this.report(conn, this.tournaments.withdraw(conn, msg.id), msg.id);
      default: {
        const room = this.rooms.get(msg.game);
        if (!room) return conn.send({ t: 'error', message: 'Game not found.', game: msg.game });
        const error =
          msg.t === 'move'
            ? room.move(conn, msg.uci, msg.ply)
            : msg.t === 'resign'
              ? room.resign(conn)
              : msg.t === 'abort'
                ? room.abort(conn)
                : msg.t === 'draw'
                  ? room.draw(conn, msg.action)
                  : msg.t === 'berserk'
                    ? room.berserk(conn)
                    : msg.t === 'rematch'
                      ? room.rematch(conn, msg.offer)
                      : room.claim(conn, msg.outcome);
        if (error) {
          conn.send({ t: 'error', message: error, game: room.id });
          // resync the sender's board after a rejected move
          if (conn.rooms.has(room.id)) conn.send({ t: 'game', game: room.snapshot(conn) });
        }
      }
    }
  }

  lobbySnapshot(): LobbySnapshot {
    const online = [...this.players.values(), ...this.accounts.values()].filter(p => p.conns.size > 0).length;
    return {
      seeks: [...this.seeks.values()].map(s => ({
        id: s.id,
        owner: s.owner.id,
        name: s.owner.name,
        registered: s.owner.account !== null,
        rating: this.shownRating(s.owner, s.tc),
        tc: s.tc.id,
        color: s.color,
        rated: s.rated,
        range: s.range,
        createdAt: s.createdAt,
      })),
      games: [...this.rooms.values()]
        .filter(r => r.status === 'playing')
        .map(r => ({ id: r.id, tc: r.tc.id, rated: r.rated, white: r.player('w').name, black: r.player('b').name })),
      online,
    };
  }

  private hello(conn: Conn, token: string | undefined): void {
    if (conn.player) return;
    let player: Player | undefined;
    if (conn.account) {
      // the same account in several tabs is one player
      const { user } = conn.account;
      player = this.accounts.get(user.id);
      if (!player) {
        player = { id: user.id, token: '', name: user.username, account: conn.account, conns: new Set(), lastSeen: this.cfg.now() };
        this.accounts.set(user.id, player);
      }
    } else player = token && TOKEN.test(token) ? this.players.get(token) : undefined;
    if (!player) {
      const fresh = randomBytes(18).toString('base64url');
      player = {
        id: randomId(8),
        token: fresh,
        name: `Guest ${1000 + Math.floor(this.cfg.random() * 9000)}`,
        account: null,
        conns: new Set(),
        lastSeen: this.cfg.now(),
      };
      this.players.set(fresh, player);
    }
    conn.player = player;
    player.conns.add(conn);
    conn.send({ t: 'welcome', token: player.account ? null : player.token, id: player.id, name: player.name, registered: !!player.account });
    // a reconnecting player is told about their unfinished games
    for (const room of this.rooms.values())
      if (room.status === 'playing' && room.colorOf(player)) conn.send({ t: 'started', game: room.id });
    this.broadcastLobby();
  }

  private pong(conn: Conn, sentAt: number): void {
    const now = this.cfg.now();
    const rtt = now - sentAt;
    if (rtt < 0 || rtt > 10_000) return;
    conn.lastPong = now;
    // smoothed one-way lag
    conn.lagMs = conn.lagMs === 0 ? rtt / 2 : conn.lagMs * 0.7 + (rtt / 2) * 0.3;
  }

  private pingAll(): void {
    const now = this.cfg.now();
    for (const conn of this.conns) {
      if (now - conn.lastPong > this.cfg.staleMs) {
        conn.close();
        this.disconnect(conn);
      } else conn.send({ t: 'ping', s: now });
    }
    this.forgetIdlePlayers(now);
  }

  /** Guests who left long ago and aren't in a running game are dropped, so memory stays bounded. */
  private forgetIdlePlayers(now: number): void {
    const seated = new Set<Player>();
    for (const room of this.rooms.values()) if (room.status === 'playing') seated.add(room.player('w')).add(room.player('b'));
    for (const map of [this.players, this.accounts])
      for (const [key, p] of map)
        if (p.conns.size === 0 && now - p.lastSeen > this.cfg.playerTtlMs && !seated.has(p)) map.delete(key);
  }

  /** Whether `player` may take `seek`: a seek with a range needs a rating within it. */
  private inRange(seek: Seek, player: Player): boolean {
    if (seek.range === null || !seek.owner.account) return true;
    const mine = this.shownRating(player, seek.tc);
    const theirs = this.shownRating(seek.owner, seek.tc);
    return !!mine && !!theirs && Math.abs(mine.rating - theirs.rating) <= seek.range;
  }

  private seek(conn: Conn, player: Player, tcId: string, color: SeekColor, rated: boolean, range: number | null): string | null {
    const tc = findTimeControl(tcId);
    if (!tc) return 'Unknown time control.';
    if (!conn.lobby) return 'Open the lobby to create a seek.';
    if (rated && !player.account) return 'Sign in to play rated games.';
    const own = [...this.seeks.values()].filter(s => s.owner === player);
    if (own.some(s => s.tc.id === tc.id && s.color === color && s.rated === rated)) return 'You already have that seek.';
    if (own.length >= this.cfg.maxSeeksPerPlayer) return `You can have at most ${this.cfg.maxSeeksPerPlayer} seeks.`;

    // pair at once with a compatible seek from someone else, oldest first
    const match = [...this.seeks.values()].find(
      s =>
        s.owner !== player &&
        s.tc.id === tc.id &&
        s.rated === rated &&
        (s.color === 'random' || color === 'random' || s.color !== color) &&
        // both ranges must allow the other player
        this.inRange(s, player) &&
        this.inRange({ ...s, owner: player, range: player.account ? range : null }, s.owner),
    );
    if (match) {
      const ownerColor: Color =
        match.color !== 'random' ? match.color : color !== 'random' ? (color === 'w' ? 'b' : 'w') : this.cfg.random() < 0.5 ? 'w' : 'b';
      this.startGame(tc, ownerColor === 'w' ? match.owner : player, ownerColor === 'w' ? player : match.owner, rated);
      return null;
    }
    const seek: Seek = { id: randomId(8), owner: player, conn, tc, color, rated, range: player.account ? range : null, createdAt: this.cfg.now() };
    this.seeks.set(seek.id, seek);
    this.broadcastLobby();
    return null;
  }

  private shownRating(player: Player, tc: TimeControl): ShownRating | null {
    if (!player.account) return null;
    return displayRating(currentGlicko(player.account.ratings[speedOf(tc)], this.cfg.now()));
  }

  /** The player for an account, created if they aren't connected right now (tournament pairings). */
  private accountPlayer(account: Account): Player {
    let player = this.accounts.get(account.user.id);
    if (!player) {
      player = { id: account.user.id, token: '', name: account.user.username, account, conns: new Set(), lastSeen: this.cfg.now() };
      this.accounts.set(account.user.id, player);
    }
    return player;
  }

  private startGame(tc: TimeControl, white: Player, black: Player, rated: boolean, tournament?: TournamentRules): string {
    let id = randomId(8);
    while (this.rooms.has(id)) id = randomId(8);
    const room = new GameRoom(id, tc, white, black, this.cfg, r => this.roomChanged(r), {
      rated: rated && !!white.account && !!black.account,
      ratings: { w: this.shownRating(white, tc), b: this.shownRating(black, tc) },
      ...(tournament ? { tournament } : { startRematch: (r: GameRoom) => this.startGame(r.tc, r.player('b'), r.player('w'), r.rated) }),
    });
    this.rooms.set(id, room);
    // both players are now busy: their other seeks go away
    this.dropSeeks(s => s.owner === white || s.owner === black, false);
    for (const p of [white, black]) for (const c of p.conns) c.send({ t: 'started', game: id });
    this.broadcastLobby();
    return id;
  }

  private roomChanged(room: GameRoom): void {
    if (room.status === 'playing' || this.announced.has(room.id)) return;
    // the game just ended: update the lobby's list and forget the room later
    this.announced.add(room.id);
    this.broadcastLobby();
    if (room.status === 'finished') this.save(room);
    if (room.tournament) this.tournaments.gameEnded(room);
    const timer = setTimeout(() => {
      this.cleanup.delete(timer);
      this.announced.delete(room.id);
      room.dispose();
      this.rooms.delete(room.id);
      for (const c of room.watchers) c.rooms.delete(room.id);
    }, this.cfg.finishedTtlMs);
    this.cleanup.add(timer);
  }

  /** Stores a finished game that involves an account, and scores it if it was rated. */
  private save(room: GameRoom): void {
    const [white, black] = [room.player('w'), room.player('b')];
    if (!this.store || !room.result || (!white.account && !black.account)) return;
    const category = speedOf(room.tc);
    const write = this.store
      .finishGame({
        id: room.id,
        whiteId: white.account?.user.id ?? null,
        blackId: black.account?.user.id ?? null,
        whiteName: white.name,
        blackName: black.name,
        tc: room.tc.id,
        category,
        rated: room.rated,
        moves: room.moves,
        result: room.result.result,
        reason: room.result.reason,
        startedAt: room.createdAt,
        tournamentId: room.tournament?.id ?? null,
        endedAt: room.endedAt ?? this.cfg.now(),
      })
      .then(change => {
        if (!change) return;
        const now = this.cfg.now();
        for (const [player, side, color] of [
          [white, change.white, 'w'],
          [black, change.black, 'b'],
        ] as const) {
          const info = player.account!.ratings[category];
          player.account!.ratings[category] = { glicko: side.after, games: info.games + 1, updatedAt: now };
          room.diffs[color] = Math.round(side.after.rating) - Math.round(side.before.rating);
        }
        room.broadcast();
      })
      .catch(err => console.error(`Could not save game ${room.id}:`, err))
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
  }

  private dropSeeks(match: (s: Seek) => boolean, broadcast = true): void {
    let changed = false;
    for (const s of this.seeks.values())
      if (match(s)) {
        this.seeks.delete(s.id);
        changed = true;
      }
    if (changed && broadcast) this.broadcastLobby();
  }

  private broadcastLobby(): void {
    const lobby = this.lobbySnapshot();
    for (const conn of this.conns) if (conn.lobby) conn.send({ t: 'lobby', lobby });
  }

  private report(conn: Conn, error: string | null, tour?: string): void {
    if (error) conn.send({ t: 'error', message: error, ...(tour ? { tour } : {}) });
  }

  /** Token-bucket rate limit per connection. */
  private allow(conn: Conn): boolean {
    const now = this.cfg.now();
    conn.tokens = Math.min(this.cfg.rateBurst, conn.tokens + ((now - conn.tokensAt) / 1000) * this.cfg.ratePerSecond);
    conn.tokensAt = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }
}

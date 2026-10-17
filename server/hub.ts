import { randomBytes } from 'node:crypto';
import type { Color } from 'chess.js';
import { findTimeControl, type TimeControl } from '../src/chess/clock.ts';
import type { ClientMessage, LobbySnapshot, SeekColor, ServerMessage } from '../src/online/protocol.ts';
import type { ServerConfig } from './config.ts';
import { GameRoom } from './room.ts';
import type { Conn, Player } from './types.ts';

interface Seek {
  id: string;
  owner: Player;
  /** The lobby connection that created it; the seek goes away with it. */
  conn: Conn;
  tc: TimeControl;
  color: SeekColor;
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
      return isString(o.tc, 8) && (o.color === 'w' || o.color === 'b' || o.color === 'random')
        ? { t: 'seek', tc: o.tc, color: o.color }
        : null;
    case 'cancelSeek':
    case 'acceptSeek':
      return isString(o.id, 16) ? { t: o.t, id: o.id } : null;
    case 'watch':
    case 'leave':
    case 'resign':
    case 'abort':
      return game ? { t: o.t, game: o.game as string } : null;
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
  private readonly players = new Map<string, Player>();
  private readonly conns = new Set<Conn>();
  private readonly seeks = new Map<string, Seek>();
  private readonly rooms = new Map<string, GameRoom>();
  private nextConnId = 1;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private readonly cleanup = new Set<ReturnType<typeof setTimeout>>();

  private readonly cfg: ServerConfig;
  private readonly announced = new Set<string>();

  constructor(cfg: ServerConfig) {
    this.cfg = cfg;
    this.pingTimer = setInterval(() => this.pingAll(), cfg.pingMs);
  }

  stop(): void {
    clearInterval(this.pingTimer);
    for (const t of this.cleanup) clearTimeout(t);
    for (const room of this.rooms.values()) room.dispose();
  }

  room(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  connect(send: (msg: ServerMessage) => void, close: () => void): Conn {
    const now = this.cfg.now();
    const conn: Conn = {
      id: this.nextConnId++,
      player: null,
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
        return this.report(conn, this.seek(conn, player, msg.tc, msg.color));
      case 'cancelSeek': {
        const seek = this.seeks.get(msg.id);
        if (seek?.owner === player) this.dropSeeks(s => s === seek);
        return;
      }
      case 'acceptSeek': {
        const seek = this.seeks.get(msg.id);
        if (!seek) return this.report(conn, 'That seek is no longer available.');
        if (seek.owner === player) return this.report(conn, 'You can’t accept your own seek.');
        const ownerColor: Color = seek.color === 'random' ? (this.cfg.random() < 0.5 ? 'w' : 'b') : seek.color;
        this.startGame(seek.tc, ownerColor === 'w' ? seek.owner : player, ownerColor === 'w' ? player : seek.owner);
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
    const online = [...this.players.values()].filter(p => p.conns.size > 0).length;
    return {
      seeks: [...this.seeks.values()].map(s => ({
        id: s.id,
        owner: s.owner.id,
        name: s.owner.name,
        tc: s.tc.id,
        color: s.color,
        createdAt: s.createdAt,
      })),
      games: [...this.rooms.values()]
        .filter(r => r.status === 'playing')
        .map(r => ({ id: r.id, tc: r.tc.id, white: r.player('w').name, black: r.player('b').name })),
      online,
    };
  }

  private hello(conn: Conn, token: string | undefined): void {
    if (conn.player) return;
    let player = token && TOKEN.test(token) ? this.players.get(token) : undefined;
    if (!player) {
      const fresh = randomBytes(18).toString('base64url');
      player = {
        id: randomId(8),
        token: fresh,
        name: `Guest ${1000 + Math.floor(this.cfg.random() * 9000)}`,
        conns: new Set(),
        lastSeen: this.cfg.now(),
      };
      this.players.set(fresh, player);
    }
    conn.player = player;
    player.conns.add(conn);
    conn.send({ t: 'welcome', token: player.token, id: player.id, name: player.name });
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
    for (const [token, p] of this.players)
      if (p.conns.size === 0 && now - p.lastSeen > this.cfg.playerTtlMs && !seated.has(p)) this.players.delete(token);
  }

  private seek(conn: Conn, player: Player, tcId: string, color: SeekColor): string | null {
    const tc = findTimeControl(tcId);
    if (!tc) return 'Unknown time control.';
    if (!conn.lobby) return 'Open the lobby to create a seek.';
    const own = [...this.seeks.values()].filter(s => s.owner === player);
    if (own.some(s => s.tc.id === tc.id && s.color === color)) return 'You already have that seek.';
    if (own.length >= this.cfg.maxSeeksPerPlayer) return `You can have at most ${this.cfg.maxSeeksPerPlayer} seeks.`;

    // pair at once with a compatible seek from someone else, oldest first
    const match = [...this.seeks.values()].find(
      s => s.owner !== player && s.tc.id === tc.id && (s.color === 'random' || color === 'random' || s.color !== color),
    );
    if (match) {
      const ownerColor: Color =
        match.color !== 'random' ? match.color : color !== 'random' ? (color === 'w' ? 'b' : 'w') : this.cfg.random() < 0.5 ? 'w' : 'b';
      this.startGame(tc, ownerColor === 'w' ? match.owner : player, ownerColor === 'w' ? player : match.owner);
      return null;
    }
    const seek: Seek = { id: randomId(8), owner: player, conn, tc, color, createdAt: this.cfg.now() };
    this.seeks.set(seek.id, seek);
    this.broadcastLobby();
    return null;
  }

  private startGame(tc: TimeControl, white: Player, black: Player): void {
    let id = randomId(8);
    while (this.rooms.has(id)) id = randomId(8);
    const room = new GameRoom(id, tc, white, black, this.cfg, r => this.roomChanged(r));
    this.rooms.set(id, room);
    // both players are now busy: their other seeks go away
    this.dropSeeks(s => s.owner === white || s.owner === black, false);
    for (const p of [white, black]) for (const c of p.conns) c.send({ t: 'started', game: id });
    this.broadcastLobby();
  }

  private roomChanged(room: GameRoom): void {
    if (room.status === 'playing' || this.announced.has(room.id)) return;
    // the game just ended: update the lobby's list and forget the room later
    this.announced.add(room.id);
    this.broadcastLobby();
    const timer = setTimeout(() => {
      this.cleanup.delete(timer);
      this.announced.delete(room.id);
      room.dispose();
      this.rooms.delete(room.id);
      for (const c of room.watchers) c.rooms.delete(room.id);
    }, this.cfg.finishedTtlMs);
    this.cleanup.add(timer);
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

  private report(conn: Conn, error: string | null): void {
    if (error) conn.send({ t: 'error', message: error });
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

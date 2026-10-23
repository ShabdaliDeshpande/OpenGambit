import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testHub } from './testUtils.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('players and connections', () => {
  it('gives a new player a token and name, and recognises the token later', () => {
    const { join } = testHub();
    const a = join();
    const welcome = a.last('welcome')!;
    expect(welcome.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(welcome.name).toMatch(/^Guest \d{4}$/);
    const again = join(welcome.token);
    expect(again.last('welcome')).toEqual(welcome);
  });

  it('ignores malformed messages and anything before hello', () => {
    const { client } = testHub();
    const c = client();
    c.send({ t: 'lobby', on: true });
    c.send({ t: 'nonsense' });
    expect(c.inbox).toEqual([]);
    c.send({ t: 'hello', token: 42 });
    expect(c.inbox).toEqual([]);
  });

  it('rate limits a flood of messages', () => {
    const { join } = testHub({ rateBurst: 30 });
    const a = join();
    for (let i = 0; i < 100; i++) a.send({ t: 'lobby', on: true });
    expect(a.inbox.filter(m => m.t === 'lobby').length).toBeLessThanOrEqual(30);
  });

  it('measures lag from pings and closes silent connections', () => {
    const { hub, join, cfg } = testHub({ staleMs: 20_000 });
    const a = join();
    vi.advanceTimersByTime(cfg.pingMs);
    const ping = a.last('ping')!;
    vi.advanceTimersByTime(80);
    a.send({ t: 'pong', s: ping.s });
    expect(a.conn.lagMs).toBe(40);
    vi.advanceTimersByTime(cfg.staleMs + cfg.pingMs);
    expect(a.closed).toBe(true);
    expect(hub.lobbySnapshot().online).toBe(0);
  });
});

describe('memory', () => {
  it('forgets guests who left long ago, but not players in a running game', () => {
    const { join, pair, disconnect, cfg } = testHub({ playerTtlMs: 60_000, firstMoveMs: () => 600_000 });
    const idle = join();
    const idleToken = idle.last('welcome')!.token;
    const { b } = pair();
    const playingToken = b.last('welcome')!.token;
    disconnect(idle);
    disconnect(b);
    vi.advanceTimersByTime(60_000 + cfg.pingMs);
    expect(join(idleToken).last('welcome')!.token).not.toBe(idleToken);
    expect(join(playingToken).last('welcome')!.token).toBe(playingToken);
  });
});

describe('lobby', () => {
  it('lists seeks to everyone in the lobby and lets the owner cancel', () => {
    const { join } = testHub();
    const a = join();
    const b = join();
    a.send({ t: 'lobby', on: true });
    b.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '3+2', color: 'random' });
    const seek = b.last('lobby')!.lobby.seeks[0]!;
    expect(seek).toMatchObject({ tc: '3+2', color: 'random', name: a.last('welcome')!.name });
    b.send({ t: 'cancelSeek', id: seek.id }); // not b's seek
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(1);
    a.send({ t: 'cancelSeek', id: seek.id });
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(0);
  });

  it('rejects unknown time controls, duplicates, too many seeks and seeking outside the lobby', () => {
    const { join } = testHub({ maxSeeksPerPlayer: 2 });
    const a = join();
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    a.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '7+7', color: 'w' });
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    a.send({ t: 'seek', tc: '1+0', color: 'b' });
    a.send({ t: 'seek', tc: '10+0', color: 'b' });
    expect(a.errors()).toEqual([
      'Open the lobby to create a seek.',
      'Unknown time control.',
      'You already have that seek.',
      'You can have at most 2 seeks.',
    ]);
    expect(a.last('lobby')!.lobby.seeks).toHaveLength(2);
  });

  it('removes a seek when its owner leaves the lobby or disconnects', () => {
    const { join, disconnect } = testHub();
    const a = join();
    const b = join();
    b.send({ t: 'lobby', on: true });
    a.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    a.send({ t: 'lobby', on: false });
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(0);
    a.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(1);
    disconnect(a);
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(0);
  });

  it('accepting a seek starts a game with the requested colours', () => {
    const { join, hub } = testHub();
    const a = join();
    const b = join();
    a.send({ t: 'lobby', on: true });
    b.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '5+0', color: 'b' });
    const seek = b.last('lobby')!.lobby.seeks[0]!;
    a.send({ t: 'acceptSeek', id: seek.id });
    expect(a.errors()).toContain('You can’t accept your own seek.');
    b.send({ t: 'acceptSeek', id: seek.id });
    const id = a.last('started')!.game;
    expect(b.last('started')!.game).toBe(id);
    const room = hub.room(id)!;
    expect(room.player('w').id).toBe(b.last('welcome')!.id);
    expect(room.player('b').id).toBe(a.last('welcome')!.id);
    expect(b.last('lobby')!.lobby).toMatchObject({ seeks: [], games: [{ id, tc: '5+0' }] });
    b.send({ t: 'acceptSeek', id: seek.id });
    expect(b.errors()).toContain('That seek is no longer available.');
  });

  it('pairs compatible seeks automatically and drops the players’ other seeks', () => {
    const { join, hub } = testHub();
    const a = join();
    const b = join();
    for (const c of [a, b]) c.send({ t: 'lobby', on: true });
    a.send({ t: 'seek', tc: '5+0', color: 'w' });
    a.send({ t: 'seek', tc: '1+0', color: 'random' });
    b.send({ t: 'seek', tc: '5+0', color: 'w' }); // both want White: no match
    expect(b.last('lobby')!.lobby.seeks).toHaveLength(3);
    b.send({ t: 'seek', tc: '1+0', color: 'b' }); // matches a's random 1+0 seek
    const id = b.last('started')!.game;
    const room = hub.room(id)!;
    expect(room.tc.id).toBe('1+0');
    expect(room.player('w').id).toBe(a.last('welcome')!.id);
    expect(b.last('lobby')!.lobby.seeks).toEqual([]);
  });
});

describe('game rooms', () => {
  it('validates moves on the server and shares them with everyone watching', () => {
    const { pair, join } = testHub();
    const { a, b, id, move } = pair();
    const spectator = join();
    spectator.send({ t: 'watch', game: id });
    expect(spectator.game()).toMatchObject({ you: null, spectators: 1 });

    b.send({ t: 'move', game: id, uci: 'e7e5', ply: 0 });
    spectator.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    a.send({ t: 'move', game: id, uci: 'e2e5', ply: 0 });
    a.send({ t: 'move', game: id, uci: 'e2e4', ply: 3 });
    expect(b.errors()).toEqual(['It is not your turn.']);
    expect(spectator.errors()).toEqual(['You are not playing in this game.']);
    expect(a.errors()).toEqual(['Illegal move.', 'That move was for an older position.']);

    move(a, 'e2e4');
    expect(spectator.game().moves).toEqual(['e2e4']);
    expect(b.game()).toMatchObject({ you: 'b', moves: ['e2e4'] });
  });

  it('requires the promotion piece', () => {
    const { pair } = testHub();
    const { a, b, id, move } = pair();
    for (const [w, bl] of [['h2h4', 'g7g5'], ['h4g5', 'h7h6'], ['g5h6', 'f8g7'], ['h6g7', 'g8f6']]) {
      move(a, w!);
      move(b, bl!);
    }
    // the pawn on g7 takes the rook on h8
    a.send({ t: 'move', game: id, uci: 'g7h8', ply: 8 });
    expect(a.errors()).toEqual(['Illegal move.']);
    move(a, 'g7h8n');
    expect(a.game().moves.at(-1)).toBe('g7h8n');
  });

  it('starts the clocks only after both first moves, then charges thinking time minus lag', () => {
    const { pair } = testHub();
    const { a, b, move } = pair('3+2');
    vi.advanceTimersByTime(4_000);
    move(a, 'e2e4');
    vi.advanceTimersByTime(6_000);
    move(b, 'e7e5');
    expect(a.game().clock).toEqual({ w: 180_000, b: 180_000, running: 'w' });

    a.conn.lagMs = 200;
    vi.advanceTimersByTime(5_000);
    move(a, 'g1f3');
    // 5 s thought, 200 ms lag credited, 2 s increment
    expect(a.game().clock).toEqual({ w: 180_000 - 4_800 + 2_000, b: 180_000, running: 'b' });

    b.conn.lagMs = 5_000; // more than the quota allows
    vi.advanceTimersByTime(3_000);
    move(b, 'b8c6');
    expect(b.game().clock.b).toBe(180_000 - 2_500 + 2_000);
  });

  it('flags the side whose time runs out', () => {
    const { pair } = testHub();
    const { a, b, move } = pair('1+0');
    move(a, 'e2e4');
    move(b, 'e7e5');
    vi.advanceTimersByTime(60_000 + 500);
    expect(a.game()).toMatchObject({
      status: 'finished',
      result: { winner: 'b', reason: 'timeout' },
      clock: { w: 0, b: 60_000, running: null },
    });
  });

  it('aborts the game when a first move isn’t played in time', () => {
    const { pair } = testHub();
    const { a, b, move } = pair();
    vi.advanceTimersByTime(19_000);
    move(a, 'e2e4');
    expect(b.game().firstMoveMs).toBe(20_000);
    vi.advanceTimersByTime(20_000);
    expect(a.game()).toMatchObject({ status: 'aborted', result: null });
  });

  it('allows abort only before both sides have moved; resign then counts as abort', () => {
    const { pair } = testHub();
    let g = pair();
    g.move(g.a, 'e2e4');
    g.b.send({ t: 'resign', game: g.id });
    expect(g.a.game().status).toBe('aborted');

    g = pair();
    g.move(g.a, 'e2e4');
    g.move(g.b, 'e7e5');
    g.a.send({ t: 'abort', game: g.id });
    expect(g.a.errors()).toContain('The game can no longer be aborted.');
    g.a.send({ t: 'resign', game: g.id });
    expect(g.b.game()).toMatchObject({ status: 'finished', result: { winner: 'b', reason: 'resign' } });
  });

  it('handles draw offers: accept, decline, declining by moving, and no repeated offers', () => {
    const { pair } = testHub({ drawOfferGapPlies: 20 });
    const { a, b, id, move } = pair();
    a.send({ t: 'draw', game: id, action: 'offer' });
    expect(a.errors()).toEqual(['You can’t offer a draw again yet.']); // not while the game is abortable
    move(a, 'e2e4');
    move(b, 'e7e5');
    a.send({ t: 'draw', game: id, action: 'offer' });
    expect(b.game()).toMatchObject({ drawOffer: 'w', canOfferDraw: false });
    b.send({ t: 'draw', game: id, action: 'decline' });
    expect(a.game().drawOffer).toBeNull();
    a.send({ t: 'draw', game: id, action: 'offer' });
    expect(a.errors()).toContain('You can’t offer a draw again yet.');

    b.send({ t: 'draw', game: id, action: 'offer' });
    move(a, 'g1f3'); // moving declines
    expect(b.game().drawOffer).toBeNull();
    b.send({ t: 'draw', game: id, action: 'accept' });
    expect(b.errors()).toContain('There is no draw offer to accept.');
  });

  it('ends the game by agreement when both offer', () => {
    const { pair } = testHub();
    const { a, b, id, move } = pair();
    move(a, 'e2e4');
    move(b, 'e7e5');
    a.send({ t: 'draw', game: id, action: 'offer' });
    b.send({ t: 'draw', game: id, action: 'offer' });
    expect(a.game()).toMatchObject({ status: 'finished', result: { result: '1/2-1/2', reason: 'agreement' } });
  });

  it('ends on checkmate and removes the game from the lobby list, then forgets it', () => {
    const { pair, hub, cfg } = testHub();
    const { a, b, id, move } = pair();
    move(a, 'f2f3');
    move(b, 'e7e5');
    move(a, 'g2g4');
    move(b, 'd8h4');
    expect(a.game()).toMatchObject({ status: 'finished', result: { winner: 'b', reason: 'checkmate' } });
    expect(hub.lobbySnapshot().games).toEqual([]);
    vi.advanceTimersByTime(cfg.finishedTtlMs);
    expect(hub.room(id)).toBeUndefined();
  });
});

describe('rematch', () => {
  it('starts a new game with colours swapped once both agree', () => {
    const { pair, hub } = testHub();
    const { a, b, id, move } = pair();
    a.send({ t: 'rematch', game: id, offer: true });
    expect(a.errors()).toEqual(['The game is still being played.']);
    move(a, 'e2e4');
    move(b, 'e7e5');
    a.send({ t: 'resign', game: id });

    expect(b.game()).toMatchObject({ canRematch: true, rematchOffer: null });
    b.send({ t: 'rematch', game: id, offer: true });
    expect(a.game().rematchOffer).toBe('b');
    // offering again just repeats; withdrawing clears it
    b.send({ t: 'rematch', game: id, offer: false });
    expect(a.game().rematchOffer).toBeNull();
    b.send({ t: 'rematch', game: id, offer: true });
    a.send({ t: 'rematch', game: id, offer: true });

    const next = a.game().nextGame!;
    expect(next).toBeTruthy();
    expect(b.last('started')!.game).toBe(next);
    const room = hub.room(next)!;
    expect(room.player('w').id).toBe(b.last('welcome')!.id);
    expect(room.player('b').id).toBe(a.last('welcome')!.id);
    expect(room.tc.id).toBe('5+0');
    expect(a.game()).toMatchObject({ canRematch: false, rematchOffer: null });
  });

  it('lets the opponent decline, and works after an abort too', () => {
    const { pair } = testHub();
    const { a, b, id } = pair();
    a.send({ t: 'abort', game: id });
    a.send({ t: 'rematch', game: id, offer: true });
    expect(b.game().rematchOffer).toBe('w');
    b.send({ t: 'rematch', game: id, offer: false });
    expect(a.game()).toMatchObject({ rematchOffer: null, nextGame: null, canRematch: true });
  });
});

describe('disconnects', () => {
  it('lets the opponent claim after the disconnect timeout', () => {
    const { pair, disconnect } = testHub();
    const { a, b, id, move } = pair();
    move(a, 'e2e4');
    move(b, 'e7e5');
    disconnect(b);
    expect(a.game()).toMatchObject({ black: { online: false }, opponentGone: 30_000 });
    vi.advanceTimersByTime(10_000);
    a.send({ t: 'claim', game: id, outcome: 'win' });
    expect(a.errors()).toEqual(['Your opponent hasn’t been away long enough.']);
    vi.advanceTimersByTime(20_000);
    expect(a.game().opponentGone).toBe(0);
    a.send({ t: 'claim', game: id, outcome: 'win' });
    expect(a.game()).toMatchObject({ status: 'finished', result: { winner: 'w', reason: 'abandoned' } });
  });

  it('uses the short timeout when the player closed the page, and allows a draw claim', () => {
    const { pair, disconnect } = testHub();
    const { a, b, id, move } = pair();
    move(a, 'e2e4');
    move(b, 'e7e5');
    b.send({ t: 'bye' });
    disconnect(b);
    expect(a.game().opponentGone).toBe(10_000);
    vi.advanceTimersByTime(10_000);
    a.send({ t: 'claim', game: id, outcome: 'draw' });
    expect(a.game()).toMatchObject({ status: 'finished', result: { result: '1/2-1/2', reason: 'abandoned-draw' } });
  });

  it('resumes the game when the player comes back with the same token', () => {
    const { pair, disconnect, join } = testHub();
    const { a, b, id, move } = pair();
    move(a, 'e2e4');
    move(b, 'e7e5');
    const token = b.last('welcome')!.token;
    disconnect(b);
    vi.advanceTimersByTime(5_000);

    const back = join(token);
    expect(back.last('started')!.game).toBe(id);
    back.send({ t: 'watch', game: id });
    expect(back.game()).toMatchObject({ you: 'b', moves: ['e2e4', 'e7e5'], status: 'playing' });
    expect(a.game()).toMatchObject({ black: { online: true }, opponentGone: null });
    move(a, 'g1f3');
    move(back, 'b8c6');
    expect(a.game().moves).toHaveLength(4);
  });

  it('doesn’t count a disconnect as gone while the game can still be aborted', () => {
    const { pair, disconnect } = testHub();
    const { a, b } = pair();
    disconnect(b);
    expect(a.game()).toMatchObject({ opponentGone: null, canAbort: true });
  });
});

describe('clocks for insights', () => {
  it('records the mover’s time left after each move', () => {
    const { pair } = testHub();
    const { a, b, move, room } = pair('5+0');
    move(a, 'e2e4');
    move(b, 'e7e5');
    vi.advanceTimersByTime(3_000);
    move(a, 'g1f3');
    vi.advanceTimersByTime(7_000);
    move(b, 'b8c6');
    // the clock starts with the second move of each side
    const c = room().clocks;
    expect(c.slice(0, 2)).toEqual([300_000, 300_000]);
    expect(c[2]!).toBeLessThanOrEqual(297_000);
    expect(c[2]!).toBeGreaterThan(296_000);
    expect(c[3]!).toBeLessThanOrEqual(293_000);
  });
});

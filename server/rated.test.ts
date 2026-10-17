import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db/db.ts';
import { openSqlite } from './db/sqlite.ts';
import { Store } from './store.ts';
import { testHub, type TestClient } from './testUtils.ts';
import type { Account } from './types.ts';

describe('accounts and rated games', () => {
  let store: Store;
  let accounts: Record<string, Account>;
  let h: ReturnType<typeof testHub>;

  beforeEach(async () => {
    const db = openSqlite(':memory:');
    await migrate(db);
    store = new Store(db);
    accounts = {};
    for (const name of ['Ann', 'Ben']) {
      const user = (await store.createUser(name, 'hash'))!;
      accounts[name] = { user, ratings: await store.ratings(user.id) };
    }
    h = testHub({}, store);
  });
  afterEach(async () => {
    h.hub.stop();
    await store.db.close();
  });

  const inLobby = (c: TestClient) => {
    c.send({ t: 'lobby', on: true });
    return c;
  };

  it('signs accounts in as themselves, the same player in every tab', () => {
    const tab1 = h.join(null, accounts.Ann!);
    const tab2 = h.join(null, accounts.Ann!);
    const w = tab1.last('welcome')!;
    expect(w).toEqual({ t: 'welcome', token: null, id: accounts.Ann!.user.id, name: 'Ann', registered: true });
    expect(tab2.last('welcome')!.id).toBe(w.id);
    inLobby(tab1).send({ t: 'seek', tc: '5+0', color: 'random', rated: true });
    inLobby(tab2).send({ t: 'acceptSeek', id: tab2.last('lobby')!.lobby.seeks[0]!.id });
    expect(tab2.errors()).toEqual(['You can’t accept your own seek.']);
  });

  it('keeps rated play to accounts, and rated and casual seeks apart', () => {
    const guest = inLobby(h.join());
    guest.send({ t: 'seek', tc: '5+0', color: 'random', rated: true });
    expect(guest.errors()).toEqual(['Sign in to play rated games.']);

    const ann = inLobby(h.join(null, accounts.Ann!));
    ann.send({ t: 'seek', tc: '5+0', color: 'random', rated: true });
    const seek = guest.last('lobby')!.lobby.seeks[0]!;
    expect(seek).toMatchObject({ name: 'Ann', registered: true, rated: true, rating: { rating: 1500, provisional: true } });
    guest.send({ t: 'acceptSeek', id: seek.id });
    expect(guest.errors()).toContain('Sign in to play rated games.');

    const ben = inLobby(h.join(null, accounts.Ben!));
    ben.send({ t: 'seek', tc: '5+0', color: 'random', rated: false }); // casual: must not pair with Ann's rated seek
    expect(ben.last('started')).toBeUndefined();
    expect(ben.last('lobby')!.lobby.seeks.map(s => s.rated).sort()).toEqual([false, true]);
  });

  it('scores a rated game, saves it, and shows the new ratings', async () => {
    const ann = inLobby(h.join(null, accounts.Ann!));
    const ben = inLobby(h.join(null, accounts.Ben!));
    ann.send({ t: 'seek', tc: '3+2', color: 'b', rated: true });
    ben.send({ t: 'seek', tc: '3+2', color: 'w', rated: true });
    const id = ann.last('started')!.game;
    ann.send({ t: 'watch', game: id });
    ben.send({ t: 'watch', game: id });
    expect(ben.game()).toMatchObject({ rated: true, white: { name: 'Ben', rating: { rating: 1500 } }, black: { name: 'Ann' } });

    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach((uci, ply) => (ply % 2 ? ann : ben).send({ t: 'move', game: id, uci, ply }));
    expect(ann.game().result).toMatchObject({ winner: 'b', reason: 'checkmate' });
    await h.hub.settled();

    const final = ann.game();
    expect(final.black.diff).toBeGreaterThan(100); // new players move a lot
    expect(final.white.diff).toBe(-final.black.diff!);

    const saved = await store.game(id);
    expect(saved).toMatchObject({ rated: true, result: '0-1', reason: 'checkmate', whiteName: 'Ben', blackDiff: final.black.diff });
    const annRatings = await store.ratings(accounts.Ann!.user.id);
    expect(annRatings.blitz.games).toBe(1);
    expect(Math.round(annRatings.blitz.glicko.rating)).toBe(1500 + final.black.diff!);

    // the lobby uses the updated rating straight away
    ann.send({ t: 'seek', tc: '5+0', color: 'random', rated: true });
    const shown = ben.last('lobby')!.lobby.seeks.find(s => s.name === 'Ann')!;
    expect(shown.rating!.rating).toBe(1500 + final.black.diff!);
  });

  it('saves casual games that involve an account, unscored, and doesn’t save guest-only games', async () => {
    const ann = inLobby(h.join(null, accounts.Ann!));
    const guest = inLobby(h.join());
    ann.send({ t: 'seek', tc: '5+0', color: 'w', rated: false });
    guest.send({ t: 'acceptSeek', id: guest.last('lobby')!.lobby.seeks[0]!.id });
    const id = ann.last('started')!.game;
    ann.send({ t: 'watch', game: id });
    ann.send({ t: 'move', game: id, uci: 'e2e4', ply: 0 });
    guest.send({ t: 'move', game: id, uci: 'e7e5', ply: 1 });
    guest.send({ t: 'resign', game: id });
    await h.hub.settled();
    expect(await store.game(id)).toMatchObject({ rated: false, whiteDiff: null, blackId: null, reason: 'resign' });
    expect((await store.ratings(accounts.Ann!.user.id)).blitz.games).toBe(0);

    const { a, b, id: guestGame, move } = h.pair();
    move(a, 'e2e4');
    move(b, 'e7e5');
    a.send({ t: 'resign', game: guestGame });
    await h.hub.settled();
    expect(await store.game(guestGame)).toBeUndefined();
  });

  it('doesn’t save aborted games', async () => {
    const ann = inLobby(h.join(null, accounts.Ann!));
    const ben = inLobby(h.join(null, accounts.Ben!));
    ann.send({ t: 'seek', tc: '5+0', color: 'w', rated: true });
    ben.send({ t: 'acceptSeek', id: ben.last('lobby')!.lobby.seeks[0]!.id });
    const id = ann.last('started')!.game;
    ann.send({ t: 'abort', game: id });
    await h.hub.settled();
    expect(await store.game(id)).toBeUndefined();
  });
});

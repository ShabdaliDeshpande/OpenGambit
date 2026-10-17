import { describe, expect, it } from 'vitest';
import { createGame, gameReducer, type GameSetup } from './game';
import { playSan } from './testUtils';

const untimed: GameSetup = { mode: 'local', humanColor: 'w', level: 1, timeControlId: null };
const bullet: GameSetup = { ...untimed, timeControlId: '1+0' };

describe('game end by position', () => {
  it('ordinary moves do not end the game', () => {
    const s = playSan(createGame(untimed), ['e4', 'e5', 'Nf3', 'Nc6']);
    expect(s.result).toBeNull();
    expect(s.moves).toHaveLength(4);
  });

  it('checkmate', () => {
    const s = playSan(createGame(untimed), ['f3', 'e5', 'g4', 'Qh4#']);
    expect(s.result).toEqual({ result: '0-1', winner: 'b', reason: 'checkmate' });
  });

  it('stalemate', () => {
    const s = playSan(createGame(untimed, 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1'), ['Qb6']);
    expect(s.result).toEqual({ result: '1/2-1/2', winner: null, reason: 'stalemate' });
  });

  it('threefold repetition', () => {
    const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
    const afterFirst = playSan(createGame(untimed), shuffle);
    expect(afterFirst.result).toBeNull(); // start position seen twice
    const s = playSan(afterFirst, shuffle);
    expect(s.result).toEqual({ result: '1/2-1/2', winner: null, reason: 'threefold' });
    expect(s.moves).toHaveLength(8);
  });

  it('fifty-move rule', () => {
    const s = playSan(createGame(untimed, '4k3/8/8/8/8/8/8/R3K3 w - - 99 80'), ['Ra2']);
    expect(s.result?.reason).toBe('fifty-move');
    expect(s.result?.result).toBe('1/2-1/2');
  });

  it('fifty-move rule is not triggered by a capture or pawn move', () => {
    const s = playSan(createGame(untimed, '4k3/4p3/8/8/8/8/4P3/R3K3 w - - 99 80'), ['e4']);
    expect(s.result).toBeNull();
  });

  it('insufficient material', () => {
    const s = playSan(createGame(untimed, '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1'), ['Kxd2']);
    expect(s.result).toEqual({ result: '1/2-1/2', winner: null, reason: 'insufficient' });
  });

  it('a position loaded already finished is marked as over', () => {
    const mated = createGame(untimed, 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mated.result?.reason).toBe('checkmate');
  });
});

describe('game end by player action', () => {
  it('resign', () => {
    const s = gameReducer(playSan(createGame(untimed), ['e4']), { type: 'resign', color: 'w', now: 0 });
    expect(s.result).toEqual({ result: '0-1', winner: 'b', reason: 'resign' });
  });

  it('draw offer accepted', () => {
    let s = playSan(createGame(untimed), ['e4', 'e5']);
    s = gameReducer(s, { type: 'offerDraw', color: 'w' });
    expect(s.drawOfferBy).toBe('w');
    s = gameReducer(s, { type: 'acceptDraw', now: 0 });
    expect(s.result).toEqual({ result: '1/2-1/2', winner: null, reason: 'agreement' });
  });

  it('draw offer declined explicitly or by the opponent moving', () => {
    let s = playSan(createGame(untimed), ['e4']);
    s = gameReducer(s, { type: 'offerDraw', color: 'w' });
    expect(gameReducer(s, { type: 'declineDraw' }).drawOfferBy).toBeNull();
    s = playSan(s, ['e5']);
    expect(s.drawOfferBy).toBeNull();
    expect(gameReducer(s, { type: 'acceptDraw', now: 0 }).result).toBeNull();
  });

  it('no moves are accepted after the game ends', () => {
    const s = gameReducer(createGame(untimed), { type: 'resign', color: 'b', now: 0 });
    const after = gameReducer(s, { type: 'move', from: 'e2', to: 'e4', now: 1 });
    expect(after).toBe(s);
  });
});

describe('timeout', () => {
  it('the player who runs out of time loses', () => {
    // white moves at t=0 (starts black's clock), black at t=1000 (starts white's clock)
    const s = playSan(createGame(bullet), ['e4', 'e5'], 0, 1000);
    expect(gameReducer(s, { type: 'tick', now: 1000 + 59_999 }).result).toBeNull();
    const flagged = gameReducer(s, { type: 'tick', now: 1000 + 60_000 });
    expect(flagged.result).toEqual({ result: '0-1', winner: 'b', reason: 'timeout' });
    expect(flagged.clock?.remaining.w).toBe(0);
    expect(flagged.clock?.active).toBeNull();
  });

  it('a move made after the flag fell is rejected as a timeout', () => {
    const s = playSan(createGame(bullet), ['e4', 'e5'], 0, 1000);
    const late = gameReducer(s, { type: 'move', from: 'g1', to: 'f3', now: 1000 + 61_000 });
    expect(late.result?.reason).toBe('timeout');
    expect(late.moves).toHaveLength(2);
  });

  it('timeout is a draw when the opponent cannot possibly mate', () => {
    // black (with a queen) flags against a lone white king
    const s = playSan(createGame(bullet, '4k3/8/8/8/8/8/4q3/K7 b - - 0 1'), ['Qe3', 'Kb1'], 0, 1000);
    const flagged = gameReducer(s, { type: 'tick', now: 1000 + 60_000 });
    expect(flagged.result).toEqual({ result: '1/2-1/2', winner: null, reason: 'timeout-vs-insufficient' });
  });

  it('untimed games never flag', () => {
    const s = playSan(createGame(untimed), ['e4']);
    expect(gameReducer(s, { type: 'tick', now: 1e12 })).toBe(s);
  });
});

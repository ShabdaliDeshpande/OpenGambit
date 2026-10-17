import { describe, expect, it } from 'vitest';
import { readPgn } from '../analysis/pgn';
import type { GameSnapshot } from './protocol';
import { clockMs, countdown, fenAfter, onlinePgn, replay, withPending } from './view';

const snapshot = (over: Partial<GameSnapshot> = {}): GameSnapshot => ({
  id: 'g1',
  tc: '3+2',
  rated: false,
  white: { id: 'a', name: 'Guest 1111', online: true, registered: false, rating: null, diff: null },
  black: { id: 'b', name: 'Guest 2222', online: true, registered: false, rating: null, diff: null },
  you: 'w',
  moves: ['e2e4', 'e7e5'],
  status: 'playing',
  result: null,
  clock: { w: 170_000, b: 175_000, running: 'w' },
  firstMoveMs: null,
  canAbort: false,
  drawOffer: null,
  canOfferDraw: true,
  opponentGone: null,
  spectators: 0,
  tournament: null,
  berserk: { w: false, b: false },
  canBerserk: false,
  ...over,
});

describe('online view helpers', () => {
  it('runs only the active clock down from the snapshot, and stops at zero', () => {
    const s = snapshot();
    expect(clockMs(s, 1_000, 3_500, 'w')).toBe(167_500);
    expect(clockMs(s, 1_000, 3_500, 'b')).toBe(175_000);
    expect(clockMs(s, 0, 999_999, 'w')).toBe(0);
    expect(clockMs(snapshot({ status: 'finished' }), 0, 5_000, 'w')).toBe(170_000);
  });

  it('replays UCI moves into SAN and positions, including promotion', () => {
    const records = replay(['e2e4', 'e7e5', 'g1f3']);
    expect(records.map(r => r.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(fenAfter(records, 0)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(fenAfter(records, 3)).toBe(records[2]!.fen);
    const promo = replay(['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'f8g7', 'h6g7', 'g8f6', 'g7h8q']);
    expect(promo.at(-1)).toMatchObject({ san: 'gxh8=Q+', promotion: 'q' });
  });

  it('shows a sent move only while it still follows the server’s moves', () => {
    expect(withPending(['e2e4'], { uci: 'e7e5', ply: 1 })).toEqual(['e2e4', 'e7e5']);
    expect(withPending(['e2e4', 'c7c5'], { uci: 'e7e5', ply: 1 })).toEqual(['e2e4', 'c7c5']);
    expect(withPending(['e2e4'], null)).toEqual(['e2e4']);
  });

  it('exports a PGN the analysis board can read', () => {
    const pgn = onlinePgn(snapshot({ status: 'finished', result: { result: '0-1', winner: 'b', reason: 'resign' } }), new Date(2026, 9, 17));
    expect(pgn).toContain('[White "Guest 1111"]');
    expect(pgn).toContain('[TimeControl "180+2"]');
    expect(pgn).toContain('[Result "0-1"]');
    const tree = readPgn(pgn);
    expect(tree.headers.Black).toBe('Guest 2222');
  });

  it('formats countdowns', () => {
    expect(countdown(45_000)).toBe('0:45');
    expect(countdown(44_001)).toBe('0:45');
    expect(countdown(12 * 60_000 + 5_000)).toBe('12:05');
    expect(countdown(3_750_000)).toBe('1:02:30');
    expect(countdown(-5)).toBe('0:00');
  });

  it('puts ratings in the PGN of a rated game', () => {
    const pgn = onlinePgn(
      snapshot({
        rated: true,
        white: { id: 'a', name: 'Ann', online: true, registered: true, rating: { rating: 1612, provisional: false }, diff: 8 },
      }),
    );
    expect(pgn).toContain('[Event "Rated online game"]');
    expect(pgn).toContain('[WhiteElo "1612"]');
    expect(pgn).not.toContain('BlackElo');
  });
});

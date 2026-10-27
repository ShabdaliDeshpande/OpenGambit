import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Board } from './board';
import { chooseMove, trapValue, type Level } from './search';
import { styleTerms } from './style';

/** A clock that moves on with every reading, so timed searches end quickly and the same way each run. */
const fakeClock = () => {
  let t = 0;
  return () => (t += 2);
};

const seeded = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

describe('style terms', () => {
  it('rewards pieces near the enemy king, for the bot’s side only', () => {
    const near = Board.fromFen('6k1/8/5N2/6Q1/8/8/8/K7 w - - 0 1');
    const far = Board.fromFen('6k1/8/8/8/8/8/1N6/K5Q1 w - - 0 1');
    expect(styleTerms(near, 1, { kingAttack: 10 })).toBeGreaterThan(styleTerms(far, 1, { kingAttack: 10 }));
    // the same pieces mean nothing to a bot playing Black
    expect(styleTerms(near, -1, { kingAttack: 10 })).toBe(0);
  });

  it('likes trades, cover around its own king and material, from White’s point of view', () => {
    const full = Board.fromFen('r3k2r/pppqpppp/8/8/8/8/PPPQPPPP/R3K2R w KQkq - 0 1');
    const traded = Board.fromFen('4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1');
    expect(styleTerms(traded, 1, { trades: 3 })).toBeGreaterThan(styleTerms(full, 1, { trades: 3 }));
    const covered = Board.fromFen('4k3/8/8/8/8/8/5PPP/6K1 w - - 0 1');
    const bare = Board.fromFen('4k3/8/8/8/5PPP/8/8/6K1 w - - 0 1');
    expect(styleTerms(covered, 1, { kingGuard: 5 })).toBeGreaterThan(styleTerms(bare, 1, { kingGuard: 5 }));
    const pawnUp = Board.fromFen('4k3/8/8/8/8/8/PP6/4K3 w - - 0 1');
    expect(styleTerms(pawnUp, 1, { greed: 50 })).toBe(100);
    expect(styleTerms(pawnUp, -1, { greed: 50 })).toBe(100); // Black is behind: worse for it, so better for White
  });
});

describe('moves with a style', () => {
  const base: Level = { depth: 2, maxMs: 5000, noise: 0, quiescence: true };

  it('still plays a mate in one, whatever the bonuses', () => {
    const chess = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const m = chooseMove(chess, { ...base, style: { checks: 80, traps: 80, kingAttack: 8, trades: 5 } }, { rng: seeded(1) });
    expect(`${m!.from}${m!.to}`).toBe('a1a8');
  });

  it('prefers a safe check when it likes checks', () => {
    const fen = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    const m = chooseMove(new Chess(fen), { ...base, style: { checks: 300 } }, { rng: seeded(2) })!;
    const after = new Chess(fen);
    after.move(m);
    expect(after.inCheck()).toBe(true);
    // and not one that hangs the queen
    expect(after.moves({ verbose: true }).some(x => x.captured === 'q')).toBe(false);
  });

  it('measures traps: a tempting capture that loses counts, an ordinary position doesn’t', () => {
    // e3-e4 hits the queen; Qxe4 looks free but fxe4 wins the queen
    expect(trapValue('4k3/8/8/3q4/8/4PP2/8/4K3 w - - 0 1', { from: 'e3', to: 'e4' })).toBeGreaterThan(0);
    expect(trapValue('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { from: 'e2', to: 'e4' })).toBe(0);
  });

  it('gives the same move for the same seed', () => {
    const chess = new Chess();
    chess.move('e4');
    chess.move('e5');
    const settings: Level = { depth: 2, maxMs: 5000, noise: 80, quiescence: true, style: { kingAttack: 6, checks: 20 } };
    const a = chooseMove(chess, settings, { rng: seeded(7), now: fakeClock() });
    const b = chooseMove(chess, settings, { rng: seeded(7), now: fakeClock() });
    expect(a).toEqual(b);
  });
});

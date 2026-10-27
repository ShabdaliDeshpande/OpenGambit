import { describe, expect, it } from 'vitest';
import { moveSoundFor, slidesFor } from './animation';
import { MAX_PREMOVES, premoveDests, premoveFen, resolvePremove, takePremove } from './premove';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('premoves', () => {
  it('offers empty-board destinations for the side waiting to move', () => {
    const dests = premoveDests(AFTER_E4, 'w');
    expect(dests.get('g1')!.sort()).toEqual(['e2', 'f3', 'h3']);
    // the bishop may premove along its diagonal even though the way isn't clear yet
    expect(dests.get('f1')).toContain('b5');
    expect(dests.get('f1')).toContain('a6');
    // pawns: one or two forward from the start, and both diagonals
    expect(dests.get('d2')!.sort()).toEqual(['c3', 'd3', 'd4', 'e3']);
    expect(dests.get('e1')).toEqual(expect.arrayContaining(['g1', 'c1', 'e2']));
    expect(dests.has('e7')).toBe(false); // only the given colour
  });

  it('plays the premove only if it is legal when the turn comes', () => {
    const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(resolvePremove(afterE5, { from: 'g1', to: 'f3' })).toEqual({ from: 'g1', to: 'f3' });
    expect(resolvePremove(afterE5, { from: 'f1', to: 'a6' })).toEqual({ from: 'f1', to: 'a6' });
    expect(resolvePremove(afterE5, { from: 'e4', to: 'e5' })).toBeNull(); // blocked now
    // promotion premoves become a queen
    expect(resolvePremove('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', { from: 'e7', to: 'e8' })).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });
});

describe('premove queues', () => {
  it('shows the queued moves as made: castling takes the rook, a pawn on the last rank is a queen', () => {
    expect(premoveFen(AFTER_E4, [
      { from: 'g1', to: 'f3' },
      { from: 'f1', to: 'c4' },
      { from: 'e1', to: 'g1' },
    ])).toBe('rnbqkbnr/pppppppp/8/8/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b - - 0 1');
    expect(premoveFen('8/4P3/8/8/8/8/k7/4K3 b - - 0 1', [{ from: 'e7', to: 'e8' }])).toBe('4Q3/8/8/8/8/8/k7/4K3 b - - 0 1');
    // a recapture onto your own piece's square (in case it's taken first)
    expect(premoveFen(AFTER_E4, [{ from: 'd1', to: 'e2' }])).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPPQPPP/RNB1KBNR b - - 0 1');
  });

  it('never targets a king’s square, so queued positions stay sound', () => {
    const dests = premoveDests('4k3/8/8/8/8/8/8/4KQ2 b - - 0 1', 'w');
    expect(dests.get('f1')).not.toContain('e1');
    expect(dests.get('f1')).toContain('f8');
    expect(premoveDests('4k3/8/8/8/8/8/8/4Q1K1 b - - 0 1', 'w').get('e1')).not.toContain('e8');
  });

  it('plays the first queued move when it works, and drops the queue when it doesn’t', () => {
    const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const queue = [
      { from: 'g1', to: 'f3' },
      { from: 'f1', to: 'c4' },
    ] as const;
    expect(takePremove(afterE5, queue)).toEqual({ move: { from: 'g1', to: 'f3' }, rest: [{ from: 'f1', to: 'c4' }] });
    expect(takePremove(afterE5, [{ from: 'e4', to: 'e5' }, ...queue])).toEqual({ move: null, rest: [] });
    expect(takePremove(afterE5, [])).toEqual({ move: null, rest: [] });
    expect(MAX_PREMOVES).toBe(10);
  });
});

describe('move animation', () => {
  it('slides the moved piece, and the rook when castling', () => {
    expect(slidesFor(START, AFTER_E4, { from: 'e2', to: 'e4' })).toEqual([{ from: 'e2', to: 'e4' }]);
    const before = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const after = 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1';
    expect(slidesFor(before, after, { from: 'e1', to: 'g1' })).toEqual([
      { from: 'e1', to: 'g1' },
      { from: 'h1', to: 'f1' },
    ]);
  });

  it('does not animate jumps or new games', () => {
    expect(slidesFor(null, AFTER_E4, { from: 'e2', to: 'e4' })).toEqual([]);
    expect(slidesFor(AFTER_E4, START, null)).toEqual([]);
    // stepping back: the "last move" doesn't lead from the previous position
    const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(slidesFor(afterE5, AFTER_E4, { from: 'e2', to: 'e4' })).toEqual([]);
  });
});

describe('move sounds on the board', () => {
  it('tells moves, captures and checks apart, and stays quiet for jumps', () => {
    expect(moveSoundFor(START, AFTER_E4, { from: 'e2', to: 'e4' })).toBe('move');
    const beforeCapture = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
    const afterCapture = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    expect(moveSoundFor(beforeCapture, afterCapture, { from: 'e4', to: 'd5' })).toBe('capture');
    const beforeCheck = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
    const afterCheck = 'rnbqkbnr/ppp1pppp/8/1B1p4/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2';
    expect(moveSoundFor(beforeCheck, afterCheck, { from: 'f1', to: 'b5' })).toBe('check');
    expect(moveSoundFor(AFTER_E4, START, { from: 'e2', to: 'e4' })).toBeNull();
  });
});

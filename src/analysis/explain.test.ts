import { describe, expect, it } from 'vitest';
import { explainMove, materialPhrase, moveFeatures } from './explain';
import { reviewMoves } from './gameReview';
import { at, gameOf, uci } from './reviewFixtures';

describe('explanations', () => {
  it('names a hung piece and the better move', () => {
    const moves = gameOf(['e4', 'd5', 'Qg4', 'Bxg4']);
    const evals = [
      at({ cp: 20 }, ['e2e4', 'd7d5']),
      at({ cp: 30 }, ['d7d5', 'e4d5']),
      at({ cp: 10 }, ['e4d5', 'd8d5']),
      at({ cp: -900 }, ['c8g4']),
      at({ cp: -900 }, ['g1f3']),
    ];
    const qg4 = reviewMoves(moves, evals)[2]!;
    expect(explainMove(qg4)).toBe('Qg4 is a blunder. It leaves your queen on g4 hanging: Bxg4 wins it. Best was exd5, which keeps the material level.');
  });

  it('warns about a mate it allows', () => {
    const moves = gameOf(['e4', 'e5', 'Qh5', 'Ke7']);
    const evals = [at({ cp: 20 }, ['e2e4']), at({ cp: 20 }, ['e7e5']), at({ cp: 20 }, ['g1f3']), at({ cp: 0 }, ['b8c6']), at({ mate: 1 }, ['h5e5'])];
    const ke7 = reviewMoves(moves, evals)[3]!;
    expect(ke7.judgement.kind).toBe('blunder');
    expect(explainMove(ke7)).toBe('Ke7 is a blunder. It allows mate in 1, starting with Qxe5#. Best was Nc6, keeping the balance.');
  });

  it('praises a sacrifice in plain words', () => {
    const start = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const moves = gameOf(['Bxf7+'], start);
    const reviewed = reviewMoves(moves, [at({ cp: 40 }, ['c4f7']), at({ cp: 60 }, ['e8f7'])]);
    expect(reviewed[0]!.judgement.kind).toBe('brilliant');
    expect(explainMove(reviewed[0]!)).toBe('Bxf7+ is a brilliant sacrifice: it gives up a bishop for a pawn, and the engine finds that it holds up. It gives check.');
  });

  it('describes book and best moves briefly', () => {
    const moves = gameOf(['e4']);
    const [e4] = reviewMoves(moves, [at({ cp: 20 }, ['e2e4']), at({ cp: 20 })], { isBook: () => true });
    expect(explainMove(e4!)).toBe('e4 is a known opening move.');
    const [best] = reviewMoves(moves, [at({ cp: 20 }, ['e2e4']), at({ cp: 20 })]);
    expect(explainMove(best!)).toBe('e4 is the engine’s top choice.');
  });

  it('finds forks, pins and promotions', () => {
    expect(moveFeatures('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', uci('b5c7'))).toEqual(['forks the rook and king']);
    expect(moveFeatures('4k3/8/2n5/8/8/8/8/3BK3 w - - 0 1', uci('d1a4'))).toEqual(['pins the knight to the king']);
    expect(moveFeatures('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', uci('e7e8q'))).toEqual(['promotes to a queen']);
  });

  it('puts amounts of material into words', () => {
    expect([1, 2, 3, 4, 5, 9].map(materialPhrase)).toEqual(['a pawn', 'two pawns', 'a piece', 'a piece', 'a rook', 'a lot of material']);
  });
});

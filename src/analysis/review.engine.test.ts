import { Chess } from 'chess.js';
import { expect, it } from 'vitest';
import { analyse, type UciMove } from '../engine/search';
import { judge, scoreOf, type Kind } from './review';

const uci = (s: string): UciMove => ({ from: s.slice(0, 2), to: s.slice(2, 4) }) as UciMove;

/** Reviews a game the same way the analysis board does, with the real engine (short think time). */
function review(moves: string[]): Kind[] {
  const start = new Chess().fen();
  const chess = new Chess();
  const positions: { fen: string; score: ReturnType<typeof scoreOf>; best: UciMove | null }[] = [];
  for (let i = 0; i <= moves.length; i++) {
    const info = analyse(start, moves.slice(0, i).map(uci), { multiPv: 1, maxDepth: 6, maxMs: 400 });
    positions.push({ fen: chess.fen(), score: scoreOf(info?.lines[0], chess.fen()), best: info?.lines[0]?.pv[0] ?? null });
    if (i < moves.length) chess.move(uci(moves[i]!));
  }
  return moves.map((m, i) => {
    const mover = i % 2 === 0 ? 'w' : 'b';
    const best = positions[i]!.best;
    const playedBest = !!best && best.from + best.to === m;
    return judge(positions[i]!.score, positions[i + 1]!.score, mover, playedBest).kind;
  });
}

it('finds the blunder and the winning reply in a real game', () => {
  // 1. e4 e5 2. Qh5 Ke7?? 3. Qxe5#
  const kinds = review(['e2e4', 'e7e5', 'd1h5', 'e8e7', 'h5e5']);
  expect(kinds[3]).toBe('blunder'); // Ke7 walks into mate
  expect(kinds[4]).toBe('best'); // Qxe5 is checkmate
  expect(['best', 'excellent', 'good']).toContain(kinds[0]); // 1. e4 is fine
}, 30_000);

it('flags a hung queen and praises taking it', () => {
  // 1. e4 d5 2. Qg4?? Bxg4: the queen is simply lost
  const kinds = review(['e2e4', 'd7d5', 'd1g4', 'c8g4']);
  expect(kinds[2]).toBe('blunder');
  expect(kinds[3]).toBe('best');
}, 30_000);

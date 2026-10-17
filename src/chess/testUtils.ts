import { buildChess, gameReducer, type GameState } from './game';

/** Plays SAN moves through the reducer, `stepMs` apart starting at `start`. */
export function playSan(state: GameState, sans: string[], start = 0, stepMs = 1000): GameState {
  let s = state;
  sans.forEach((san, i) => {
    const m = buildChess(s).move(san);
    s = gameReducer(s, {
      type: 'move',
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
      now: start + i * stepMs,
    });
  });
  return s;
}

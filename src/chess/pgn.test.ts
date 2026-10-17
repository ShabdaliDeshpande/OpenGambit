import { describe, expect, it } from 'vitest';
import { checkFen, createGame, exportPgn, gameReducer, importPgn, liveFen, type GameSetup, type GameState } from './game';
import { playSan } from './testUtils';

const setup: GameSetup = { mode: 'local', humanColor: 'w', level: 1, timeControlId: null };
const date = new Date(2026, 9, 17);

function roundTrip(state: GameState) {
  const pgn = exportPgn(state, date);
  const back = importPgn(pgn, setup);
  return { pgn, back };
}

describe('PGN export → import round trip', () => {
  it('keeps moves, final position and result for a finished game', () => {
    const game = playSan(createGame(setup), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
    expect(game.result?.reason).toBe('checkmate');
    const { pgn, back } = roundTrip(game);

    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[Date "2026.10.17"]');
    expect(pgn.trim().endsWith('1-0')).toBe(true);
    expect(back.moves.map(m => m.san)).toEqual(game.moves.map(m => m.san));
    expect(liveFen(back)).toBe(liveFen(game));
    expect(back.result).toEqual(game.result);
    expect(back.headers.White).toBe('White');
    expect(back.headers.Black).toBe('Black');
  });

  it('keeps castling, en passant and promotion', () => {
    const sans = ['e4', 'd5', 'e5', 'f5', 'exf6', 'Nc6', 'fxg7', 'Qd6', 'gxh8=Q', 'Bd7', 'Nf3', 'O-O-O', 'Be2', 'e6', 'O-O'];
    const game = playSan(createGame(setup), sans);
    expect(game.moves.map(m => m.san)).toEqual(sans);
    const { back } = roundTrip(game);
    expect(back.moves.map(m => m.san)).toEqual(sans);
    expect(back.moves[8]?.promotion).toBe('q');
    expect(liveFen(back)).toBe(liveFen(game));
    expect(back.result).toBeNull();
  });

  it('keeps a custom starting position (SetUp/FEN headers)', () => {
    const start = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const game = playSan(createGame(setup, start), ['a8=Q+', 'Kd7']);
    const { pgn, back } = roundTrip(game);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${start}"]`);
    expect(back.startFen).toBe(start);
    expect(back.moves.map(m => m.san)).toEqual(['a8=Q+', 'Kd7']);
    expect(liveFen(back)).toBe(liveFen(game));
  });

  it('keeps results decided off the board (resign, timeout)', () => {
    const resigned = gameReducer(playSan(createGame(setup), ['d4', 'd5']), { type: 'resign', color: 'b', now: 0 });
    const { pgn, back } = roundTrip(resigned);
    expect(pgn).toContain('[Result "1-0"]');
    expect(back.result).toEqual({ result: '1-0', winner: 'w', reason: 'imported' });
  });

  it('records the time control', () => {
    const timed = playSan(createGame({ ...setup, timeControlId: '3+2' }), ['e4']);
    expect(exportPgn(timed, date)).toContain('[TimeControl "180+2"]');
  });

  it('an unfinished game exports with result *', () => {
    const { pgn, back } = roundTrip(playSan(createGame(setup), ['c4']));
    expect(pgn).toContain('[Result "*"]');
    expect(back.result).toBeNull();
  });
});

describe('import validation', () => {
  it('rejects illegal PGN', () => {
    expect(() => importPgn('1. e4 e5 2. Ke3', setup)).toThrow(/Invalid PGN/);
  });

  it('accepts PGN without headers', () => {
    const s = importPgn('1. d4 d5 2. c4 *', setup);
    expect(s.moves.map(m => m.san)).toEqual(['d4', 'd5', 'c4']);
  });

  it('validates FEN', () => {
    expect(checkFen('  8/8/8/8/8/8/8/K6k w - - 0 1 ')).toBe('8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(() => checkFen('not a fen')).toThrow(/Invalid FEN/);
  });
});

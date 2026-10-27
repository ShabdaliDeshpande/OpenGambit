import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { chooseMove } from '../engine/search';
import { validItem } from '../learn/progress';
import { BOTS, type ChatEvent } from './bots';
import { bareSan, repertoireMove } from './repertoire';
import { chatLine, endEvent, engineScore, moveEvent, wasBlunder } from './chat';
import { activeAssists, DEFAULT_ASSISTS, NO_ASSISTS, parseSavedGame, resultValue, takeBackTo } from './botGame';

const seeded = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
const fixed = (x: number) => () => x;
const fakeClock = () => {
  let t = 0;
  return () => (t += 2);
};

const EVENTS: ChatEvent[] = ['start', 'capture', 'check', 'blunder', 'win', 'loss', 'draw'];

describe('bot definitions', () => {
  it('have unique ids and names, rising ratings and something to say for every event', () => {
    expect(new Set(BOTS.map(b => b.id)).size).toBe(BOTS.length);
    expect(new Set(BOTS.map(b => b.name)).size).toBe(BOTS.length);
    expect(BOTS.length).toBeGreaterThanOrEqual(10);
    BOTS.forEach((b, i) => {
      expect(validItem(`bot:${b.id}`, 2)).toBe(true);
      if (i > 0) expect(b.rating).toBeGreaterThan(BOTS[i - 1]!.rating);
      for (const e of EVENTS) expect(b.chat[e].length).toBeGreaterThan(0);
      expect(b.chatty).toBeGreaterThan(0);
      expect(b.engine.depth).toBeGreaterThanOrEqual(1);
      for (const c of [b.avatar.face, b.avatar.back]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it('only list legal opening lines, written as chess.js writes them', () => {
    for (const b of BOTS)
      for (const [side, lines] of Object.entries(b.repertoire))
        for (const line of lines) {
          const chess = new Chess();
          const sans = line.split(' ');
          for (const san of sans) {
            const m = chess.move(san); // throws on an illegal move
            expect(bareSan(m.san), `${b.id} ${side}: ${line}`).toBe(san);
          }
          // a line must end on one of the bot's own moves
          expect(sans.length % 2 === 1, `${b.id} ${side}: ${line}`).toBe(side === 'white');
        }
  });

  it('every bot finds a legal move with its own settings', () => {
    const chess = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    for (const b of BOTS) {
      const m = chooseMove(chess, b.engine, { rng: seeded(3), now: fakeClock() });
      expect(() => new Chess(chess.fen()).move(m!), b.id).not.toThrow();
    }
  });
});

describe('repertoire', () => {
  const lines = ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3', 'd4 d5 c4'];

  it('follows a matching line and stops when the game leaves it', () => {
    expect(repertoireMove(lines, ['e4', 'e5'])).toBe('Nf3');
    expect(repertoireMove(lines, ['e4', 'c5'])).toBe('Nf3');
    expect(repertoireMove(lines, ['e4', 'e6'])).toBeNull();
    expect(repertoireMove(lines, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])).toBeNull();
  });

  it('picks among the lines that match, and ignores check marks', () => {
    expect(repertoireMove(lines, [], fixed(0))).toBe('e4');
    expect(repertoireMove(lines, [], fixed(0.99))).toBe('d4');
    expect(repertoireMove(['e4 e5 Qh5 Nc6 Qxf7+'], ['e4', 'e5', 'Qh5', 'Nc6'])).toBe('Qxf7');
    expect(repertoireMove(['e4 e5 Bc4 Nc6 Bxf7 Kxf7'], ['e4', 'e5', 'Bc4', 'Nc6', 'Bxf7+'])).toBe('Kxf7');
  });
});

describe('chat', () => {
  const bot = BOTS[0]!;

  it('always greets and signs off, but only sometimes comments on a move', () => {
    expect(bot.chat.start).toContain(chatLine(bot, 'start', fixed(0.99)));
    expect(bot.chat.win).toContain(chatLine(bot, 'win', fixed(0.5)));
    expect(chatLine(bot, 'capture', fixed(0.99))).toBeNull();
    expect(bot.chat.capture).toContain(chatLine(bot, 'capture', fixed(0.01)));
  });

  it('tells checks from captures, and the end of the game from the bot’s side', () => {
    expect(moveEvent('Bxf7+')).toBe('check');
    expect(moveEvent('Nxe5')).toBe('capture');
    expect(moveEvent('Qh7#')).toBeNull();
    expect(moveEvent('e4')).toBeNull();
    expect(endEvent({ result: '1-0', winner: 'w', reason: 'checkmate' }, 'w')).toBe('win');
    expect(endEvent({ result: '1-0', winner: 'w', reason: 'checkmate' }, 'b')).toBe('loss');
    expect(endEvent({ result: '1/2-1/2', winner: null, reason: 'stalemate' }, 'b')).toBe('draw');
  });

  it('turns engine scores into Game Review scores and spots blunders', () => {
    expect(engineScore(150, 'w')).toEqual({ cp: 150 });
    expect(engineScore(150, 'b')).toEqual({ cp: -150 });
    expect(engineScore(100_000 - 3, 'b')).toEqual({ mate: -2 });
    // White was fine, then dropped a rook
    expect(wasBlunder({ cp: 30 }, { cp: -480 }, 'w')).toBe(true);
    expect(wasBlunder({ cp: 30 }, { cp: 10 }, 'w')).toBe(false);
  });
});

describe('bot games', () => {
  it('takes back to just before your last move', () => {
    const moves = [{ color: 'w' as const }, { color: 'b' as const }, { color: 'w' as const }, { color: 'b' as const }];
    expect(takeBackTo(moves, 'w')).toBe(2);
    expect(takeBackTo(moves.slice(0, 3), 'w')).toBe(2);
    expect(takeBackTo(moves, 'b')).toBe(3);
    expect(takeBackTo(moves.slice(0, 1), 'b')).toBeNull();
  });

  it('counts wins and draws for the card, and gives no help in Challenge mode', () => {
    expect(resultValue({ result: '0-1', winner: 'b', reason: 'checkmate' }, 'b')).toBe(2);
    expect(resultValue({ result: '1/2-1/2', winner: null, reason: 'agreement' }, 'b')).toBe(1);
    expect(resultValue({ result: '0-1', winner: 'b', reason: 'resign' }, 'w')).toBeNull();
    expect(activeAssists('challenge', DEFAULT_ASSISTS)).toEqual(NO_ASSISTS);
    expect(activeAssists('assisted', DEFAULT_ASSISTS)).toEqual(DEFAULT_ASSISTS);
  });

  it('reads back a saved game only if it’s sound and unfinished', () => {
    const ok = { botId: 'pebble', player: 'w', mode: 'assisted', assists: { hints: true }, moves: ['e2e4', 'e7e5'] };
    expect(parseSavedGame(ok)).toEqual({ ...ok, assists: { ...NO_ASSISTS, hints: true } });
    expect(parseSavedGame({ ...ok, botId: 'nobody' })).toBeNull();
    expect(parseSavedGame({ ...ok, moves: ['e2e5'] })).toBeNull();
    expect(parseSavedGame({ ...ok, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] })).toBeNull(); // already mate
    expect(parseSavedGame('nonsense')).toBeNull();
  });
});

import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import type { MoveRecord } from '../chess/game';
import type { GameSnapshot } from './protocol';

/** The clock as it should read now, counting down locally from the last snapshot. */
export function clockMs(snap: GameSnapshot, receivedAt: number, now: number, color: Color): number {
  const at = snap.clock[color];
  return snap.status === 'playing' && snap.clock.running === color ? Math.max(0, at - (now - receivedAt)) : at;
}

/** Replays UCI moves into move records (SAN and positions) for the move list and board. */
export function replay(moves: readonly string[]): MoveRecord[] {
  const chess = new Chess();
  const records: MoveRecord[] = [];
  for (const uci of moves) {
    const promotion = uci[4] as PieceSymbol | undefined;
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(promotion ? { promotion } : {}) });
    records.push({
      san: m.san,
      from: m.from as Square,
      to: m.to as Square,
      ...(m.promotion ? { promotion: m.promotion as PieceSymbol } : {}),
      color: m.color,
      fen: chess.fen(),
    });
  }
  return records;
}

export const fenAfter = (records: readonly MoveRecord[], ply: number): string =>
  ply === 0 ? DEFAULT_POSITION : (records[ply - 1]?.fen ?? DEFAULT_POSITION);

/** The server's moves plus the player's own move that is still on its way, if it still fits. */
export function withPending(moves: readonly string[], pending: { uci: string; ply: number } | null): string[] {
  return pending && pending.ply === moves.length ? [...moves, pending.uci] : [...moves];
}

/** A PGN of the online game, for the analysis board. */
export function onlinePgn(snap: GameSnapshot, date: Date = new Date()): string {
  return gamePgn({
    moves: snap.moves,
    white: snap.white.name,
    black: snap.black.name,
    tc: snap.tc,
    result: snap.result?.result ?? '*',
    rated: snap.rated,
    whiteElo: snap.white.rating?.rating ?? null,
    blackElo: snap.black.rating?.rating ?? null,
    date,
  });
}

export interface PgnInfo {
  moves: readonly string[];
  white: string;
  black: string;
  tc: string;
  result: string;
  rated: boolean;
  whiteElo: number | null;
  blackElo: number | null;
  date: Date;
}

/** A PGN for a game played online, live or saved. */
export function gamePgn(g: PgnInfo): string {
  const chess = new Chess();
  for (const uci of g.moves) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
  const pad = (n: number) => String(n).padStart(2, '0');
  chess.setHeader('Event', g.rated ? 'Rated online game' : 'Online game');
  chess.setHeader('Date', `${g.date.getFullYear()}.${pad(g.date.getMonth() + 1)}.${pad(g.date.getDate())}`);
  chess.setHeader('White', g.white);
  chess.setHeader('Black', g.black);
  if (g.whiteElo !== null) chess.setHeader('WhiteElo', String(g.whiteElo));
  if (g.blackElo !== null) chess.setHeader('BlackElo', String(g.blackElo));
  chess.setHeader('TimeControl', timeControlTag(g.tc));
  chess.setHeader('Result', g.result);
  return chess.pgn();
}

const timeControlTag = (tc: string) => {
  const [min, inc] = tc.split('+').map(Number);
  return `${(min ?? 0) * 60}+${inc ?? 0}`;
};

import { Chess } from 'chess.js';
import { fetchExplorer } from '../account/api';
import { pickBookMove } from './book';
import type { UciMove } from '../engine/search';

/** Gives up on the book after this long, so a slow or missing server never holds up the computer. */
const BOOK_TIMEOUT_MS = 1200;

/** A master move for this position from the server's imported games (UCI), or null. */
export async function fetchBookMove(fen: string): Promise<UciMove | null> {
  try {
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), BOOK_TIMEOUT_MS));
    const found = await Promise.race([fetchExplorer('masters', fen), timeout]);
    const uci = found ? pickBookMove(found.moves) : null;
    if (!uci) return null;
    const move = { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) } as UciMove;
    new Chess(fen).move(move); // throws if it doesn't fit the position
    return move;
  } catch {
    return null;
  }
}

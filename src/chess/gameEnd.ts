import type { Chess, Color } from 'chess.js';

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'timeout'
  | 'timeout-vs-insufficient'
  | 'resign'
  | 'agreement'
  | 'imported'
  | 'abandoned'
  | 'abandoned-draw';

export type ResultCode = '1-0' | '0-1' | '1/2-1/2';

export interface GameResult {
  result: ResultCode;
  winner: Color | null;
  reason: EndReason;
}

const win = (winner: Color, reason: EndReason): GameResult => ({
  result: winner === 'w' ? '1-0' : '0-1',
  winner,
  reason,
});

const draw = (reason: EndReason): GameResult => ({ result: '1/2-1/2', winner: null, reason });

/**
 * Game end decided by the position alone. Threefold repetition and the
 * fifty-move rule end the game automatically (no claim step).
 */
export function detectBoardEnd(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) return win(chess.turn() === 'w' ? 'b' : 'w', 'checkmate');
  if (chess.isStalemate()) return draw('stalemate');
  if (chess.isInsufficientMaterial()) return draw('insufficient');
  if (chess.isThreefoldRepetition()) return draw('threefold');
  if (chess.isDrawByFiftyMoves()) return draw('fifty-move');
  return null;
}

/**
 * Whether `color` has no possible way to deliver checkmate. Deliberately
 * conservative: only a bare king, or a king with a single minor piece against
 * a bare king, counts as unable to win.
 */
export function cannotMate(chess: Chess, color: Color): boolean {
  const own: string[] = [];
  const theirs: string[] = [];
  for (const row of chess.board())
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue;
      (sq.color === color ? own : theirs).push(sq.type);
    }
  if (own.length === 0) return true;
  return own.length === 1 && (own[0] === 'n' || own[0] === 'b') && theirs.length === 0;
}

/** The flagged side loses, unless the opponent could never mate. */
export function timeoutResult(chess: Chess, flagged: Color): GameResult {
  const opponent: Color = flagged === 'w' ? 'b' : 'w';
  return cannotMate(chess, opponent) ? draw('timeout-vs-insufficient') : win(opponent, 'timeout');
}

export const resignResult = (resigner: Color): GameResult =>
  win(resigner === 'w' ? 'b' : 'w', 'resign');

export const agreementResult = (): GameResult => draw('agreement');

/** Online play: the opponent left and the remaining player claimed the win or a draw. */
export const abandonedResult = (winner: Color | null): GameResult =>
  winner ? win(winner, 'abandoned') : draw('abandoned-draw');

const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');

export function describeResult(r: GameResult): string {
  const winner = r.winner ? colorName(r.winner) : null;
  const loser = r.winner ? colorName(r.winner === 'w' ? 'b' : 'w') : null;
  switch (r.reason) {
    case 'checkmate':
      return `Checkmate. ${winner} wins.`;
    case 'stalemate':
      return 'Stalemate. Draw.';
    case 'threefold':
      return 'Threefold repetition. Draw.';
    case 'fifty-move':
      return 'Fifty moves without capture or pawn move. Draw.';
    case 'insufficient':
      return 'Insufficient material. Draw.';
    case 'timeout':
      return `${loser} ran out of time. ${winner} wins.`;
    case 'timeout-vs-insufficient':
      return 'Time ran out, but the opponent cannot mate. Draw.';
    case 'resign':
      return `${loser} resigned. ${winner} wins.`;
    case 'agreement':
      return 'Draw by agreement.';
    case 'imported':
      return winner ? `${winner} won (from PGN).` : 'Draw (from PGN).';
    case 'abandoned':
      return `${loser} left the game. ${winner} wins.`;
    case 'abandoned-draw':
      return 'The opponent left the game. Draw.';
  }
}

export const TERMINATION_LABEL: Record<EndReason, string> = {
  checkmate: 'Normal',
  stalemate: 'Normal',
  threefold: 'Normal',
  'fifty-move': 'Normal',
  insufficient: 'Normal',
  timeout: 'Time forfeit',
  'timeout-vs-insufficient': 'Time forfeit',
  resign: 'Normal',
  agreement: 'Normal',
  imported: 'Unknown',
  abandoned: 'Abandoned',
  'abandoned-draw': 'Abandoned',
};

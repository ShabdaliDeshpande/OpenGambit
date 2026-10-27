import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';

export interface Premove {
  from: Square;
  to: Square;
}

/** At most this many premoves wait in the queue. */
export const MAX_PREMOVES = 10;

const sq = (file: number, rank: number): Square | null =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? (`${'abcdefgh'[file]}${rank + 1}` as Square) : null;

/**
 * Squares each of `color`'s pieces could reach on an empty board: where a
 * premove may go while it's the opponent's turn. Blockers are ignored because
 * the opponent's next move may clear the way (or be a capture to answer), so
 * the real check happens when the premove is played.
 */
export function premoveDests(fen: string, color: Color): Map<Square, Square[]> {
  const chess = new Chess(fen);
  const out = new Map<Square, Square[]>();
  // no king can be taken, so squares with a king are never targets (it also keeps queued positions sound)
  const kings = new Set(chess.findPiece({ type: 'k', color: 'w' }).concat(chess.findPiece({ type: 'k', color: 'b' })));
  for (const row of chess.board())
    for (const p of row) {
      if (!p || p.color !== color) continue;
      const f = p.square.charCodeAt(0) - 97;
      const r = Number(p.square[1]) - 1;
      const list: Square[] = [];
      const add = (s: Square | null) => s && s !== p.square && !kings.has(s) && !list.includes(s) && list.push(s);
      const rays = (dirs: [number, number][]) => {
        for (const [df, dr] of dirs) for (let k = 1; k < 8; k++) add(sq(f + df * k, r + dr * k));
      };
      const steps = (dirs: [number, number][]) => dirs.forEach(([df, dr]) => add(sq(f + df, r + dr)));
      const straight: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const diagonal: [number, number][] = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      const kind: PieceSymbol = p.type;
      if (kind === 'r') rays(straight);
      else if (kind === 'b') rays(diagonal);
      else if (kind === 'q') rays([...straight, ...diagonal]);
      else if (kind === 'n')
        steps([
          [1, 2],
          [2, 1],
          [2, -1],
          [1, -2],
          [-1, -2],
          [-2, -1],
          [-2, 1],
          [-1, 2],
        ]);
      else if (kind === 'k') {
        steps([...straight, ...diagonal]);
        const home = color === 'w' ? 0 : 7;
        if (r === home && f === 4) {
          add(sq(6, home));
          add(sq(2, home));
        }
      } else {
        const dir = color === 'w' ? 1 : -1;
        add(sq(f, r + dir));
        if (r === (color === 'w' ? 1 : 6)) add(sq(f, r + 2 * dir));
        add(sq(f - 1, r + dir));
        add(sq(f + 1, r + dir));
      }
      if (list.length) out.set(p.square, list);
    }
  return out;
}

/**
 * The position as it will look after the queued premoves, whatever the
 * opponent does: what the board shows while they wait, and where the next
 * premove starts from. A pawn reaching the last rank becomes a queen, and a
 * king moving two squares takes its rook along.
 */
export function premoveFen(fen: string, premoves: readonly Premove[]): string {
  const [placement = '', side = 'w', , , half = '0', full = '1'] = fen.split(' ');
  // grid[0] is the 8th rank
  const grid = placement.split('/').map(row => [...row].flatMap(ch => (ch >= '1' && ch <= '8' ? Array<string | null>(Number(ch)).fill(null) : [ch])));
  const at = (s: Square) => [8 - Number(s[1]), s.charCodeAt(0) - 97] as const;
  for (const pm of premoves) {
    const [fr, ff] = at(pm.from);
    const [tr, tf] = at(pm.to);
    let piece = grid[fr]![ff];
    if (!piece) continue;
    grid[fr]![ff] = null;
    if ((piece === 'P' && tr === 0) || (piece === 'p' && tr === 7)) piece = piece === 'P' ? 'Q' : 'q';
    if ((piece === 'K' || piece === 'k') && fr === tr && Math.abs(tf - ff) === 2) {
      const [rookFrom, rookTo] = tf > ff ? [7, 5] : [0, 3];
      const rook = grid[fr]![rookFrom];
      if (rook?.toLowerCase() === 'r') {
        grid[fr]![rookFrom] = null;
        grid[fr]![rookTo] = rook;
      }
    }
    grid[tr]![tf] = piece;
  }
  const rows = grid.map(row => {
    let out = '';
    let empty = 0;
    for (const c of row) {
      if (!c) empty++;
      else {
        out += (empty || '') + c;
        empty = 0;
      }
    }
    return out + (empty || '');
  });
  return `${rows.join('/')} ${side} - - ${half} ${full}`;
}

/** The premove as a legal move in the new position (promoting to a queen), or null if it no longer works. */
export function resolvePremove(fen: string, pm: Premove): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).filter(m => m.from === pm.from && m.to === pm.to);
  if (legal.length === 0) return null;
  const move = legal.find(m => !m.promotion || m.promotion === 'q') ?? legal[0]!;
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion as PieceSymbol } : {}) };
}

/**
 * The first queued premove as a legal move in the new position, and what
 * stays queued. If the first one no longer works, the whole queue is
 * dropped, so the rest can't go off in a position nobody planned for.
 */
export function takePremove(fen: string, queue: readonly Premove[]): { move: ReturnType<typeof resolvePremove>; rest: Premove[] } {
  const move = queue.length ? resolvePremove(fen, queue[0]!) : null;
  return { move, rest: move ? queue.slice(1) : [] };
}

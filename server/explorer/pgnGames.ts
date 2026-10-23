// Reads games one at a time from a PGN file, however large: headers, and
// the main line's moves (comments, variations, glyphs and move numbers are
// dropped). Also replays SAN moves quickly on the engine's board, because
// chess.js is too slow for millions of games.
import { Board, F_CASTLE, KING, KNIGHT, BISHOP, ROOK, QUEEN, PAWN, moveFlags, moveFrom, movePromo, moveTo, squareIndex, squareName } from '../../src/engine/board.ts';

export interface PgnGame {
  headers: Record<string, string>;
  /** Main-line moves in SAN, as written. */
  moves: string[];
}

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;

/** The main line's SAN moves from a game's movetext (at most `maxPlies`). */
export function mainlineSans(movetext: string, maxPlies = Infinity): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  const s = movetext;
  while (i < s.length && out.length < maxPlies) {
    const ch = s[i]!;
    if (ch === '{') {
      const end = s.indexOf('}', i);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === ';') {
      const end = s.indexOf('\n', i);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === '(') {
      depth++;
      i++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (/\s/.test(ch)) i++;
    else {
      const m = /^[^\s(){};]+/.exec(s.slice(i, i + 64))!;
      i += m[0].length;
      if (depth > 0) continue;
      let word = m[0].replace(/^\d+\.+/, '');
      if (!word || word.startsWith('$') || RESULT.test(word)) continue;
      word = word.replace(/[!?]+$/, '');
      if (word) out.push(word);
    }
  }
  return out;
}

/** Splits PGN text, line by line, into games. */
export async function* readPgnGames(lines: AsyncIterable<string> | Iterable<string>, maxPlies = Infinity): AsyncGenerator<PgnGame> {
  let headers: Record<string, string> = {};
  let movetext = '';
  let inMoves = false;
  const finish = (): PgnGame | null => {
    const game = Object.keys(headers).length || movetext.trim() ? { headers, moves: mainlineSans(movetext, maxPlies) } : null;
    headers = {};
    movetext = '';
    inMoves = false;
    return game;
  };
  for await (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[') && !(inMoves && depthOpen(movetext))) {
      if (inMoves) {
        const g = finish();
        if (g) yield g;
      }
      const tag = /^\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/.exec(line);
      if (tag) headers[tag[1]!] = tag[2]!.replace(/\\(.)/g, '$1');
      continue;
    }
    if (line.startsWith('%')) continue; // escape line
    if (line) {
      inMoves = true;
      movetext += `${raw}\n`;
    }
  }
  const last = finish();
  if (last) yield last;
}

/** An unclosed { comment } means a "[" line is still part of it. */
const depthOpen = (text: string) => text.lastIndexOf('{') > text.lastIndexOf('}');

const PIECE: Record<string, number> = { N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING };
const SAN = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?$/;
const PROMO_LETTER = ['', '', 'n', 'b', 'r', 'q'];

/** Plays a SAN move on the board; returns it in UCI, or null when it isn't a legal move. */
export function playSan(b: Board, san: string): string | null {
  const s = san.replace(/[+#]+$/, '').replace(/^0-0/, 'O-O').replace(/^O-O-0$/, 'O-O-O');
  const legal = b.legalMoves();
  let move: number | undefined;
  if (s === 'O-O' || s === 'O-O-O') {
    const long = s === 'O-O-O';
    move = legal.find(m => moveFlags(m) & F_CASTLE && (long ? moveTo(m) < moveFrom(m) : moveTo(m) > moveFrom(m)));
  } else {
    const r = SAN.exec(s);
    if (!r) return null;
    const type = r[1] ? PIECE[r[1]]! : PAWN;
    const to = squareIndex(r[4]!);
    const promo = r[5] ? PIECE[r[5]]! : 0;
    const found = legal.filter(m => {
      const from = moveFrom(m);
      if (moveTo(m) !== to || Math.abs(b.sq[from]!) !== type || movePromo(m) !== promo) return false;
      if (r[2] && squareName(from)[0] !== r[2]) return false;
      return !(r[3] && squareName(from)[1] !== r[3]);
    });
    if (found.length !== 1) return null;
    move = found[0];
  }
  if (move === undefined || !b.make(move)) return null;
  return squareName(moveFrom(move)) + squareName(moveTo(move)) + PROMO_LETTER[movePromo(move)]!;
}

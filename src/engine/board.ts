/**
 * A compact 0x88 board used only by the engine search, where chess.js is far
 * too slow (it builds SAN/FEN strings for every generated move). The UI and
 * all game rules still go through chess.js.
 *
 * Squares: index = rank * 16 + file (a1 = 0, h8 = 119); off-board when (sq & 0x88).
 * Pieces: 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king; positive = White.
 * Moves are packed ints: from | to << 7 | promo << 14 | flags << 17.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;

export const moveFrom = (m: number) => m & 0x7f;
export const moveTo = (m: number) => (m >> 7) & 0x7f;
export const movePromo = (m: number) => (m >> 14) & 0x7;
export const moveFlags = (m: number) => m >> 17;
const pack = (from: number, to: number, promo: number, flags: number) => from | (to << 7) | (promo << 14) | (flags << 17);

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [16, -16, 1, -1];
const KING_OFFSETS = [...BISHOP_DIRS, ...ROOK_DIRS];

const FEN_PIECE: Record<string, number> = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

// castling rights: 1 = White O-O, 2 = White O-O-O, 4 = Black O-O, 8 = Black O-O-O
const CASTLE_MASK = new Int8Array(128);
CASTLE_MASK[0x04] = 3;
CASTLE_MASK[0x07] = 1;
CASTLE_MASK[0x00] = 2;
CASTLE_MASK[0x74] = 12;
CASTLE_MASK[0x77] = 4;
CASTLE_MASK[0x70] = 8;

// Two independent sets of Zobrist keys from fixed-seed xorshift generators, so
// hashes are reproducible. `hash` indexes the transposition table and `hash2`
// verifies the entry, which makes collisions practically impossible.
interface ZobristKeys {
  piece: Int32Array[];
  side: number;
  castle: Int32Array;
  ep: Int32Array;
}

function zobrist(seed: number): ZobristKeys {
  const rand32 = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed | 0;
  };
  return {
    piece: Array.from({ length: 12 }, () => Int32Array.from({ length: 128 }, rand32)),
    side: rand32(),
    castle: Int32Array.from({ length: 16 }, rand32),
    ep: Int32Array.from({ length: 8 }, rand32),
  };
}

const K1 = zobrist(0x9e3779b9);
const K2 = zobrist(0x2545f491);
const pieceIndex = (piece: number) => (piece > 0 ? piece - 1 : 5 - piece);

interface Undo {
  move: number;
  captured: number;
  castling: number;
  ep: number;
  halfmove: number;
  hash: number;
  hash2: number;
}

export const squareName = (sq: number) => 'abcdefgh'[sq & 7]! + ((sq >> 4) + 1);
export const squareIndex = (name: string) => (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
export const PROMO_LETTER = ['', '', 'n', 'b', 'r', 'q'] as const;

export class Board {
  sq = new Int8Array(128);
  /** 1 = White to move, -1 = Black. */
  side = 1;
  castling = 0;
  ep = -1;
  halfmove = 0;
  hash = 0;
  hash2 = 0;
  kings: Record<number, number> = { 1: -1, [-1]: -1 };
  private stack: Undo[] = [];
  /** Hashes of earlier positions, for repetition detection. */
  private history: number[] = [];

  static fromFen(fen: string): Board {
    const b = new Board();
    const [placement = '', side = 'w', castling = '-', ep = '-', half = '0'] = fen.trim().split(/\s+/);
    placement.split('/').forEach((row, i) => {
      const rank = 7 - i;
      let file = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') file += Number(ch);
        else {
          const type = FEN_PIECE[ch.toLowerCase()] ?? 0;
          const piece = ch === ch.toUpperCase() ? type : -type;
          const s = rank * 16 + file;
          b.sq[s] = piece;
          if (type === KING) b.kings[piece > 0 ? 1 : -1] = s;
          file++;
        }
      }
    });
    b.side = side === 'b' ? -1 : 1;
    for (const [ch, bit] of [['K', 1], ['Q', 2], ['k', 4], ['q', 8]] as const) if (castling.includes(ch)) b.castling |= bit;
    b.ep = ep !== '-' ? squareIndex(ep) : -1;
    b.halfmove = Number(half) || 0;
    b.hash = b.computeHash();
    b.hash2 = b.computeHash(K2);
    return b;
  }

  computeHash(k: ZobristKeys = K1): number {
    let h = 0;
    for (let s = 0; s < 128; s++) if (!(s & 0x88) && this.sq[s]) h ^= k.piece[pieceIndex(this.sq[s]!)]![s]!;
    if (this.side < 0) h ^= k.side;
    h ^= k.castle[this.castling]!;
    if (this.ep >= 0) h ^= k.ep[this.ep & 7]!;
    return h;
  }

  /** True if both incremental hashes match a from-scratch computation. */
  hashesConsistent(): boolean {
    return this.hash === this.computeHash(K1) && this.hash2 === this.computeHash(K2);
  }

  /** XORs a piece on a square into both hashes. */
  private togglePiece(piece: number, s: number) {
    const i = pieceIndex(piece);
    this.hash ^= K1.piece[i]![s]!;
    this.hash2 ^= K2.piece[i]![s]!;
  }

  private toggleState() {
    this.hash ^= K1.castle[this.castling]!;
    this.hash2 ^= K2.castle[this.castling]!;
    if (this.ep >= 0) {
      this.hash ^= K1.ep[this.ep & 7]!;
      this.hash2 ^= K2.ep[this.ep & 7]!;
    }
  }

  /** Is `s` attacked by side `by` (1 or -1)? */
  attacked(s: number, by: number): boolean {
    const sq = this.sq;
    // pawns: a White pawn on p attacks p+15 and p+17
    const p1 = s - 15 * by;
    const p2 = s - 17 * by;
    if (!(p1 & 0x88) && sq[p1] === PAWN * by) return true;
    if (!(p2 & 0x88) && sq[p2] === PAWN * by) return true;
    for (const o of KNIGHT_OFFSETS) {
      const t = s + o;
      if (!(t & 0x88) && sq[t] === KNIGHT * by) return true;
    }
    for (const o of KING_OFFSETS) {
      const t = s + o;
      if (!(t & 0x88) && sq[t] === KING * by) return true;
    }
    for (const d of BISHOP_DIRS)
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = sq[t]!;
        if (p) {
          if (p === BISHOP * by || p === QUEEN * by) return true;
          break;
        }
      }
    for (const d of ROOK_DIRS)
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = sq[t]!;
        if (p) {
          if (p === ROOK * by || p === QUEEN * by) return true;
          break;
        }
      }
    return false;
  }

  inCheck(): boolean {
    return this.attacked(this.kings[this.side]!, -this.side);
  }

  /** Pseudo-legal moves; `make` rejects those that leave the king in check. */
  generate(capturesOnly = false): number[] {
    const moves: number[] = [];
    const { sq, side } = this;
    const push = (from: number, to: number, flags: number) => {
      const rank = to >> 4;
      if (Math.abs(sq[from]!) === PAWN && (rank === 7 || rank === 0))
        for (const promo of [QUEEN, KNIGHT, ROOK, BISHOP]) moves.push(pack(from, to, promo, flags));
      else moves.push(pack(from, to, 0, flags));
    };

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) {
        from += 7;
        continue;
      }
      const piece = sq[from]! * side;
      if (piece <= 0) continue;

      if (piece === PAWN) {
        const fwd = from + 16 * side;
        const lastRank = side > 0 ? 7 : 0;
        if (!(fwd & 0x88) && !sq[fwd]) {
          if (!capturesOnly || fwd >> 4 === lastRank) push(from, fwd, 0);
          const startRank = side > 0 ? 1 : 6;
          const dbl = fwd + 16 * side;
          if (!capturesOnly && from >> 4 === startRank && !sq[dbl]) moves.push(pack(from, dbl, 0, F_DOUBLE));
        }
        for (const d of [15, 17]) {
          const to = from + d * side;
          if (to & 0x88) continue;
          if (sq[to]! * side < 0) push(from, to, F_CAPTURE);
          else if (to === this.ep) moves.push(pack(from, to, 0, F_CAPTURE | F_EP));
        }
        continue;
      }

      const offsets = piece === KNIGHT ? KNIGHT_OFFSETS : piece === BISHOP ? BISHOP_DIRS : piece === ROOK ? ROOK_DIRS : KING_OFFSETS;
      const slides = piece === BISHOP || piece === ROOK || piece === QUEEN;
      for (const o of offsets) {
        for (let to = from + o; !(to & 0x88); to += o) {
          const target = sq[to]! * side;
          if (target > 0) break;
          if (target < 0) {
            moves.push(pack(from, to, 0, F_CAPTURE));
            break;
          }
          if (!capturesOnly) moves.push(pack(from, to, 0, 0));
          if (!slides) break;
        }
      }

      if (piece === KING && !capturesOnly) this.castleMoves(from, moves);
    }
    return moves;
  }

  private castleMoves(from: number, moves: number[]) {
    const { sq, side } = this;
    const home = side > 0 ? 0x04 : 0x74;
    if (from !== home) return;
    const [kBit, qBit] = side > 0 ? [1, 2] : [4, 8];
    const enemy = -side;
    if (this.castling & kBit && !sq[home + 1] && !sq[home + 2] && sq[home + 3] === ROOK * side)
      if (!this.attacked(home, enemy) && !this.attacked(home + 1, enemy) && !this.attacked(home + 2, enemy))
        moves.push(pack(home, home + 2, 0, F_CASTLE));
    if (this.castling & qBit && !sq[home - 1] && !sq[home - 2] && !sq[home - 3] && sq[home - 4] === ROOK * side)
      if (!this.attacked(home, enemy) && !this.attacked(home - 1, enemy) && !this.attacked(home - 2, enemy))
        moves.push(pack(home, home - 2, 0, F_CASTLE));
  }

  /** Plays `m`. Returns false (and leaves the board unchanged) if it is illegal. */
  make(m: number): boolean {
    const sq = this.sq;
    const from = moveFrom(m);
    const to = moveTo(m);
    const promo = movePromo(m);
    const flags = moveFlags(m);
    const side = this.side;
    const piece = sq[from]!;
    let captured = sq[to]!;

    this.stack.push({
      move: m,
      captured,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      hash: this.hash,
      hash2: this.hash2,
    });
    this.history.push(this.hash);

    this.togglePiece(piece, from);
    if (captured) this.togglePiece(captured, to);
    if (flags & F_EP) {
      const capSq = to - 16 * side;
      captured = sq[capSq]!;
      this.stack[this.stack.length - 1]!.captured = captured;
      sq[capSq] = 0;
      this.togglePiece(captured, capSq);
    }
    const placed = promo ? promo * side : piece;
    sq[to] = placed;
    sq[from] = 0;
    this.togglePiece(placed, to);

    if (flags & F_CASTLE) {
      const [rFrom, rTo] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
      const rook = sq[rFrom]!;
      sq[rTo] = rook;
      sq[rFrom] = 0;
      this.togglePiece(rook, rFrom);
      this.togglePiece(rook, rTo);
    }
    if (Math.abs(piece) === KING) this.kings[side] = to;

    this.toggleState();
    this.castling &= ~(CASTLE_MASK[from]! | CASTLE_MASK[to]!);
    this.ep = flags & F_DOUBLE ? from + 16 * side : -1;
    this.toggleState();
    this.halfmove = Math.abs(piece) === PAWN || captured ? 0 : this.halfmove + 1;
    this.side = -side;
    this.hash ^= K1.side;
    this.hash2 ^= K2.side;

    if (this.attacked(this.kings[side]!, -side)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake(): void {
    const u = this.stack.pop();
    if (!u) return;
    this.history.pop();
    const sq = this.sq;
    const from = moveFrom(u.move);
    const to = moveTo(u.move);
    const flags = moveFlags(u.move);
    this.side = -this.side;
    const side = this.side;
    const moved = movePromo(u.move) ? PAWN * side : sq[to]!;
    sq[from] = moved;
    if (flags & F_EP) {
      sq[to] = 0;
      sq[to - 16 * side] = u.captured;
    } else sq[to] = u.captured;
    if (flags & F_CASTLE) {
      const [rFrom, rTo] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
      sq[rFrom] = sq[rTo]!;
      sq[rTo] = 0;
    }
    if (Math.abs(moved) === KING) this.kings[side] = from;
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    this.hash = u.hash;
    this.hash2 = u.hash2;
  }

  /**
   * Passes the move to the other side (a "null move", used by the search to
   * ask what the opponent would do if allowed two moves in a row). Undo with
   * `unmakeNull`. Repetitions aren't looked for across it.
   */
  makeNull(): void {
    this.stack.push({ move: 0, captured: 0, castling: this.castling, ep: this.ep, halfmove: this.halfmove, hash: this.hash, hash2: this.hash2 });
    this.history.push(this.hash);
    this.toggleState();
    this.ep = -1;
    this.toggleState();
    this.halfmove = 0;
    this.side = -this.side;
    this.hash ^= K1.side;
    this.hash2 ^= K2.side;
  }

  unmakeNull(): void {
    const u = this.stack.pop();
    if (!u) return;
    this.history.pop();
    this.side = -this.side;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    this.hash = u.hash;
    this.hash2 = u.hash2;
  }

  /** Whether `side` (1 or -1) has a piece other than pawns and the king. */
  hasPieces(side: number): boolean {
    for (let s = 0; s < 128; s++) {
      const p = this.sq[s]! * side;
      if (p > PAWN && p < KING) return true;
    }
    return false;
  }

  /** True if the current position already occurred since the last irreversible move. */
  isRepetition(): boolean {
    const h = this.history;
    for (let i = h.length - 2, n = 0; i >= 0 && n < this.halfmove; i -= 2, n += 2) if (h[i] === this.hash) return true;
    return false;
  }

  legalMoves(): number[] {
    return this.generate().filter(m => {
      if (!this.make(m)) return false;
      this.unmake();
      return true;
    });
  }

  /** Plays a move given in from/to/promotion form; throws if it is not legal. */
  playUci(from: string, to: string, promotion?: string): void {
    const f = squareIndex(from);
    const t = squareIndex(to);
    const promo = promotion ? (FEN_PIECE[promotion] ?? 0) : 0;
    const m = this.generate().find(x => moveFrom(x) === f && moveTo(x) === t && movePromo(x) === promo);
    if (m === undefined || !this.make(m)) throw new Error(`Illegal move ${from}${to}${promotion ?? ''}`);
  }
}

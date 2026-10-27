import type { Chess, Color, PieceSymbol, Square } from 'chess.js';
import {
  BISHOP,
  Board,
  F_CAPTURE,
  F_EP,
  KING,
  KNIGHT,
  moveFlags,
  moveFrom,
  movePromo,
  moveTo,
  PAWN,
  PROMO_LETTER,
  QUEEN,
  ROOK,
  squareName,
} from './board.ts';
import { changesEvaluation, styleTerms, type PlayStyle } from './style.ts';

/**
 * This app's own engine: negamax with alpha-beta pruning, principal
 * variation search, a transposition table, iterative deepening with
 * aspiration windows, null-move pruning, late-move reductions, MVV-LVA,
 * killer and history move ordering, a check extension and a quiescence
 * search that also answers checks. The evaluation tapers between middlegame
 * and endgame terms: material, piece placement, pawn structure, passed
 * pawns, mobility, king shelter, rooks on open files and the bishop pair.
 * Every term and value here was written for this project.
 */

export interface Level {
  /** Maximum iterative-deepening depth in plies. */
  depth: number;
  /** Soft time budget; the last fully completed depth is used. */
  maxMs: number;
  /** Uniform random noise added to root scores, in centipawns. */
  noise: number;
  quiescence: boolean;
  /** A bot's playing style (Phase 16); the numbered levels have none. */
  style?: PlayStyle;
}

export const LEVELS: readonly Level[] = [
  { depth: 1, maxMs: 300, noise: 350, quiescence: false },
  { depth: 1, maxMs: 400, noise: 200, quiescence: true },
  { depth: 2, maxMs: 600, noise: 120, quiescence: true },
  { depth: 3, maxMs: 800, noise: 60, quiescence: true },
  { depth: 4, maxMs: 1200, noise: 30, quiescence: true },
  { depth: 5, maxMs: 1500, noise: 12, quiescence: true },
  { depth: 6, maxMs: 2000, noise: 0, quiescence: true },
  { depth: 20, maxMs: 4000, noise: 0, quiescence: true },
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = LEVELS.length;

export function levelSettings(level: number): Level {
  const i = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level))) - 1;
  return LEVELS[i]!;
}

// ------------------------------------------------------------- evaluation

// indexed by piece code (1 pawn … 6 king); middlegame and endgame values
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MG_VALUE = [0, 100, 320, 330, 480, 950, 0];
const EG_VALUE = [0, 120, 300, 320, 530, 950, 0];
/** How much each piece counts towards "middlegame-ness" (24 = all pieces on). */
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];

export const MATE = 100_000;
const INF = 1_000_000;
const MAX_QDEPTH = 8;
const MAX_PLY = 64;
const MATE_BOUND = MATE - 2 * MAX_PLY;

// by relative rank 0..7
const PAWN_ADVANCE_MG = [0, 0, 4, 10, 20, 32, 50, 0];
const PAWN_ADVANCE_EG = [0, 0, 8, 18, 32, 52, 80, 0];
const PASSED_MG = [0, 4, 8, 14, 24, 40, 64, 0];
const PASSED_EG = [0, 10, 18, 32, 54, 84, 124, 0];

/** 0 at the corners, 6 at the four centre squares. */
const centrality = (file: number, rank: number) => 6 - Math.floor(Math.abs(file - 3.5)) - Math.floor(Math.abs(rank - 3.5));

/** Piece placement for [middlegame, endgame], from simple formulas. */
function placement(type: number, file: number, relRank: number): [number, number] {
  const c = centrality(file, relRank);
  switch (type) {
    case PAWN: {
      const centre = (file === 3 || file === 4) && relRank >= 2 && relRank <= 4 ? 12 : 0;
      return [PAWN_ADVANCE_MG[relRank]! + centre, PAWN_ADVANCE_EG[relRank]!];
    }
    case KNIGHT:
      return [6 * c - 18, 4 * c - 12];
    case BISHOP:
      return [3 * c - 6, 2 * c - 4];
    case ROOK:
      return [relRank === 6 ? 18 : 0, relRank === 6 ? 12 : 0];
    case QUEEN:
      return [c - 3, 2 * c - 6];
    case KING:
      return [-5 * c + (relRank === 0 ? 12 : 0), 6 * c - 18];
    default:
      return [0, 0];
  }
}

const KNIGHT_STEPS = [33, 31, 18, 14, -33, -31, -18, -14];
const DIAGONALS = [15, 17, -15, -17];
const LINES = [16, -16, 1, -1];
// mobility per reachable square, relative to a typical count
const MOBILITY: Record<number, { dirs: number[]; slides: boolean; base: number; mg: number; eg: number }> = {
  [KNIGHT]: { dirs: KNIGHT_STEPS, slides: false, base: 4, mg: 4, eg: 4 },
  [BISHOP]: { dirs: DIAGONALS, slides: true, base: 6, mg: 5, eg: 5 },
  [ROOK]: { dirs: LINES, slides: true, base: 7, mg: 2, eg: 4 },
  [QUEEN]: { dirs: [...DIAGONALS, ...LINES], slides: true, base: 13, mg: 1, eg: 2 },
};

function mobility(sq: Int8Array, s: number, type: number, white: boolean): number {
  const m = MOBILITY[type]!;
  let n = 0;
  for (const d of m.dirs)
    for (let t = s + d; !(t & 0x88); t += d) {
      const p = sq[t]!;
      if (p && p > 0 === white) break;
      n++;
      if (p || !m.slides) break;
    }
  return n - m.base;
}

/** Static evaluation in centipawns from White's point of view. */
export function evaluateBoard(b: Board): number {
  const sq = b.sq;
  // pawns per file, and the most / least advanced pawn of each side per file
  const wCount = new Int8Array(8);
  const bCount = new Int8Array(8);
  const wMin = new Int8Array(8).fill(8);
  const bMax = new Int8Array(8).fill(-1);
  let phase = 0;
  let wNonPawn = 0;
  let bNonPawn = 0;
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const p = sq[rank * 16 + file]!;
      if (p === PAWN) {
        wCount[file]!++;
        if (rank < wMin[file]!) wMin[file] = rank;
      } else if (p === -PAWN) {
        bCount[file]!++;
        if (rank > bMax[file]!) bMax[file] = rank;
      } else if (p) {
        const type = Math.abs(p);
        phase += PHASE_WEIGHT[type]!;
        if (p > 0) wNonPawn += VALUE[type]!;
        else bNonPawn += VALUE[type]!;
      }
    }

  let mg = 0;
  let eg = 0;
  let wBishops = 0;
  let bBishops = 0;
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const s = rank * 16 + file;
      const p = sq[s]!;
      if (!p) continue;
      const type = Math.abs(p);
      const white = p > 0;
      const sign = white ? 1 : -1;
      const relRank = white ? rank : 7 - rank;
      const [pm, pe] = placement(type, file, relRank);
      let m = MG_VALUE[type]! + pm;
      let e = EG_VALUE[type]! + pe;

      if (type === PAWN) {
        const own = white ? wCount : bCount;
        const left = file > 0 ? own[file - 1]! : 0;
        const right = file < 7 ? own[file + 1]! : 0;
        if (!left && !right) {
          m -= 10;
          e -= 15;
        }
        let passed = true;
        for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++)
          if (white ? bMax[f]! > rank : wMin[f]! < rank) {
            passed = false;
            break;
          }
        if (passed) {
          m += PASSED_MG[relRank]!;
          e += PASSED_EG[relRank]!;
        }
      } else if (type === BISHOP) {
        if (white) wBishops++;
        else bBishops++;
        const mob = mobility(sq, s, type, white);
        m += mob * MOBILITY[type]!.mg;
        e += mob * MOBILITY[type]!.eg;
      } else if (type === KNIGHT || type === QUEEN) {
        const mob = mobility(sq, s, type, white);
        m += mob * MOBILITY[type]!.mg;
        e += mob * MOBILITY[type]!.eg;
      } else if (type === ROOK) {
        const mob = mobility(sq, s, type, white);
        m += mob * MOBILITY[type]!.mg;
        e += mob * MOBILITY[type]!.eg;
        const own = white ? wCount[file]! : bCount[file]!;
        const theirs = white ? bCount[file]! : wCount[file]!;
        if (!own && !theirs) {
          m += 20;
          e += 10;
        } else if (!own) {
          m += 10;
          e += 5;
        }
      } else if (type === KING && relRank <= 1) {
        // pawns in front of a king on its back two ranks shelter it
        for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
          const one = sq[(rank + sign) * 16 + f];
          const two = sq[(rank + 2 * sign) * 16 + f];
          if (one === PAWN * sign) m += 12;
          else if (two === PAWN * sign) m += 6;
          else m -= 15;
        }
      }
      mg += sign * m;
      eg += sign * e;
    }

  // doubled pawns
  for (let f = 0; f < 8; f++) {
    if (wCount[f]! > 1) {
      mg -= 12 * (wCount[f]! - 1);
      eg -= 20 * (wCount[f]! - 1);
    }
    if (bCount[f]! > 1) {
      mg += 12 * (bCount[f]! - 1);
      eg += 20 * (bCount[f]! - 1);
    }
  }
  if (wBishops >= 2) {
    mg += 30;
    eg += 50;
  }
  if (bBishops >= 2) {
    mg -= 30;
    eg -= 50;
  }

  const p = Math.min(24, phase);
  let score = Math.round((mg * p + eg * (24 - p)) / 24) + 10 * b.side;

  // a lone minor piece (or nothing) without pawns can't win
  const wPawns = wCount.reduce((a, x) => a + x, 0);
  const bPawns = bCount.reduce((a, x) => a + x, 0);
  if (score > 0 && wPawns === 0 && wNonPawn <= VALUE[BISHOP]!) score = Math.min(score, 0);
  if (score < 0 && bPawns === 0 && bNonPawn <= VALUE[BISHOP]!) score = Math.max(score, 0);
  return score;
}

/** Rebuilds the engine board from a start position and moves, keeping repetition history. */
export function boardFrom(startFen: string, moves: readonly UciMove[]): Board {
  const board = Board.fromFen(startFen);
  for (const m of moves) board.playUci(m.from, m.to, m.promotion);
  return board;
}

const boardFromChess = (chess: Chess): Board => {
  const history = chess.history({ verbose: true });
  return boardFrom(history[0]?.before ?? chess.fen(), history);
};

export const evaluateWhite = (chess: Chess) => evaluateBoard(Board.fromFen(chess.fen()));

/** Static evaluation from the point of view of `color`. */
export const evaluateFor = (chess: Chess, color: Color) => (color === 'w' ? evaluateWhite(chess) : -evaluateWhite(chess));

// ------------------------------------------------------------ transposition table

const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

class TranspositionTable {
  private readonly mask: number;
  private readonly checks: Int32Array;
  private readonly moves: Int32Array;
  private readonly scores: Int32Array;
  private readonly depths: Int8Array;
  private readonly flags: Uint8Array;

  constructor(bits = 19) {
    const size = 1 << bits;
    this.mask = size - 1;
    this.checks = new Int32Array(size);
    this.moves = new Int32Array(size);
    this.scores = new Int32Array(size);
    this.depths = new Int8Array(size);
    this.flags = new Uint8Array(size);
  }

  /** Index of the entry for this position, or -1. */
  probe(b: Board): number {
    const i = b.hash & this.mask;
    return this.flags[i] && this.checks[i] === b.hash2 ? i : -1;
  }

  move = (i: number) => this.moves[i]!;
  depth = (i: number) => this.depths[i]!;
  flag = (i: number) => this.flags[i]!;
  /** Stored score, converted back from "mate in N from here" to "mate at ply". */
  score(i: number, ply: number) {
    const s = this.scores[i]!;
    return s > MATE_BOUND ? s - ply : s < -MATE_BOUND ? s + ply : s;
  }

  store(b: Board, depth: number, score: number, flag: number, move: number, ply: number) {
    const i = b.hash & this.mask;
    // keep a deeper entry for the same position
    if (this.flags[i] && this.checks[i] === b.hash2 && this.depths[i]! > depth) return;
    this.checks[i] = b.hash2;
    this.depths[i] = Math.max(0, Math.min(depth, 127));
    this.flags[i] = flag;
    this.moves[i] = move;
    this.scores[i] = score > MATE_BOUND ? score + ply : score < -MATE_BOUND ? score - ply : score;
  }
}

// ------------------------------------------------------------------- search

class Timeout extends Error {}

export interface UciMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export const toUci = (m: number): UciMove => {
  const promo = movePromo(m);
  return {
    from: squareName(moveFrom(m)) as Square,
    to: squareName(moveTo(m)) as Square,
    ...(promo ? { promotion: PROMO_LETTER[promo] as PieceSymbol } : {}),
  };
};

const isMateScore = (s: number) => Math.abs(s) > MATE_BOUND;

/** A tempting reply that loses this much (centipawns) against the opponent's best reply counts as a trap. */
const TRAP_LOSS = 200;
/** Time allowed for the root bonuses after the search. */
const BONUS_MS = 250;
/** At most this many candidate moves are checked for traps. */
const TRAP_CANDIDATES = 5;

class Searcher {
  nodes = 0;
  readonly b: Board;
  readonly tt: TranspositionTable;
  private readonly deadline: number;
  private readonly now: () => number;
  private readonly quiescence: boolean;
  /** A style's extra evaluation (White's point of view), if any. */
  private readonly extra: ((b: Board) => number) | null;
  private readonly killers = new Int32Array(MAX_PLY * 2 + 4);
  /** Quiet moves that caused cut-offs, by piece and target square. */
  private readonly history = new Int32Array(13 * 128);
  /** Triangular PV table: pv[ply] is the best line found from that ply in the current search. */
  private readonly pv: number[][] = Array.from({ length: MAX_PLY + 16 }, () => []);

  constructor(b: Board, tt: TranspositionTable, deadline: number, now: () => number, quiescence = true, extra: ((b: Board) => number) | null = null) {
    this.b = b;
    this.tt = tt;
    this.deadline = deadline;
    this.now = now;
    this.quiescence = quiescence;
    this.extra = extra;
  }

  private checkTime() {
    if ((++this.nodes & 1023) === 0 && this.now() > this.deadline) throw new Timeout();
  }

  private historyIndex(m: number) {
    return (this.b.sq[moveFrom(m)]! + 6) * 128 + moveTo(m);
  }

  private moveScore(m: number, ttMove: number, ply: number): number {
    if (m === ttMove) return 1_000_000;
    const sq = this.b.sq;
    const promo = movePromo(m);
    let s = promo ? 90_000 + VALUE[promo]! : 0;
    const victim = moveFlags(m) & F_EP ? PAWN : Math.abs(sq[moveTo(m)]!);
    if (victim) s += 100_000 + 10 * VALUE[victim]! - VALUE[Math.abs(sq[moveFrom(m)]!)]!;
    else if (this.killers[ply * 2] === m) s += 50_000;
    else if (this.killers[ply * 2 + 1] === m) s += 49_000;
    else s += Math.min(40_000, this.history[this.historyIndex(m)]!);
    return s;
  }

  order(moves: number[], ttMove = 0, ply = 0): number[] {
    const scored = moves.map(m => ({ m, s: this.moveScore(m, ttMove, ply) }));
    scored.sort((x, y) => y.s - x.s);
    return scored.map(x => x.m);
  }

  private sideEval = () => this.b.side * (evaluateBoard(this.b) + (this.extra ? this.extra(this.b) : 0));

  private quiesce(alpha: number, beta: number, qdepth: number, ply: number): number {
    this.checkTime();
    const b = this.b;
    const inCheck = qdepth < 2 && b.inCheck();
    let best = -INF;
    if (!inCheck) {
      const standPat = this.sideEval();
      if (standPat >= beta || qdepth >= MAX_QDEPTH) return standPat;
      if (standPat > alpha) alpha = standPat;
      best = standPat;
    }
    let legal = 0;
    for (const m of this.order(b.generate(!inCheck))) {
      if (!b.make(m)) continue;
      legal++;
      let score: number;
      try {
        score = -this.quiesce(-beta, -alpha, qdepth + 1, ply + 1);
      } finally {
        b.unmake();
      }
      if (score > best) best = score;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    // in check with no way out: mated
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number, allowNull = true): number {
    this.checkTime();
    const b = this.b;
    if (ply < this.pv.length) this.pv[ply] = [];
    if (b.halfmove >= 100 || b.isRepetition()) return 0;
    // a mate found closer to the root can't be beaten
    alpha = Math.max(alpha, -MATE + ply);
    beta = Math.min(beta, MATE - ply - 1);
    if (alpha >= beta) return alpha;
    const inCheck = b.inCheck();
    if (inCheck && ply < MAX_PLY) depth++; // check extension
    if (depth <= 0) return this.quiescence ? this.quiesce(alpha, beta, 0, ply) : this.sideEval();

    const pvNode = beta - alpha > 1;
    const alphaOrig = alpha;
    const tti = this.tt.probe(b);
    let ttMove = 0;
    if (tti >= 0) {
      ttMove = this.tt.move(tti);
      if (this.tt.depth(tti) >= depth) {
        const s = this.tt.score(tti, ply);
        const f = this.tt.flag(tti);
        if (f === EXACT) {
          // keep the stored best move as the start of this node's line; extendPv adds the rest
          if (ply < this.pv.length) this.pv[ply] = ttMove ? [ttMove] : [];
          return s;
        }
        if (f === LOWER && s > alpha) alpha = s;
        else if (f === UPPER && s < beta) beta = s;
        if (alpha >= beta) {
          if (ply < this.pv.length) this.pv[ply] = ttMove ? [ttMove] : [];
          return s;
        }
      }
    }

    // null move: if passing still leaves us above beta, this position is good enough
    if (allowNull && !pvNode && !inCheck && depth >= 3 && ply > 0 && !isMateScore(beta) && b.hasPieces(b.side) && this.sideEval() >= beta) {
      const r = depth >= 6 ? 3 : 2;
      b.makeNull();
      let score: number;
      try {
        score = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
      } finally {
        b.unmakeNull();
      }
      if (score >= beta) return isMateScore(score) ? beta : score;
    }

    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    for (const m of this.order(b.generate(), ttMove, ply)) {
      if (!b.make(m)) continue;
      legal++;
      const quiet = !(moveFlags(m) & F_CAPTURE) && !movePromo(m);
      let score: number;
      try {
        if (legal === 1) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        else {
          // later quiet moves are searched less deeply first, and again in full if they look good
          let r = 0;
          const killer = this.killers[ply * 2] === m || this.killers[ply * 2 + 1] === m;
          if (depth >= 3 && quiet && !inCheck && legal > 3 && !killer && !b.inCheck()) r = Math.min(depth - 2, legal > 8 ? 2 : 1);
          score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1);
          if (score > alpha && r > 0) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
          if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        }
      } finally {
        b.unmake();
      }
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) {
        alpha = score;
        if (ply + 1 < this.pv.length) this.pv[ply] = [m, ...this.pv[ply + 1]!];
      }
      if (alpha >= beta) {
        if (quiet && ply < MAX_PLY) {
          if (this.killers[ply * 2] !== m) {
            this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
            this.killers[ply * 2] = m;
          }
          const h = this.historyIndex(m);
          this.history[h] = Math.min(40_000, this.history[h]! + depth * depth);
        }
        break;
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    this.tt.store(b, depth, best, flag, bestMove, ply);
    return best;
  }

  /** Exact score of one root move at `depth`. */
  scoreRootMove(m: number, depth: number, alpha = -INF, beta = INF): number {
    this.b.make(m);
    try {
      return -this.negamax(depth - 1, -beta, -alpha, 1);
    } finally {
      this.b.unmake();
    }
  }

  /**
   * Best of `moves` at `depth` within the window (alpha, beta), with its
   * principal variation. Moves after the first are tried with a null window
   * first. If none beats `alpha`, the result's score is `alpha` (a fail-low).
   */
  bestRootMove(moves: number[], depth: number, alpha = -INF, beta = INF): { move: number; score: number; pv: number[] } {
    let move = moves[0]!;
    let pv = [move];
    let first = true;
    for (const m of moves) {
      let score: number;
      if (first) score = this.scoreRootMove(m, depth, alpha, beta);
      else {
        score = this.scoreRootMove(m, depth, alpha, alpha + 1);
        if (score > alpha && score < beta) score = this.scoreRootMove(m, depth, alpha, beta);
      }
      first = false;
      if (score > alpha) {
        alpha = score;
        move = m;
        pv = [m, ...this.pv[1]!];
        if (alpha >= beta) break;
      }
    }
    return { move, score: alpha, pv };
  }

  /** Root search with an aspiration window around the previous score, widened on failure. */
  aspirate(moves: number[], depth: number, guess: number | null): { move: number; score: number; pv: number[] } {
    if (guess === null || depth < 4 || isMateScore(guess)) return this.bestRootMove(moves, depth);
    const window = 40;
    const found = this.bestRootMove(moves, depth, guess - window, guess + window);
    if (found.score > guess - window && found.score < guess + window) return found;
    return this.bestRootMove(moves, depth);
  }

  /**
   * How much of a trap root move `m` sets, from 0 to 1: the share of the
   * opponent's replies, weighted towards tempting ones (captures and checks),
   * that are captures or checks losing at least TRAP_LOSS against their best
   * reply. Each reply is looked at one ply deep plus captures.
   */
  trapValue(m: number): number {
    const b = this.b;
    if (!b.make(m)) return 0;
    try {
      const replies: { score: number; weight: number; tempting: boolean }[] = [];
      for (const r of b.generate()) {
        const capture = !!(moveFlags(r) & F_CAPTURE);
        if (!b.make(r)) continue;
        try {
          const tempting = capture || b.inCheck();
          // the reply's score for the opponent, who just played it
          replies.push({ score: -this.negamax(1, -INF, INF, 2), weight: tempting ? 2 : 1, tempting });
        } finally {
          b.unmake();
        }
      }
      if (!replies.length) return 0;
      const best = Math.max(...replies.map(r => r.score));
      const total = replies.reduce((a, r) => a + r.weight, 0);
      const bad = replies.reduce((a, r) => a + (r.tempting && r.score <= best - TRAP_LOSS ? r.weight : 0), 0);
      return bad / total;
    } finally {
      b.unmake();
    }
  }

  /** Whether root move `m` gives check. */
  givesCheck(m: number): boolean {
    if (!this.b.make(m)) return false;
    const check = this.b.inCheck();
    this.b.unmake();
    return check;
  }

  /**
   * Validates `pv` move by move (dropping anything illegal) and extends it
   * along transposition-table moves up to `maxLen` moves. Exact entries and
   * lower bounds are followed: in both, the stored move is the best one found.
   */
  extendPv(pv: number[], maxLen: number): number[] {
    const b = this.b;
    const out: number[] = [];
    const seen = new Set<number>([b.hash]);
    const extend = (m: number) => {
      if (!b.legalMoves().includes(m)) return false;
      b.make(m);
      out.push(m);
      if (seen.has(b.hash)) return false; // stop at a repetition
      seen.add(b.hash);
      return true;
    };
    let ok = true;
    for (const m of pv) if (!(ok = extend(m))) break;
    while (ok && out.length < maxLen) {
      const i = this.tt.probe(b);
      if (i < 0 || this.tt.flag(i) === UPPER || !this.tt.move(i)) break;
      ok = extend(this.tt.move(i));
    }
    for (let k = 0; k < out.length; k++) b.unmake();
    return out;
  }
}

// --------------------------------------------------------------- play mode

export interface EngineMove extends UciMove {
  /** Score in centipawns from the engine's point of view. */
  score: number;
  /** Deepest fully completed search depth. */
  depth: number;
  /** The best root score found (`score` is lower when noise or a style picked another move). */
  best: number;
}

export interface SearchOptions {
  rng?: () => number;
  now?: () => number;
}

interface RootScore {
  move: number;
  score: number;
}

/**
 * Picks a move for the side to move in `chess`, using its history so
 * repetitions are seen. Returns null if there are no legal moves.
 * `chess` itself is not modified.
 */
export function chooseMove(chess: Chess, level: number | Level, opts: SearchOptions = {}): EngineMove | null {
  const settings = typeof level === 'number' ? levelSettings(level) : level;
  const style = settings.style;
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? (() => performance.now());
  const b = boardFromChess(chess);
  const botSide = b.side;
  const extra = style && changesEvaluation(style) ? (x: Board) => styleTerms(x, botSide, style) : null;
  const tt = new TranspositionTable(17);
  const s = new Searcher(b, tt, now() + settings.maxMs, now, settings.quiescence, extra);
  const rootMoves = s.order(b.legalMoves());
  if (rootMoves.length === 0) return null;

  // Noisy levels, and styles with root bonuses, need an exact score for every
  // root move, so each is searched with a full window; strict levels only need the best move.
  const noisy = settings.noise > 0 || !!(style?.checks || style?.traps);
  let completed: RootScore[] | null = null;
  let completedDepth = 0;

  for (let depth = 1; depth <= settings.depth; depth++) {
    const order: number[] = completed ? [...completed].sort((x, y) => y.score - x.score).map(r => r.move) : rootMoves;
    try {
      if (noisy) completed = order.map(m => ({ move: m, score: s.scoreRootMove(m, depth) }));
      else {
        const best = s.aspirate(order, depth, completed?.[0]?.score ?? null);
        completed = [best, ...order.filter(m => m !== best.move).map(move => ({ move, score: -INF }))];
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      completed ??= rootMoves.map(move => ({ move, score: 0 }));
      break;
    }
    completedDepth = depth;
    if (completed?.some(r => r.score > MATE_BOUND)) break; // forced mate found
  }

  const bonus = style ? rootBonuses(new Searcher(b, tt, now() + BONUS_MS, now, settings.quiescence, extra), completed!, style) : null;
  let pick = completed![0]!;
  let pickValue = -INF;
  for (const c of completed!) {
    const value = c.score + (isMateScore(c.score) ? 0 : (rng() * 2 - 1) * settings.noise + (bonus?.get(c.move) ?? 0));
    if (value > pickValue) {
      pickValue = value;
      pick = c;
    }
  }
  return { ...toUci(pick.move), score: pick.score, depth: completedDepth, best: Math.max(...completed!.map(c => c.score)) };
}

/**
 * A style's bonuses for the root moves: checks for every checking move, and
 * traps for the few moves close enough to the best for the bonus to matter.
 * Stops quietly when its time runs out.
 */
function rootBonuses(s: Searcher, scores: readonly RootScore[], style: PlayStyle): Map<number, number> {
  const out = new Map<number, number>();
  const best = Math.max(...scores.map(c => c.score));
  if (isMateScore(best)) return out;
  try {
    if (style.checks) for (const c of scores) if (s.givesCheck(c.move)) out.set(c.move, style.checks);
    if (style.traps) {
      const close = scores.filter(c => c.score + style.traps! > best && !isMateScore(c.score)).sort((x, y) => y.score - x.score).slice(0, TRAP_CANDIDATES);
      for (const c of close) out.set(c.move, (out.get(c.move) ?? 0) + Math.round(style.traps * s.trapValue(c.move)));
    }
  } catch (e) {
    if (!(e instanceof Timeout)) throw e;
  }
  return out;
}

/** How much of a trap `move` sets in this position, 0 to 1 (see Searcher.trapValue). */
export function trapValue(fen: string, move: UciMove, now: () => number = () => performance.now()): number {
  const b = Board.fromFen(fen);
  const m = b.legalMoves().find(x => sameUci(x, move));
  if (m === undefined) return 0;
  try {
    return new Searcher(b, new TranspositionTable(16), now() + 2000, now).trapValue(m);
  } catch (e) {
    if (!(e instanceof Timeout)) throw e;
    return 0;
  }
}

/** Whether the engine (playing `color`) accepts a draw offer in this position. */
export function acceptsDraw(chess: Chess, color: Color): boolean {
  return evaluateFor(chess, color) <= -150;
}

// ----------------------------------------------------------- analysis mode

export interface AnalysisLine {
  /** Principal variation starting with the candidate move. */
  pv: UciMove[];
  /** Centipawns from White's point of view; null when the line is a forced mate. */
  cp: number | null;
  /** Moves to mate: positive = White mates, negative = Black mates; null otherwise. */
  mate: number | null;
}

export interface AnalysisInfo {
  depth: number;
  lines: AnalysisLine[];
  nodes: number;
  elapsedMs: number;
}

export interface AnalyseOptions {
  multiPv?: number;
  maxDepth?: number;
  maxMs?: number;
  now?: () => number;
  /** Only consider these first moves (used to share the root between several workers). */
  rootMoves?: readonly UciMove[];
  /** Called after every completed depth. */
  onInfo?: (info: AnalysisInfo) => void;
}

/** Converts a side-to-move score into White-relative cp / mate-in-N. */
function lineScore(score: number, side: number): Pick<AnalysisLine, 'cp' | 'mate'> {
  const white = score * side;
  if (!isMateScore(score)) return { cp: white, mate: null };
  const plies = MATE - Math.abs(score);
  const moves = Math.ceil(plies / 2);
  return { cp: null, mate: white > 0 ? moves : -moves };
}

const sameUci = (m: number, u: UciMove) => {
  const x = toUci(m);
  return x.from === u.from && x.to === u.to && (x.promotion ?? '') === (u.promotion ?? '');
};

/**
 * Iterative-deepening analysis of a position with up to `multiPv` best lines.
 * Returns the deepest completed result (null if there are no legal moves).
 */
export function analyse(startFen: string, moves: readonly UciMove[], opts: AnalyseOptions = {}): AnalysisInfo | null {
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const maxDepth = opts.maxDepth ?? 30;
  const b = boardFrom(startFen, moves);
  const s = new Searcher(b, new TranspositionTable(), started + (opts.maxMs ?? 10_000), now);
  const legal = b.legalMoves();
  const allowed = opts.rootMoves ? legal.filter(m => opts.rootMoves!.some(u => sameUci(m, u))) : legal;
  const rootMoves = s.order(allowed);
  if (rootMoves.length === 0) return null;
  const multiPv = Math.max(1, Math.min(opts.multiPv ?? 1, rootMoves.length));

  let result: AnalysisInfo | null = null;
  let previous: number[] = [];
  let guess: number | null = null;
  for (let depth = 1; depth <= Math.min(maxDepth, MAX_PLY - 1); depth++) {
    const found: { move: number; score: number; pv: number[] }[] = [];
    try {
      const order = [...previous, ...rootMoves.filter(m => !previous.includes(m))];
      for (let k = 0; k < multiPv; k++) {
        const remaining = order.filter(m => !found.some(f => f.move === m));
        found.push(k === 0 ? s.aspirate(remaining, depth, guess) : s.bestRootMove(remaining, depth));
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
    found.sort((x, y) => y.score - x.score);
    previous = found.map(f => f.move);
    guess = found[0]!.score;
    result = {
      depth,
      lines: found.map(f => ({ pv: s.extendPv(f.pv, Math.max(depth, 8)).map(toUci), ...lineScore(f.score, b.side) })),
      nodes: s.nodes,
      elapsedMs: Math.round(now() - started),
    };
    opts.onInfo?.(result);
    // once every line is a forced mate, deeper search cannot change the result
    if (found.every(f => isMateScore(f.score)) && depth > Math.max(...found.map(f => MATE - Math.abs(f.score)))) break;
  }
  return result;
}

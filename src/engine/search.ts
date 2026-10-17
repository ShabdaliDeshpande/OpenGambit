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
} from './board';

/**
 * A small original engine: negamax with alpha-beta pruning, a transposition
 * table, iterative deepening, MVV-LVA ordering with killer moves, a check
 * extension and a capture-only quiescence search. Evaluation is material plus
 * simple formula-based positional terms.
 */

export interface Level {
  /** Maximum iterative-deepening depth in plies. */
  depth: number;
  /** Soft time budget; the last fully completed depth is used. */
  maxMs: number;
  /** Uniform random noise added to root scores, in centipawns. */
  noise: number;
  quiescence: boolean;
}

export const LEVELS: readonly Level[] = [
  { depth: 1, maxMs: 300, noise: 350, quiescence: false },
  { depth: 1, maxMs: 400, noise: 200, quiescence: true },
  { depth: 2, maxMs: 600, noise: 120, quiescence: true },
  { depth: 3, maxMs: 800, noise: 60, quiescence: true },
  { depth: 4, maxMs: 1200, noise: 30, quiescence: true },
  { depth: 4, maxMs: 1500, noise: 12, quiescence: true },
  { depth: 5, maxMs: 2000, noise: 0, quiescence: true },
  { depth: 12, maxMs: 4000, noise: 0, quiescence: true },
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = LEVELS.length;

export function levelSettings(level: number): Level {
  const i = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level))) - 1;
  return LEVELS[i]!;
}

// indexed by piece code (1 pawn … 6 king)
const VALUE = [0, 100, 320, 330, 500, 900, 0];
export const MATE = 100_000;
const INF = 1_000_000;
const MAX_QDEPTH = 8;
const MAX_PLY = 64;
const MATE_BOUND = MATE - 2 * MAX_PLY;

// rank advancement bonus for pawns, indexed by relative rank 0..7
const PAWN_ADVANCE = [0, 0, 4, 10, 22, 38, 65, 0];

/** 0 at the corners, 6 at the four center squares. */
const centrality = (file: number, rank: number) =>
  6 - Math.floor(Math.abs(file - 3.5)) - Math.floor(Math.abs(rank - 3.5));

function positional(type: number, file: number, relRank: number, endgame: boolean): number {
  const c = centrality(file, relRank);
  switch (type) {
    case PAWN:
      return PAWN_ADVANCE[relRank]! + ((file === 3 || file === 4) && relRank >= 2 && relRank <= 4 ? 12 : 0);
    case KNIGHT:
      return 6 * c - 18;
    case BISHOP:
      return 3 * c - 6;
    case ROOK:
      return relRank === 6 ? 18 : 0;
    case QUEEN:
      return c - 3;
    case KING:
      return endgame ? 6 * c - 18 : -5 * c + (relRank === 0 ? 12 : 0);
    default:
      return 0;
  }
}

/** Static evaluation in centipawns from White's point of view. */
export function evaluateBoard(b: Board): number {
  const sq = b.sq;
  let nonPawn = 0;
  for (let s = 0; s < 120; s++) {
    const p = Math.abs(sq[s]!);
    if (p > PAWN && p < KING) nonPawn += VALUE[p]!;
  }
  const endgame = nonPawn <= 1_300;
  let score = 0;
  let wb = 0;
  let bb = 0;
  for (let rank = 0; rank < 8; rank++)
    for (let file = 0; file < 8; file++) {
      const p = sq[rank * 16 + file]!;
      if (!p) continue;
      const type = Math.abs(p);
      const white = p > 0;
      const v = VALUE[type]! + positional(type, file, white ? rank : 7 - rank, endgame);
      score += white ? v : -v;
      if (type === BISHOP) white ? wb++ : bb++;
    }
  if (wb >= 2) score += 30;
  if (bb >= 2) score -= 30;
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
export const evaluateFor = (chess: Chess, color: Color) =>
  color === 'w' ? evaluateWhite(chess) : -evaluateWhite(chess);

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
    this.depths[i] = Math.min(depth, 127);
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

class Searcher {
  nodes = 0;
  private readonly killers = new Int32Array(MAX_PLY * 2 + 4);
  /** Triangular PV table: pv[ply] is the best line found from that ply in the current search. */
  private readonly pv: number[][] = Array.from({ length: MAX_PLY + 16 }, () => []);

  constructor(
    readonly b: Board,
    readonly tt: TranspositionTable,
    private readonly deadline: number,
    private readonly now: () => number,
    private readonly quiescence = true,
  ) {}

  private checkTime() {
    if ((++this.nodes & 1023) === 0 && this.now() > this.deadline) throw new Timeout();
  }

  private moveScore(m: number, ttMove: number, ply: number): number {
    if (m === ttMove) return 100_000;
    const sq = this.b.sq;
    const promo = movePromo(m);
    let s = promo ? 9_000 + VALUE[promo]! : 0;
    const victim = moveFlags(m) & F_EP ? PAWN : Math.abs(sq[moveTo(m)]!);
    if (victim) s += 10_000 + 10 * VALUE[victim]! - VALUE[Math.abs(sq[moveFrom(m)]!)]!;
    else if (this.killers[ply * 2] === m || this.killers[ply * 2 + 1] === m) s += 5_000;
    return s;
  }

  order(moves: number[], ttMove = 0, ply = 0): number[] {
    const scored = moves.map(m => ({ m, s: this.moveScore(m, ttMove, ply) }));
    scored.sort((x, y) => y.s - x.s);
    return scored.map(x => x.m);
  }

  private sideEval = () => this.b.side * evaluateBoard(this.b);

  private quiesce(alpha: number, beta: number, qdepth: number): number {
    this.checkTime();
    const b = this.b;
    const standPat = this.sideEval();
    if (standPat >= beta || qdepth >= MAX_QDEPTH) return standPat;
    if (standPat > alpha) alpha = standPat;
    for (const m of this.order(b.generate(true))) {
      if (!b.make(m)) continue;
      let score: number;
      try {
        score = -this.quiesce(-beta, -alpha, qdepth + 1);
      } finally {
        b.unmake();
      }
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.checkTime();
    const b = this.b;
    if (ply < this.pv.length) this.pv[ply] = [];
    if (b.halfmove >= 100 || b.isRepetition()) return 0;
    const inCheck = b.inCheck();
    if (inCheck && ply < MAX_PLY) depth++; // check extension
    if (depth <= 0) return this.quiescence ? this.quiesce(alpha, beta, 0) : this.sideEval();

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

    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    for (const m of this.order(b.generate(), ttMove, ply)) {
      if (!b.make(m)) continue;
      legal++;
      let score: number;
      try {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
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
        if (!(moveFlags(m) & F_CAPTURE) && ply < MAX_PLY) {
          this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
          this.killers[ply * 2] = m;
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

  /** Best of `moves` at `depth` (alpha-beta at the root), with its principal variation. */
  bestRootMove(moves: number[], depth: number): { move: number; score: number; pv: number[] } {
    let alpha = -INF;
    let move = moves[0]!;
    let pv = [move];
    for (const m of moves) {
      const score = this.scoreRootMove(m, depth, alpha, INF);
      if (score > alpha) {
        alpha = score;
        move = m;
        pv = [m, ...this.pv[1]!];
      }
    }
    return { move, score: alpha, pv };
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

const isMateScore = (s: number) => Math.abs(s) > MATE_BOUND;

// --------------------------------------------------------------- play mode

export interface EngineMove extends UciMove {
  /** Score in centipawns from the engine's point of view. */
  score: number;
  /** Deepest fully completed search depth. */
  depth: number;
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
export function chooseMove(chess: Chess, level: number, opts: SearchOptions = {}): EngineMove | null {
  const settings = levelSettings(level);
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? (() => performance.now());
  const b = boardFromChess(chess);
  const s = new Searcher(b, new TranspositionTable(17), now() + settings.maxMs, now, settings.quiescence);
  const rootMoves = s.order(b.legalMoves());
  if (rootMoves.length === 0) return null;

  // Noisy levels need an exact score for every root move, so each is searched
  // with a full window; strict levels only need the best move.
  const noisy = settings.noise > 0;
  let completed: RootScore[] | null = null;
  let completedDepth = 0;

  for (let depth = 1; depth <= settings.depth; depth++) {
    const order: number[] = completed ? [...completed].sort((x, y) => y.score - x.score).map(r => r.move) : rootMoves;
    try {
      if (noisy) completed = order.map(m => ({ move: m, score: s.scoreRootMove(m, depth) }));
      else {
        const best = s.bestRootMove(order, depth);
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

  let pick = completed![0]!;
  let pickValue = -INF;
  for (const c of completed!) {
    const value = c.score + (isMateScore(c.score) ? 0 : (rng() * 2 - 1) * settings.noise);
    if (value > pickValue) {
      pickValue = value;
      pick = c;
    }
  }
  return { ...toUci(pick.move), score: pick.score, depth: completedDepth };
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
  const rootMoves = s.order(b.legalMoves());
  if (rootMoves.length === 0) return null;
  const multiPv = Math.max(1, Math.min(opts.multiPv ?? 1, rootMoves.length));

  let result: AnalysisInfo | null = null;
  let previous: number[] = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const found: { move: number; score: number; pv: number[] }[] = [];
    try {
      const order = [...previous, ...rootMoves.filter(m => !previous.includes(m))];
      for (let k = 0; k < multiPv; k++) {
        const remaining = order.filter(m => !found.some(f => f.move === m));
        found.push(s.bestRootMove(remaining, depth));
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
    found.sort((x, y) => y.score - x.score);
    previous = found.map(f => f.move);
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

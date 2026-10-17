import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import { analyse, type AnalysisLine, type UciMove } from '../engine/search';

/**
 * Engine-based puzzle tooling: derives a solution for a position and checks
 * that every solver move is clearly the only good one. Used to build and to
 * test the bundled puzzle set; not loaded by the app at runtime.
 */

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE_SCORE = 100_000;

export function material(chess: Chess, color: Color): number {
  let s = 0;
  for (const row of chess.board())
    for (const sq of row) if (sq) s += (sq.color === color ? 1 : -1) * PIECE_VALUE[sq.type]!;
  return s;
}

/** A line's score from `color`'s point of view; mates are huge and prefer the shortest. */
export function scoreFor(line: AnalysisLine | undefined, color: Color): number {
  if (!line) return -Infinity;
  const sign = color === 'w' ? 1 : -1;
  if (line.mate !== null) return sign * Math.sign(line.mate) * (MATE_SCORE - Math.abs(line.mate));
  return sign * (line.cp ?? 0);
}

/** Moves to mate for `color` in this line, or null if it is not a mate for `color`. */
export function mateFor(line: AnalysisLine | undefined, color: Color): number | null {
  if (!line || line.mate === null) return null;
  const n = color === 'w' ? line.mate : -line.mate;
  return n > 0 ? n : null;
}

const fakeClock = () => {
  let t = 0;
  return () => (t += 1);
};

function lines(fen: string, moves: UciMove[], multiPv: number, depth: number): AnalysisLine[] {
  return analyse(fen, moves, { multiPv, maxDepth: depth, maxMs: 1e12, now: fakeClock() })?.lines ?? [];
}

/** chess.js accepts FENs where the side that just moved is in check; such positions are impossible. */
export function sideNotToMoveInCheck(fen: string): boolean {
  const chess = new Chess(fen);
  const waiting: Color = chess.turn() === 'w' ? 'b' : 'w';
  const king = chess.findPiece({ type: 'k', color: waiting })[0];
  return !!king && chess.isAttacked(king, chess.turn());
}

const same = (a: UciMove, b: UciMove) => a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

export interface DerivedPuzzle {
  solution: UciMove[];
  themes: string[];
  rating: number;
}

export interface DeriveOptions {
  depth?: number;
  /** Required lead of the best move over the second best (centipawns). */
  margin?: number;
  /** Required material gain for a non-mating puzzle (centipawns). */
  gain?: number;
  maxSolverMoves?: number;
}

/**
 * Finds a forcing solution for the side to move: either a forced mate, or a
 * sequence that wins at least `gain` of material, where each solver move is
 * the only one that keeps the win. Returns a reason string when rejected.
 */
export function derivePuzzle(fen: string, opts: DeriveOptions = {}): DerivedPuzzle | string {
  const { depth = 6, margin = 150, gain = 250, maxSolverMoves = 4 } = opts;
  const solver = new Chess(fen).turn();
  const start = new Chess(fen);
  if (start.isGameOver()) return 'position is already over';
  if (sideNotToMoveInCheck(fen)) return 'illegal position: the side not to move is in check';
  const startMaterial = material(start, solver);
  const solution: UciMove[] = [];

  for (let k = 0; k < maxSolverMoves; k++) {
    const [best, second] = lines(fen, solution, 2, depth);
    if (!best?.pv[0]) return 'no legal moves';
    const move = best.pv[0];
    const mate = mateFor(best, solver);
    const chess = new Chess(fen);
    for (const m of solution) chess.move(m);

    if (mate !== null) {
      const secondMate = mateFor(second, solver);
      // a final mating move may have alternatives (any mate is accepted when solving)
      if (mate > 1 && secondMate !== null && secondMate <= mate) return `two ways to mate in ${mate}`;
      if (mate > maxSolverMoves - k) return `mate in ${mate} is too long`;
      solution.push(move);
      chess.move(move);
      if (chess.isCheckmate()) return finish(start, solution, solver, `mateIn${(solution.length + 1) / 2}`);
    } else {
      const lead = scoreFor(best, solver) - scoreFor(second, solver);
      if (scoreFor(best, solver) < (k === 0 ? gain : 100)) return k === 0 ? 'no clear advantage' : 'advantage fades';
      if (second && lead < margin) return k === 0 ? `ambiguous: lead ${Math.round(lead)}` : 'later move ambiguous';
      solution.push(move);
      chess.move(move);
      if (material(chess, solver) - startMaterial >= gain) {
        // let the opponent recapture and check the gain holds
        const reply = lines(fen, solution, 1, depth)[0]?.pv[0];
        if (!reply) return finish(start, solution, solver, 'advantage');
        const after = new Chess(chess.fen());
        after.move(reply);
        if (material(after, solver) - startMaterial >= gain) return finish(start, solution, solver, 'advantage');
      }
    }
    // the opponent's best defence
    const reply = lines(fen, solution, 1, depth)[0]?.pv[0];
    if (!reply) return finish(start, solution, solver, 'advantage');
    solution.push(reply);
  }
  return 'no clear finish';
}

function finish(start: Chess, solution: UciMove[], solver: Color, kind: string): DerivedPuzzle {
  const themes = [kind];
  const chess = new Chess(start.fen());
  let nonPawn = 0;
  for (const row of start.board()) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') nonPawn += PIECE_VALUE[sq.type]!;
  if (nonPawn <= 1_300) themes.push('endgame');
  if (solution.some(m => m.promotion)) themes.push('promotion');
  const first = chess.move(solution[0]!);
  const opponent: Color = solver === 'w' ? 'b' : 'w';
  if (solution.length > 1 && PIECE_VALUE[first.piece]! >= 300 && chess.isAttacked(first.to, opponent)) {
    // a piece left where it can be taken, for less than it is worth: a sacrifice
    if (!first.captured || PIECE_VALUE[first.captured]! < PIECE_VALUE[first.piece]!) themes.push('sacrifice');
  }
  if (!kind.startsWith('mateIn') && forks(chess, first.to as Square, opponent)) themes.push('fork');
  const solverMoves = Math.ceil(solution.length / 2);
  const base = kind.startsWith('mateIn') ? 700 + 350 * solverMoves : 900 + 300 * solverMoves;
  return { solution, themes, rating: base + (themes.includes('sacrifice') ? 150 : 0) };
}

const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const LINES = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };

/** Squares attacked by the piece on `sq` (pseudo-attacks: pins are ignored). */
function attackedBy(chess: Chess, sq: Square): Square[] {
  const piece = chess.get(sq);
  if (!piece) return [];
  const f0 = sq.charCodeAt(0) - 97;
  const r0 = Number(sq[1]) - 1;
  const at = (f: number, r: number) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? (`${'abcdefgh'[f]}${r + 1}` as Square) : null);
  const out: Square[] = [];
  const steps = (dirs: number[][], slide: boolean) => {
    for (const [df, dr] of dirs) {
      for (let k = 1; k < 8; k++) {
        const t = at(f0 + df! * k, r0 + dr! * k);
        if (!t) break;
        out.push(t);
        if (!slide || chess.get(t)) break;
      }
    }
  };
  switch (piece.type) {
    case 'n': steps(KNIGHT_JUMPS, false); break;
    case 'b': steps(LINES.b, true); break;
    case 'r': steps(LINES.r, true); break;
    case 'q': steps([...LINES.b, ...LINES.r], true); break;
    case 'k': steps([...LINES.b, ...LINES.r], false); break;
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      for (const df of [-1, 1]) {
        const t = at(f0 + df, r0 + dir);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

/** True if the piece on `sq` attacks the enemy king or at least two enemy pieces worth more than it. */
function forks(chess: Chess, sq: Square, opponent: Color): boolean {
  const piece = chess.get(sq);
  if (!piece) return false;
  let targets = 0;
  for (const t of attackedBy(chess, sq)) {
    const victim = chess.get(t);
    if (!victim || victim.color !== opponent) continue;
    if (victim.type === 'k' || PIECE_VALUE[victim.type]! > PIECE_VALUE[piece.type]! || !chess.isAttacked(t, opponent)) targets++;
  }
  return targets >= 2;
}

export interface PuzzleCheck {
  ok: boolean;
  problems: string[];
}

/** Checks a stored puzzle: legal, ends in mate or a material win, and every solver move is clearly best. */
export function checkPuzzle(p: { fen: string; setup?: UciMove; solution: UciMove[] }, depth = 5, margin = 100): PuzzleCheck {
  const problems: string[] = [];
  if (sideNotToMoveInCheck(p.fen)) return { ok: false, problems: ['illegal start position'] };
  const startChess = new Chess(p.fen);
  if (p.setup) startChess.move(p.setup);
  const fen = startChess.fen();
  const solver = startChess.turn();
  const chess = new Chess(fen);
  const startMaterial = material(chess, solver);
  for (const [i, m] of p.solution.entries()) {
    if (i % 2 === 0) {
      const [best, second] = lines(fen, p.solution.slice(0, i), 2, depth);
      const isLast = i === p.solution.length - 1;
      const playedMates = new Chess(chess.fen());
      playedMates.move(m);
      if (isLast && playedMates.isCheckmate()) {
        // any mate is fine on the last move
      } else if (!best?.pv[0] || !same(best.pv[0], m)) {
        problems.push(`move ${i + 1}: engine prefers ${best?.pv[0] ? best.pv[0].from + best.pv[0].to : 'nothing'}`);
      } else if (second && mateFor(best, solver) === null && scoreFor(best, solver) - scoreFor(second, solver) < margin) {
        problems.push(`move ${i + 1}: not clearly the only move`);
      }
    }
    try {
      chess.move(m);
    } catch {
      problems.push(`move ${i + 1} is illegal`);
      return { ok: false, problems };
    }
  }
  if (p.solution.length % 2 === 0) problems.push('solution must end with the solver’s move');
  if (!chess.isCheckmate() && material(chess, solver) - startMaterial < 200) problems.push('does not end in mate or a material win');
  return { ok: problems.length === 0, problems };
}

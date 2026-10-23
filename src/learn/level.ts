// Rules for one lesson level: what counts as done, a mistake or a move on.
// The lessons themselves are in lessons.ts. In "collect" and "capture"
// levels the other side doesn't move: the turn just comes back to you.
// Pure, so every lesson can be checked in tests.

import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';

export type LessonGoal =
  /** Visit every star square (in any order). */
  | { kind: 'collect'; stars: Square[] }
  /** Take every piece the other side has, except the king. */
  | { kind: 'capture' }
  /** Give check in one move. */
  | { kind: 'check' }
  /** Give checkmate in one move. */
  | { kind: 'mate' }
  /** Promote a pawn. */
  | { kind: 'promote' }
  /** Play these moves (UCI); the other side's moves in between are played for you. */
  | { kind: 'line'; moves: string[] };

export interface LessonLevel {
  id: string;
  title: string;
  /** What to do, shown above the board. */
  task: string;
  fen: string;
  goal: LessonGoal;
  /** Moves for three stars. */
  par: number;
  hint: string;
  /** The side you play (default: the side to move). Set it when a line opens with the other side's move. */
  learner?: Color;
}

export interface LevelState {
  level: LessonLevel;
  learner: Color;
  fen: string;
  /** The position before your last move, for "try again". */
  before: string | null;
  moves: number;
  mistakes: number;
  collected: Square[];
  lineIndex: number;
  status: 'playing' | 'reply' | 'wrong' | 'done';
  message: string | null;
  lastMove: { from: Square; to: Square } | null;
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

/** The same position with the move handed back to `side` (the other side "passes"). */
export function passTo(fen: string, side: Color): string {
  const parts = fen.split(' ');
  parts[1] = side;
  parts[3] = '-';
  return parts.join(' ');
}

const parseUci = (u: string) => ({ from: u.slice(0, 2) as Square, to: u.slice(2, 4) as Square, ...(u[4] ? { promotion: u[4] } : {}) });

/** Whether the side has any pieces besides its king. */
const hasPieces = (fen: string, side: Color) => new Chess(fen).board().some(row => row.some(p => p && p.color === side && p.type !== 'k'));

export function startLevel(level: LessonLevel): LevelState {
  const toMove = turnOf(level.fen);
  const learner = level.learner ?? toMove;
  // a line can open with the other side's move (e.g. the pawn you then take en passant)
  const opponentStarts = level.goal.kind === 'line' && learner !== toMove;
  return {
    level,
    learner,
    fen: level.fen,
    before: null,
    moves: 0,
    mistakes: 0,
    collected: [],
    lineIndex: 0,
    status: opponentStarts ? 'reply' : 'playing',
    message: null,
    lastMove: null,
  };
}

/** Stars for a finished level: 3 within par, then one fewer for every two extra moves or each mistake. */
export function starsFor(s: Pick<LevelState, 'moves' | 'mistakes' | 'level'>): number {
  const extra = Math.max(0, s.moves - s.level.par);
  return Math.max(1, 3 - Math.ceil(extra / 2) - s.mistakes);
}

export type LevelAction = { type: 'move'; uci: string } | { type: 'reply' } | { type: 'retry' } | { type: 'restart' };

export function levelReducer(s: LevelState, a: LevelAction): LevelState {
  switch (a.type) {
    case 'restart':
      return startLevel(s.level);
    case 'retry':
      // the wrong move is taken back (it still counts as a mistake)
      return s.status === 'wrong' && s.before ? { ...s, fen: s.before, before: null, moves: s.moves - 1, status: 'playing', message: null, lastMove: null } : s;
    case 'reply': {
      // the other side's move in a line
      const goal = s.level.goal;
      if (s.status !== 'reply' || goal.kind !== 'line') return s;
      const uci = goal.moves[s.lineIndex];
      if (!uci) return { ...s, status: 'done' };
      const chess = new Chess(s.fen);
      const m = chess.move(parseUci(uci));
      return { ...s, fen: chess.fen(), lineIndex: s.lineIndex + 1, status: 'playing', lastMove: { from: m.from, to: m.to } };
    }
    case 'move':
      return s.status === 'playing' ? playMove(s, a.uci) : s;
  }
}

function playMove(s: LevelState, uci: string): LevelState {
  const chess = new Chess(s.fen);
  let m;
  try {
    m = chess.move(parseUci(uci));
  } catch {
    return s;
  }
  const after = chess.fen();
  const moved = { ...s, before: s.fen, fen: after, moves: s.moves + 1, lastMove: { from: m.from, to: m.to } };
  const wrong = (message: string): LevelState => ({ ...moved, status: 'wrong', mistakes: s.mistakes + 1, message });
  const goal = s.level.goal;
  const opponent = other(s.learner);

  switch (goal.kind) {
    case 'collect': {
      const collected = goal.stars.includes(m.to) && !s.collected.includes(m.to) ? [...s.collected, m.to] : s.collected;
      if (collected.length === goal.stars.length) return { ...moved, collected, status: 'done', message: null };
      return { ...moved, collected, fen: passTo(after, s.learner) };
    }
    case 'capture':
      if (!hasPieces(after, opponent)) return { ...moved, status: 'done', message: null };
      return { ...moved, fen: passTo(after, s.learner) };
    case 'promote':
      if (m.promotion) return { ...moved, status: 'done', message: null };
      return { ...moved, fen: passTo(after, s.learner) };
    case 'check':
      return chess.inCheck() ? { ...moved, status: 'done', message: null } : wrong('That isn’t check: the king isn’t attacked. Try again.');
    case 'mate':
      if (chess.isCheckmate()) return { ...moved, status: 'done', message: null };
      if (chess.isStalemate()) return wrong('That’s stalemate: the other side can’t move but isn’t in check, so the game is a draw. Try again.');
      return wrong(chess.inCheck() ? 'Check, but the king can still get away. Try again.' : 'That isn’t checkmate. Try again.');
    case 'line': {
      const expected = goal.moves[s.lineIndex];
      if (!expected || m.from + m.to + (m.promotion ?? '') !== expected) return wrong(`Not this time. ${s.level.hint}`);
      const lineIndex = s.lineIndex + 1;
      if (lineIndex >= goal.moves.length) return { ...moved, lineIndex, status: 'done', message: null };
      return { ...moved, lineIndex, status: 'reply' };
    }
  }
}

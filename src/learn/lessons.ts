// The lessons: original content written for OpenGambit. Each stage teaches
// one idea in a few short levels. In star and capture levels the other side
// doesn't move; lessons.test.ts plays every level through.

import type { LessonLevel } from './level';

export interface LessonStage {
  id: string;
  title: string;
  icon: string;
  /** A short explanation shown before the first level. */
  intro: string;
  levels: LessonLevel[];
}

export const STAGES: readonly LessonStage[] = [
  {
    id: 'rook',
    title: 'The rook',
    icon: '♜',
    intro: 'A rook moves in straight lines, along its row or its column, as far as it likes, but it can’t jump over other pieces.',
    levels: [
      {
        id: 'rook-1',
        title: 'Straight lines',
        task: 'Move the rook onto every star.',
        fen: '7k/8/8/8/8/8/8/R6K w - - 0 1',
        goal: { kind: 'collect', stars: ['a6', 'f6', 'f2'] },
        par: 3,
        hint: 'Go up the a-file first.',
      },
      {
        id: 'rook-2',
        title: 'Round the corner',
        task: 'Collect all the stars with the rook.',
        fen: '7k/8/8/8/3R4/8/8/7K w - - 0 1',
        goal: { kind: 'collect', stars: ['g4', 'g1', 'b1'] },
        par: 3,
        hint: 'Sideways along the 4th row, then down.',
      },
    ],
  },
  {
    id: 'bishop',
    title: 'The bishop',
    icon: '♝',
    intro: 'A bishop moves diagonally, as far as it likes. It always stays on squares of one colour.',
    levels: [
      {
        id: 'bishop-1',
        title: 'Diagonals',
        task: 'Move the bishop onto every star.',
        fen: '7k/8/8/8/8/8/8/2B4K w - - 0 1',
        goal: { kind: 'collect', stars: ['e3', 'g5', 'd8'] },
        par: 3,
        hint: 'Start with the star nearest the bishop.',
      },
      {
        id: 'bishop-2',
        title: 'Zigzag',
        task: 'Collect all the stars.',
        fen: '7k/8/8/8/8/8/8/5B1K w - - 0 1',
        goal: { kind: 'collect', stars: ['c4', 'a6', 'c8'] },
        par: 3,
        hint: 'Each star is one diagonal move from the last.',
      },
    ],
  },
  {
    id: 'queen',
    title: 'The queen',
    icon: '♛',
    intro: 'The queen is the strongest piece: she moves like a rook and like a bishop, in any straight line.',
    levels: [
      {
        id: 'queen-1',
        title: 'Every direction',
        task: 'Move the queen onto every star.',
        fen: '7k/8/8/8/8/8/8/3Q3K w - - 0 1',
        goal: { kind: 'collect', stars: ['d5', 'a2', 'f7'] },
        par: 3,
        hint: 'Up the file, then use the long diagonal both ways.',
      },
      {
        id: 'queen-2',
        title: 'Four stars',
        task: 'Collect all four stars.',
        fen: '7k/8/8/8/8/8/8/2Q4K w - - 0 1',
        goal: { kind: 'collect', stars: ['c5', 'f2', 'b6', 'a7'] },
        par: 4,
        hint: 'Up the file first; the rest are all on diagonals.',
      },
    ],
  },
  {
    id: 'knight',
    title: 'The knight',
    icon: '♞',
    intro: 'A knight moves in an L: two squares one way, then one square to the side. It’s the only piece that can jump over others.',
    levels: [
      {
        id: 'knight-1',
        title: 'The L-shape',
        task: 'Hop the knight onto every star.',
        fen: '7k/8/8/8/8/8/8/1N5K w - - 0 1',
        goal: { kind: 'collect', stars: ['c3', 'e4', 'f6'] },
        par: 3,
        hint: 'Each star is one knight jump from the one before.',
      },
      {
        id: 'knight-2',
        title: 'Across the board',
        task: 'Collect all the stars.',
        fen: '7k/8/8/8/8/8/8/6NK w - - 0 1',
        goal: { kind: 'collect', stars: ['f3', 'd4', 'b5', 'c7'] },
        par: 4,
        hint: 'Go left across the board, one jump at a time.',
      },
    ],
  },
  {
    id: 'king',
    title: 'The king',
    icon: '♚',
    intro: 'The king moves one square in any direction. He’s slow, but he’s the piece the whole game is about.',
    levels: [
      {
        id: 'king-1',
        title: 'One step at a time',
        task: 'Walk the king onto both stars.',
        fen: '7k/8/8/8/8/8/8/4K3 w - - 0 1',
        goal: { kind: 'collect', stars: ['e3', 'g4'] },
        par: 4,
        hint: 'Two steps up, then two steps diagonally.',
      },
    ],
  },
  {
    id: 'pawn',
    title: 'The pawn',
    icon: '♟',
    intro: 'A pawn moves straight forward one square, or two on its first move. It never moves backwards. A pawn that reaches the far side becomes a queen, rook, bishop or knight.',
    levels: [
      {
        id: 'pawn-1',
        title: 'Forward march',
        task: 'Push the pawn onto both stars.',
        fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1',
        goal: { kind: 'collect', stars: ['e4', 'e6'] },
        par: 3,
        hint: 'The pawn may move two squares on its first move.',
      },
      {
        id: 'pawn-2',
        title: 'Promotion',
        task: 'Promote the pawn: move it to the last row.',
        fen: '7k/1P6/8/8/8/8/8/K7 w - - 0 1',
        goal: { kind: 'promote' },
        par: 1,
        hint: 'One step forward, then pick the new piece. A queen is usually best.',
      },
    ],
  },
  {
    id: 'capture',
    title: 'Capturing',
    icon: '⚔',
    intro: 'You capture by moving onto a square with an enemy piece; it leaves the board. Pieces capture the way they move, except pawns, which capture one square diagonally forward.',
    levels: [
      {
        id: 'capture-1',
        title: 'Rook raid',
        task: 'Take all the black pieces (not the king).',
        fen: '4n2k/8/8/p3p3/8/8/8/R6K w - - 0 1',
        goal: { kind: 'capture' },
        par: 3,
        hint: 'Start up the a-file.',
      },
      {
        id: 'capture-2',
        title: 'Knight forks',
        task: 'Take all the black pieces with the knight.',
        fen: '7k/4p3/2p5/5b2/3N4/8/8/7K w - - 0 1',
        goal: { kind: 'capture' },
        par: 3,
        hint: 'One of the pawns is a knight jump away.',
      },
      {
        id: 'capture-3',
        title: 'Pawns take diagonally',
        task: 'Take both black pieces with your pawns.',
        fen: '7k/8/8/8/3n1b2/4P1P1/8/K7 w - - 0 1',
        goal: { kind: 'capture' },
        par: 2,
        hint: 'Each pawn can take one square diagonally forward.',
      },
    ],
  },
  {
    id: 'check',
    title: 'Check',
    icon: '+',
    intro: 'A king that is attacked is in check. The side in check must deal with it straight away.',
    levels: [
      {
        id: 'check-1',
        title: 'Queen check',
        task: 'Give check with the queen.',
        fen: '4k3/8/8/8/8/8/8/K2Q4 w - - 0 1',
        goal: { kind: 'check' },
        par: 1,
        hint: 'Attack the king along a line or a diagonal.',
      },
      {
        id: 'check-2',
        title: 'Rook check',
        task: 'Give check with the rook.',
        fen: '4k3/8/8/8/8/8/8/K6R w - - 0 1',
        goal: { kind: 'check' },
        par: 1,
        hint: 'The rook checks along a row or a column.',
      },
    ],
  },
  {
    id: 'mate',
    title: 'Checkmate',
    icon: '#',
    intro: 'Checkmate is check that can’t be escaped: the king can’t move away, the check can’t be blocked, and the attacker can’t be taken. It ends the game.',
    levels: [
      {
        id: 'mate-1',
        title: 'Back-rank mate',
        task: 'Checkmate in one move.',
        fen: '6k1/5ppp/8/8/8/8/8/K2R4 w - - 0 1',
        goal: { kind: 'mate' },
        par: 1,
        hint: 'Black’s own pawns hem the king in.',
      },
      {
        id: 'mate-2',
        title: 'Queen and king',
        task: 'Checkmate in one move.',
        fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1',
        goal: { kind: 'mate' },
        par: 1,
        hint: 'Your king covers the squares next to the black king.',
      },
      {
        id: 'mate-3',
        title: 'Rook and king',
        task: 'Checkmate in one move.',
        fen: 'k7/1p6/1K6/8/8/8/8/7R w - - 0 1',
        goal: { kind: 'mate' },
        par: 1,
        hint: 'The rook can attack along the back row.',
      },
    ],
  },
  {
    id: 'stalemate',
    title: 'Stalemate',
    icon: '=',
    intro: 'If the side to move has no legal move but isn’t in check, it’s stalemate, and the game is a draw. When you’re winning, be careful not to take away every square without giving check.',
    levels: [
      {
        id: 'stalemate-1',
        title: 'Mate, not stalemate',
        task: 'Checkmate in one move, without stalemating.',
        fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
        goal: { kind: 'mate' },
        par: 1,
        hint: 'The queen must give check on the back row.',
      },
    ],
  },
  {
    id: 'castling',
    title: 'Castling',
    icon: '♔',
    intro:
      'Castling moves the king two squares towards a rook and puts the rook on the other side of it, in one move. You can only castle if neither piece has moved, the squares between them are empty, and the king isn’t in check and doesn’t pass through an attacked square.',
    levels: [
      {
        id: 'castle-1',
        title: 'Short castling',
        task: 'Castle on the king’s side: move the king two squares towards the h-rook.',
        fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
        goal: { kind: 'line', moves: ['e1g1'] },
        par: 1,
        hint: 'Move the king from e1 to g1; the rook follows.',
      },
      {
        id: 'castle-2',
        title: 'Long castling',
        task: 'Castle on the queen’s side.',
        fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1',
        goal: { kind: 'line', moves: ['e1c1'] },
        par: 1,
        hint: 'Move the king from e1 to c1.',
      },
    ],
  },
  {
    id: 'en-passant',
    title: 'En passant',
    icon: '⤱',
    intro:
      'When a pawn moves two squares and lands beside one of your pawns, your pawn may take it as if it had moved only one square. This capture, “en passant”, is only allowed straight away, on the very next move.',
    levels: [
      {
        id: 'en-passant-1',
        title: 'In passing',
        task: 'Black pushes a pawn two squares. Take it en passant.',
        fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1',
        goal: { kind: 'line', moves: ['d7d5', 'e5d6'] },
        learner: 'w',
        par: 1,
        hint: 'Your pawn on e5 takes diagonally onto d6, the square the black pawn passed.',
      },
    ],
  },
];

export const ALL_LEVELS: readonly LessonLevel[] = STAGES.flatMap(s => s.levels);

export const levelById = (id: string) => ALL_LEVELS.find(l => l.id === id) ?? null;

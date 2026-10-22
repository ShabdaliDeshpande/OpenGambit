import { useCallback, useEffect, useReducer } from 'react';
import type { PieceSymbol, Square } from 'chess.js';
import { sessionReducer, startSession, type PuzzleSession } from '../puzzles/session';
import type { Puzzle } from '../puzzles/types';

export type MoveVerdict = 'good' | 'wrong' | 'ignored';

/**
 * One puzzle at a time for Streak and Storm: plays the setup move and the
 * opponent's replies after a short pause, and tells the caller whether each
 * of the player's moves was right before it is applied.
 */
export function usePuzzleRound(first: Puzzle, delays: { setup: number; opponent: number }) {
  const [session, dispatch] = useReducer(sessionReducer, first, p => startSession(p));

  useEffect(() => {
    const delay = session.phase === 'setup' ? delays.setup : session.phase === 'opponent' ? delays.opponent : undefined;
    if (delay === undefined) return;
    const id = setTimeout(() => dispatch({ type: session.phase === 'setup' ? 'setupMove' : 'opponentMove' }), delay);
    return () => clearTimeout(id);
  }, [session.phase, session.step, delays.setup, delays.opponent]);

  const start = useCallback((p: Puzzle) => dispatch({ type: 'start', puzzle: p }), []);

  /** Plays the move and says whether it was right ('ignored' if it isn't the player's turn). */
  const play = useCallback(
    (s: PuzzleSession, from: Square, to: Square, promotion?: PieceSymbol): MoveVerdict => {
      if (s.phase !== 'playing') return 'ignored';
      const move = { from, to, ...(promotion ? { promotion } : {}) };
      const next = sessionReducer(s, { type: 'move', move });
      dispatch({ type: 'move', move });
      return next.phase === 'wrong' ? 'wrong' : 'good';
    },
    [],
  );

  return { session, dispatch, start, play };
}

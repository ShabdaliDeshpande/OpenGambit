// What a bot says, and when. Each event has a chance, scaled by how chatty
// the bot is, so it doesn't comment on every move.

import type { Color } from 'chess.js';
import type { GameResult } from '../chess/gameEnd';
import { judge, type Score } from '../analysis/review';
import { MATE } from '../engine/search';
import type { Bot, ChatEvent } from './bots';

export const CHAT_CHANCE: Record<ChatEvent, number> = { start: 1, capture: 0.2, check: 0.3, blunder: 0.6, win: 1, loss: 1, draw: 1 };

/** A line for this event, or null when the bot keeps quiet this time. */
export function chatLine(bot: Bot, event: ChatEvent, rng: () => number = Math.random): string | null {
  const lines = bot.chat[event];
  if (!lines.length) return null;
  const always = event === 'start' || event === 'win' || event === 'loss' || event === 'draw';
  if (!always && rng() >= Math.min(1, CHAT_CHANCE[event] * bot.chatty)) return null;
  return lines[Math.floor(rng() * lines.length)]!;
}

/** The event a bot's own move makes (a check counts before a capture), if any. */
export function moveEvent(san: string): ChatEvent | null {
  if (san.includes('#')) return null; // the end of the game speaks for itself
  if (san.includes('+')) return 'check';
  if (san.includes('x')) return 'capture';
  return null;
}

/** The bot's view of a finished game. */
export const endEvent = (result: GameResult, botColor: Color): ChatEvent =>
  result.winner === null ? 'draw' : result.winner === botColor ? 'win' : 'loss';

/** An engine score (centipawns for `side`, or a mate score) as a White-relative Score. */
export function engineScore(score: number, side: Color): Score {
  const white = side === 'w' ? score : -score;
  if (Math.abs(score) < MATE - 200) return { cp: white };
  const moves = Math.ceil((MATE - Math.abs(score)) / 2);
  return { mate: white > 0 ? moves : -moves };
}

/** Whether the player's last move was a blunder, by Game Review's rules, from the bot's scores before and after it. */
export const wasBlunder = (before: Score, after: Score, player: Color) => judge(before, after, player, false).kind === 'blunder';

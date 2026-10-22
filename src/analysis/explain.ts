// Plain-language explanations of reviewed moves, built from rules rather
// than a language model: material won or lost along the engine's lines,
// pieces left hanging, mates allowed or missed, forks, pins, checks,
// promotions and lost castling rights. Pure; the sentences are templates.

import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { hasMate, type Score } from './review';
import { winningChances } from './accuracy';
import { afterMove, exchangeGain, forkTargets, hangingPiece, lineMaterial, materialOffered, PIECE_NAME, PIECE_VALUE, pinBy, type UciLike } from './material';
import type { ReviewedMove } from './gameReview';

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** "a pawn", "two pawns", "a piece", "a rook", "a lot of material". */
export function materialPhrase(pawns: number): string {
  if (pawns >= 8) return 'a lot of material';
  if (pawns >= 5) return 'a rook';
  if (pawns >= 3) return 'a piece';
  if (pawns >= 2) return 'two pawns';
  return 'a pawn';
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

const list = (words: string[]) => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** Moves to mate for `pov` (positive: `pov` mates), or null. */
function mateIn(score: Score, pov: Color): number | null {
  if (!('mate' in score)) return null;
  return (score.mate > 0) === (pov === 'w') ? Math.abs(score.mate) : -Math.abs(score.mate);
}

/** What a move does tactically, as short phrases ("forks the king and rook", "gives check"). */
export function moveFeatures(fen: string, move: UciLike): string[] {
  const next = afterMove(fen, move);
  if (!next) return [];
  const out: string[] = [];
  const to = move.to as Square;
  const forks = forkTargets(next.fen, to);
  if (forks.length >= 2) out.push(`forks the ${list(forks.slice(0, 2).map(t => PIECE_NAME[t.type]))}`);
  const pin = pinBy(next.fen, to);
  if (pin && !pinBy(fen, move.from as Square)) out.push(`pins the ${PIECE_NAME[pin.type]} to the ${PIECE_NAME[pin.behind]}`);
  if (move.promotion) out.push(`promotes to ${article(PIECE_NAME[move.promotion as PieceSymbol])}`);
  if (next.san.endsWith('#')) out.push('gives checkmate');
  else if (next.san.includes('+') && out.length === 0) out.push('gives check');
  return out;
}

/** Whether a king move threw away castling rights that were still there. */
function losesCastling(fen: string, move: UciLike): boolean {
  const next = afterMove(fen, move);
  if (!next || next.san.startsWith('O-O')) return false;
  const mover = new Chess(fen).turn();
  const rights = (f: string) => (f.split(' ')[2] ?? '-').split('').filter(ch => (mover === 'w' ? /[KQ]/ : /[kq]/).test(ch)).length;
  return next.piece === 'k' && rights(fen) > 0 && rights(next.fen) === 0;
}

const sanOf = (fen: string, move: UciLike | null) => (move ? (afterMove(fen, move)?.san ?? null) : null);

/** Why the engine's move is better, as a "which …" clause. */
function bestClause(m: ReviewedMove, bestSan: string): string {
  const best = m.before.best!;
  const mate = mateIn(m.before.score, m.color);
  if (mate !== null && mate > 0) return mate === 1 ? `${bestSan}, which is checkmate` : `${bestSan}, which forces mate in ${mate}`;
  const gainBest = lineMaterial(m.fenBefore, m.before.pv, m.color);
  const gainPlayed = lineMaterial(m.fenBefore, [m.uci, ...m.after.pv], m.color);
  const features = moveFeatures(m.fenBefore, best).filter(f => f !== 'gives check');
  // when the move allowed a mate, material is beside the point
  const allowedMate = (mateIn(m.after.score, other(m.color)) ?? 0) > 0;
  if (gainBest - gainPlayed >= 1 && gainBest >= 1) return `${bestSan}, which wins ${materialPhrase(gainBest)}${features[0] ? ` (it ${features[0]})` : ''}`;
  if (features[0]) return `${bestSan}, which ${features[0]}`;
  if (gainBest - gainPlayed >= 1 && !allowedMate) return `${bestSan}, which keeps the material level`;
  return winningChances(m.before.score, m.color) > 0.3 ? `${bestSan}, keeping your advantage` : `${bestSan}, keeping the balance`;
}

/** The main reason a move was an error. */
function errorReason(m: ReviewedMove): string | null {
  const opp = other(m.color);
  const allowed = mateIn(m.after.score, opp);
  const reply = m.after.pv[0] ?? null;
  const replySan = sanOf(m.fenAfter, reply);
  if (allowed !== null && allowed > 0)
    return `It allows mate in ${allowed}${replySan ? `, starting with ${replySan}` : ''}.`;
  if (hasMate(m.before.score, m.color) && !hasMate(m.after.score, m.color)) {
    const n = mateIn(m.before.score, m.color);
    return `You had a forced mate${n && n > 0 ? ` in ${n}` : ''}.`;
  }
  if (reply && replySan) {
    const victim = new Chess(m.fenAfter).get(reply.to as Square);
    if (victim && victim.color === m.color && victim.type !== 'k') {
      const gain = exchangeGain(m.fenAfter, reply.to as Square, opp);
      if (gain >= 1)
        return gain >= PIECE_VALUE[victim.type]
          ? `It leaves your ${PIECE_NAME[victim.type]} on ${reply.to} hanging: ${replySan} wins it.`
          : `After ${replySan} you lose ${materialPhrase(gain)}.`;
    }
  }
  const lost = lineMaterial(m.fenBefore, m.before.pv, m.color) - lineMaterial(m.fenBefore, [m.uci, ...m.after.pv], m.color);
  if (lost >= 1) return `It costs ${materialPhrase(lost)} compared with the engine’s line.`;
  if (losesCastling(m.fenBefore, m.uci)) return 'The king move gives up the right to castle.';
  const [cb, ca] = [winningChances(m.before.score, m.color), winningChances(m.after.score, m.color)];
  if (cb > 0.3 && ca < cb - 0.1) return 'It lets much of your advantage slip.';
  return 'It makes your position noticeably worse.';
}

/** What a sacrifice gives up: "a bishop for a pawn", "a knight", "the rook on a1". */
function sacrificed(m: ReviewedMove): string {
  const next = afterMove(m.fenBefore, m.uci);
  if (next && exchangeGain(next.fen, m.uci.to as Square, other(m.color)) > 0) {
    const piece = PIECE_NAME[next.piece];
    return next.captured ? `a ${piece} for a ${PIECE_NAME[next.captured]}` : article(piece);
  }
  const loose = next && hangingPiece(next.fen, m.color);
  return loose ? `the ${PIECE_NAME[loose.type]} on ${loose.square}` : materialPhrase(materialOffered(m.fenBefore, m.uci));
}

/** Two or three sentences about a reviewed move. */
export function explainMove(m: ReviewedMove): string {
  const kind = m.judgement.kind;
  const bestSan = sanOf(m.fenBefore, m.before.best);
  const features = moveFeatures(m.fenBefore, m.uci);
  const doesText = features.length ? ` It ${list(features)}.` : '';
  switch (kind) {
    case 'book':
      return `${m.san} is a known opening move.`;
    case 'brilliant': {
      const mate = mateIn(m.after.score, m.color);
      const payoff = mate !== null && mate > 0 ? `forces mate in ${mate}` : winningChances(m.after.score, m.color) > 0.5 ? 'wins' : 'holds up';
      return `${m.san} is a brilliant sacrifice: it gives up ${sacrificed(m)}, and the engine finds that it ${payoff}.${doesText}`;
    }
    case 'great':
      return `${m.san} is the only good move here: anything else loses ground.${doesText}`;
    case 'best':
      return `${m.san} is the engine’s top choice.${doesText}`;
    case 'excellent':
    case 'good': {
      const prefer = bestSan && !m.playedBest ? ` The engine slightly preferred ${bestSan}.` : '';
      return `${m.san} is ${kind === 'excellent' ? 'an excellent' : 'a good'} move.${doesText}${prefer}`;
    }
    default: {
      const lead =
        kind === 'miss'
          ? `Your opponent’s last move was a mistake, but ${m.san} misses the chance to punish it.`
          : `${m.san} is ${article(kind)}.`;
      const reason = errorReason(m);
      const best = bestSan && !m.playedBest ? ` Best was ${bestClause(m, bestSan)}.` : '';
      return `${lead}${reason ? ` ${reason}` : ''}${best}`;
    }
  }
}

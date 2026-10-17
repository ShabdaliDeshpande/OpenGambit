import { describe, expect, it } from 'vitest';
import { addRound, canJoinLate, colorWish, pairSwiss, rankSwiss, sonnebornBerger, type SwissPlayer } from './swiss.ts';

const player = (id: string, rating = 1500): SwissPlayer => ({ id, name: id, rating, joinedAt: 0, withdrawn: false, halves: 0, rounds: [] });

/** Plays out a pairing: the higher-rated player wins, or as `decide` says. */
function playRound(players: SwissPlayer[], round: number, decide?: (w: SwissPlayer, b: SwissPlayer) => 'w' | 'b' | 'draw') {
  const byId = new Map(players.map(p => [p.id, p]));
  const pairing = pairSwiss(players, () => 0.3);
  if (!pairing) return null;
  for (const { white, black } of pairing.pairs) {
    const [w, b] = [byId.get(white)!, byId.get(black)!];
    const r = decide ? decide(w, b) : w.rating >= b.rating ? 'w' : 'b';
    addRound(w, { round, outcome: r === 'draw' ? 'draw' : r === 'w' ? 'win' : 'loss', opponent: b.id, color: 'w' });
    addRound(b, { round, outcome: r === 'draw' ? 'draw' : r === 'b' ? 'win' : 'loss', opponent: w.id, color: 'b' });
  }
  if (pairing.bye) addRound(byId.get(pairing.bye)!, { round, outcome: 'bye', opponent: null, color: null });
  for (const p of players) if (p.withdrawn) addRound(p, { round, outcome: 'absent', opponent: null, color: null });
  return pairing;
}

describe('swiss', () => {
  it('never pairs the same players twice and ends when no pairing is left', () => {
    const ps = ['a', 'b', 'c', 'd'].map((id, i) => player(id, 2000 - i * 100));
    const seen = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const p = playRound(ps, r)!;
      expect(p.pairs).toHaveLength(2);
      for (const { white, black } of p.pairs) {
        const key = [white, black].sort().join('');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(6); // a full round robin
    expect(playRound(ps, 4)).toBeNull();
  });

  it('pairs equal scores together and gives the bye to the lowest-ranked player, once', () => {
    const ps = ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, 2000 - i * 100));
    const r1 = playRound(ps, 1)!;
    expect(r1.bye).toBe('e');
    const r2 = pairSwiss(ps, () => 0.3)!;
    const winners = new Set(ps.filter(p => p.halves === 2).map(p => p.id));
    // the two 1-pointers who played a real game meet each other
    const top = r2.pairs.find(pr => winners.has(pr.white) && winners.has(pr.black));
    expect(top).toBeDefined();
    expect(r2.bye).not.toBe('e');
  });

  it('balances colours, with absolute wishes after two in a row', () => {
    const p = player('p');
    addRound(p, { round: 1, outcome: 'win', opponent: 'x', color: 'w' });
    expect(colorWish(p)).toEqual({ color: 'b', strength: 2 });
    addRound(p, { round: 2, outcome: 'win', opponent: 'y', color: 'w' });
    expect(colorWish(p)).toEqual({ color: 'b', strength: 3 });

    const ps = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, 2000 - i * 50));
    for (let r = 1; r <= 5; r++) playRound(ps, r, () => 'draw');
    for (const q of ps) {
      const colors = q.rounds.map(x => x.color).filter(Boolean);
      const whites = colors.filter(c => c === 'w').length;
      expect(Math.abs(whites * 2 - colors.length)).toBeLessThanOrEqual(1);
      for (let i = 2; i < colors.length; i++) expect(colors[i] === colors[i - 1] && colors[i] === colors[i - 2]).toBe(false);
    }
  });

  it('skips withdrawn players, who score nothing for those rounds', () => {
    const ps = ['a', 'b', 'c'].map(id => player(id));
    ps[2]!.withdrawn = true;
    const r = playRound(ps, 1)!;
    expect(r.bye).toBeNull();
    expect(ps[2]!.rounds).toEqual([{ round: 1, outcome: 'absent', opponent: null, color: null }]);
    expect(ps[2]!.halves).toBe(0);
  });

  it('ranks by points, then Sonneborn–Berger', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => player(id));
    // a beat c and lost to b; d beat b and lost to c... set up equal points with different SB
    addRound(a!, { round: 1, outcome: 'win', opponent: 'b', color: 'w' });
    addRound(b!, { round: 1, outcome: 'loss', opponent: 'a', color: 'b' });
    addRound(c!, { round: 1, outcome: 'win', opponent: 'd', color: 'w' });
    addRound(d!, { round: 1, outcome: 'loss', opponent: 'c', color: 'b' });
    addRound(a!, { round: 2, outcome: 'loss', opponent: 'c', color: 'b' });
    addRound(c!, { round: 2, outcome: 'win', opponent: 'a', color: 'w' });
    addRound(b!, { round: 2, outcome: 'win', opponent: 'd', color: 'w' });
    addRound(d!, { round: 2, outcome: 'loss', opponent: 'b', color: 'b' });
    const byId = new Map([a!, b!, c!, d!].map(p => [p.id, p]));
    expect(sonnebornBerger(a!, byId)).toBe(1); // beat b, who has 1 point
    expect(sonnebornBerger(b!, byId)).toBe(0); // beat d, who has 0
    expect(rankSwiss([a!, b!, c!, d!]).map(p => p.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('allows late joining until more than half the rounds have started', () => {
    expect(canJoinLate(5, 11)).toBe(true);
    expect(canJoinLate(6, 11)).toBe(false);
    expect(canJoinLate(6, 12)).toBe(true);
    expect(canJoinLate(7, 12)).toBe(false);
  });
});

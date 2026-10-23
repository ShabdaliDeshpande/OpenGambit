import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { currentPosition, DRILLS, drillMove, drillTime, PENALTY_MS, startDrill, timeText } from './drills';

describe('timed drills', () => {
  it('has enough legal positions with a legal answer for every drill', () => {
    for (const d of DRILLS) {
      expect(d.positions.length, d.id).toBeGreaterThanOrEqual(d.size);
      for (const p of d.positions) expect(() => new Chess(p.fen).move(p.answer), `${d.id} ${p.id}`).not.toThrow();
    }
  });

  it('mate drills really are mate in one', () => {
    for (const p of DRILLS.find(d => d.id === 'mate-in-one')!.positions) {
      const c = new Chess(p.fen);
      c.move(p.answer);
      expect(c.isCheckmate(), p.id).toBe(true);
    }
  });

  it('times a run, with a penalty for each wrong answer', () => {
    const drill = DRILLS[0]!;
    let r = startDrill(drill, 1_000, () => 0);
    expect(r.order).toHaveLength(drill.size);
    for (let i = 0; i < drill.size; i++) {
      const pos = currentPosition(r)!;
      const uci = i === 0 ? 'a1a2' : pos.answer.from + pos.answer.to + (pos.answer.promotion ?? '');
      r = drillMove(r, uci, 1_000 + (i + 1) * 2_000);
    }
    expect(r.correct).toBe(drill.size - 1);
    expect(r.wrong).toBe(1);
    expect(r.finishedAt).toBe(1_000 + drill.size * 2_000);
    expect(drillTime(r, 0)).toBe(drill.size * 2_000 + PENALTY_MS);
    expect(currentPosition(r)).toBeNull();
  });

  it('shuffles the positions differently from run to run', () => {
    const a = startDrill(DRILLS[0]!, 0, () => 0.1).order.join();
    const b = startDrill(DRILLS[0]!, 0, () => 0.9).order.join();
    expect(a).not.toBe(b);
  });

  it('writes times as minutes and seconds', () => {
    expect(timeText(65_300)).toBe('1:05.3');
    expect(timeText(9_000)).toBe('0:09.0');
  });
});

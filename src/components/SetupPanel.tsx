import { useState } from 'react';
import type { Color } from 'chess.js';
import { TIME_CONTROLS } from '../chess/clock';
import type { GameSetup, Mode } from '../chess/game';
import { MAX_LEVEL, MIN_LEVEL } from '../engine/search';

type ColorChoice = Color | 'random';

export function SetupPanel({ initial, onStart }: { initial: GameSetup; onStart: (setup: GameSetup) => void }) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [color, setColor] = useState<ColorChoice>(initial.humanColor);
  const [level, setLevel] = useState(initial.level);
  const [tc, setTc] = useState<string>(initial.timeControlId ?? 'none');

  const start = () => {
    const humanColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    onStart({ mode, humanColor, level, timeControlId: tc === 'none' ? null : tc });
  };

  const levels = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => i + MIN_LEVEL);

  return (
    <section className="panel setup" aria-label="New game">
      <h2>New game</h2>
      <div className="segmented" role="radiogroup" aria-label="Mode">
        {(['local', 'computer'] as const).map(m => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'local' ? 'Two players' : 'vs Computer'}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Time control</span>
        <select value={tc} onChange={e => setTc(e.target.value)}>
          {TIME_CONTROLS.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value="none">Unlimited</option>
        </select>
      </label>

      {mode === 'computer' && (
        <>
          <label className="field">
            <span>Strength</span>
            <select value={level} onChange={e => setLevel(Number(e.target.value))}>
              {levels.map(l => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="radiogroup" aria-label="Your color">
            {(['w', 'random', 'b'] as const).map(c => (
              <button key={c} type="button" role="radio" aria-checked={color === c} className={color === c ? 'on' : ''} onClick={() => setColor(c)}>
                {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
          </div>
        </>
      )}

      <button type="button" className="primary" onClick={start}>
        Start game
      </button>
    </section>
  );
}

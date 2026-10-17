import { useState } from 'react';
import type { Color } from 'chess.js';
import { PlayView } from './components/PlayView';
import { AnalysisView } from './components/analysis/AnalysisView';
import { linkedPuzzle, PuzzleView } from './components/puzzles/PuzzleView';
import { linkedGame, OnlineView } from './components/online/OnlineView';
import { opposite } from './chess/clock';
import { useTheme } from './hooks/useTheme';

type Tab = 'play' | 'online' | 'puzzles' | 'analysis';

const TAB_LABEL: Record<Tab, string> = { play: 'Play', online: 'Play online', puzzles: 'Puzzles', analysis: 'Analysis board' };

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (linkedGame() ? 'online' : linkedPuzzle() ? 'puzzles' : 'play'));
  const [playOrientation, setPlayOrientation] = useState<Color>('w');
  const [analysisOrientation, setAnalysisOrientation] = useState<Color>('w');
  const [analysisRequest, setAnalysisRequest] = useState<{ pgn: string; nonce: number } | null>(null);
  const { theme, toggleTheme } = useTheme();

  const flip = () =>
    tab === 'play' ? setPlayOrientation(o => opposite(o)) : setAnalysisOrientation(o => opposite(o));

  return (
    <div className="app">
      <header className="topbar">
        <h1>Open Chess Board</h1>
        <nav className="tabs" role="tablist" aria-label="Screens">
          {(['play', 'online', 'puzzles', 'analysis'] as const).map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
        <div className="row">
          {(tab === 'play' || tab === 'analysis') && (
            <button type="button" onClick={flip} title="Flip board (f)">
              ⇅ Flip
            </button>
          )}
          <button type="button" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </header>

      {/* Both screens stay mounted so a running game (and its clock) survives switching tabs. */}
      <div hidden={tab !== 'play'}>
        <PlayView
          active={tab === 'play'}
          orientation={playOrientation}
          setOrientation={setPlayOrientation}
          onAnalyse={pgn => {
            setAnalysisRequest(r => ({ pgn, nonce: (r?.nonce ?? 0) + 1 }));
            setAnalysisOrientation(playOrientation);
            setTab('analysis');
          }}
        />
      </div>
      <div hidden={tab !== 'online'}>
        <OnlineView
          active={tab === 'online'}
          onAnalyse={pgn => {
            setAnalysisRequest(r => ({ pgn, nonce: (r?.nonce ?? 0) + 1 }));
            setTab('analysis');
          }}
        />
      </div>
      <div hidden={tab !== 'puzzles'}>
        <PuzzleView
          active={tab === 'puzzles'}
          onAnalyse={pgn => {
            setAnalysisRequest(r => ({ pgn, nonce: (r?.nonce ?? 0) + 1 }));
            setTab('analysis');
          }}
        />
      </div>
      <div hidden={tab !== 'analysis'}>
        <AnalysisView
          active={tab === 'analysis'}
          orientation={analysisOrientation}
          onFlip={() => setAnalysisOrientation(o => opposite(o))}
          request={analysisRequest}
        />
      </div>
    </div>
  );
}

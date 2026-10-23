import { useEffect, useState } from 'react';
import type { Color } from 'chess.js';
import { PlayView } from './components/PlayView';
import { AnalysisView } from './components/analysis/AnalysisView';
import type { AnalysedGame, AnalysisRequest } from './components/analysis/AnalysisView';
import { linkedPuzzle, linkedPuzzleMode, PuzzleView } from './components/puzzles/PuzzleView';
import { linkedOnline, OnlineView } from './components/online/OnlineView';
import { AccountDialog } from './components/account/AccountDialog';
import { ProfileView } from './components/account/ProfileView';
import { InsightsView } from './components/account/InsightsView';
import { LearnView } from './components/learn/LearnView';
import { opposite } from './chess/clock';
import type { GameSetup } from './chess/game';
import { useAccount } from './hooks/useAccount';
import { useTheme } from './hooks/useTheme';
import { useSoundSetting } from './hooks/useGameSounds';

type Tab = 'play' | 'online' | 'puzzles' | 'learn' | 'analysis' | 'profile' | 'insights';

const TABS = ['play', 'online', 'puzzles', 'learn', 'analysis'] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { play: 'Play', online: 'Play online', puzzles: 'Puzzles', learn: 'Learn', analysis: 'Analysis board' };

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;

/** A player's insights named by an `?insights=<name>` link, if any. */
function linkedInsights(): string | null {
  const name = new URLSearchParams(window.location.search).get('insights');
  return name && USERNAME.test(name) ? name : null;
}

/** A profile named by a `?user=<name>` link, if any. */
function linkedProfile(): string | null {
  const name = new URLSearchParams(window.location.search).get('user');
  return name && USERNAME.test(name) ? name : null;
}

export default function App() {
  const [profileName, setProfileName] = useState<string | null>(linkedProfile);
  const [insightsName, setInsightsName] = useState<string | null>(linkedInsights);
  const [tab, setTab] = useState<Tab>(() =>
    linkedInsights() ? 'insights' : linkedProfile() ? 'profile' : linkedOnline() ? 'online' : linkedPuzzle() || linkedPuzzleMode() ? 'puzzles' : 'play',
  );
  const [playOrientation, setPlayOrientation] = useState<Color>('w');
  const [analysisOrientation, setAnalysisOrientation] = useState<Color>('w');
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [computerGame, setComputerGame] = useState<{ setup: GameSetup; n: number } | null>(null);
  const { theme, toggleTheme } = useTheme();
  const [soundOn, setSoundOn] = useSoundSetting();
  const account = useAccount();
  const me = account.me ?? null;

  const flip = () =>
    tab === 'play' ? setPlayOrientation(o => opposite(o)) : setAnalysisOrientation(o => opposite(o));

  const analyse = (pgn: string, game?: AnalysedGame) => {
    setAnalysisRequest(r => ({ pgn, nonce: (r?.nonce ?? 0) + 1, ...(game ? { game } : {}) }));
    setTab('analysis');
  };

  const openProfile = (name: string) => {
    setProfileName(name);
    setTab('profile');
    window.history.pushState(null, '', `?user=${encodeURIComponent(name)}`);
  };

  const openInsights = (name: string) => {
    setInsightsName(name);
    setTab('insights');
    window.history.pushState(null, '', `?insights=${encodeURIComponent(name)}`);
  };

  const chooseTab = (t: Tab) => {
    // leaving a profile or insights link: drop it from the address bar
    if ((tab === 'profile' || tab === 'insights') && t !== tab) window.history.pushState(null, '', window.location.pathname);
    setTab(t);
  };

  useEffect(() => {
    const onPop = () => {
      const insights = linkedInsights();
      if (insights) {
        setInsightsName(insights);
        setTab('insights');
        return;
      }
      const name = linkedProfile();
      if (name) {
        setProfileName(name);
        setTab('profile');
      } else setTab(t => (t === 'profile' || t === 'insights' ? 'play' : t));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>OpenGambit</h1>
        <nav className="tabs" role="tablist" aria-label="Screens">
          {TABS.map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => chooseTab(t)}>
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
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            title={soundOn ? 'Turn sounds off' : 'Turn sounds on'}
            aria-label={soundOn ? 'Turn sounds off' : 'Turn sounds on'}
            aria-pressed={soundOn}
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button type="button" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          {account.me === undefined ? null : me ? (
            <>
              <button
                type="button"
                className={tab === 'profile' && profileName?.toLowerCase() === me.username.toLowerCase() ? 'on account-button' : 'account-button'}
                onClick={() => openProfile(me.username)}
                title="Your profile"
              >
                👤 {me.username}
              </button>
              <button type="button" onClick={() => void account.signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => setSigningIn(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <AccountDialog open={signingIn} onClose={() => setSigningIn(false)} signIn={account.signIn} />

      {/* Screens stay mounted so a running game (and its clock) survives switching tabs. */}
      <div hidden={tab !== 'play'}>
        <PlayView
          active={tab === 'play'}
          orientation={playOrientation}
          setOrientation={setPlayOrientation}
          request={computerGame}
          onAnalyse={pgn => {
            setAnalysisOrientation(playOrientation);
            analyse(pgn);
          }}
        />
      </div>
      <div hidden={tab !== 'online'}>
        <OnlineView
          active={tab === 'online'}
          signedIn={!!me}
          myRatings={me?.ratings ?? null}
          onPlayComputer={setup => {
            setComputerGame(g => ({ setup, n: (g?.n ?? 0) + 1 }));
            chooseTab('play');
          }}
          onSignIn={() => setSigningIn(true)}
          onOpenProfile={openProfile}
          onAnalyse={analyse}
        />
      </div>
      <div hidden={tab !== 'puzzles'}>
        <PuzzleView active={tab === 'puzzles'} onAnalyse={analyse} me={me} onRated={account.refresh} onSignIn={() => setSigningIn(true)} />
      </div>
      {tab === 'learn' && <LearnView signedIn={!!me} />}
      <div hidden={tab !== 'analysis'}>
        <AnalysisView
          active={tab === 'analysis'}
          orientation={analysisOrientation}
          onFlip={() => setAnalysisOrientation(o => opposite(o))}
          request={analysisRequest}
          signedIn={!!me}
        />
      </div>
      {tab === 'profile' && profileName && (
        <ProfileView
          key={profileName}
          username={profileName}
          meId={me?.id ?? null}
          onOpenProfile={openProfile}
          onOpenInsights={openInsights}
          onAnalyse={analyse}
          onAccountDeleted={() => {
            account.forget();
            chooseTab('play');
          }}
        />
      )}
      {tab === 'insights' && insightsName && <InsightsView key={insightsName} username={insightsName} meName={me?.username ?? null} onOpenProfile={openProfile} />}
    </div>
  );
}

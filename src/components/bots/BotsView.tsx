import { useEffect, useRef, useState } from 'react';
import type { Color } from 'chess.js';
import { BOTS, botById, STYLE_LABEL, type Bot } from '../../bots/bots';
import { ASSIST_KEYS, ASSIST_LABEL, DEFAULT_ASSISTS, parseSavedGame, SAVED_GAME_KEY, type Assists, type BotMode, type SavedBotGame } from '../../bots/botGame';
import { botKey } from '../../learn/progress';
import { useLearnProgress } from '../../hooks/useLearnProgress';
import { BotAvatar } from './BotAvatar';
import { BotGame } from './BotGame';

const SETUP_KEY = 'chess-app:bot-setup';

type ColorChoice = Color | 'random';

interface Setup {
  botId: string;
  color: ColorChoice;
  mode: BotMode;
  assists: Assists;
}

const DEFAULT_SETUP: Setup = { botId: BOTS[0]!.id, color: 'w', mode: 'challenge', assists: DEFAULT_ASSISTS };

function read<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const text = localStorage.getItem(key);
    return text ? parse(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered in this browser
  }
}

function parseSetup(raw: unknown): Setup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Setup>;
  const assists = { ...DEFAULT_ASSISTS };
  for (const k of ASSIST_KEYS) if (typeof o.assists?.[k] === 'boolean') assists[k] = o.assists[k];
  return {
    botId: typeof o.botId === 'string' && botById(o.botId) ? o.botId : DEFAULT_SETUP.botId,
    color: o.color === 'w' || o.color === 'b' || o.color === 'random' ? o.color : 'w',
    mode: o.mode === 'assisted' ? 'assisted' : 'challenge',
    assists,
  };
}

const resultBadge = (v: number | undefined) => (v === 2 ? 'Beaten ✓' : v === 1 ? 'Drawn ½' : null);

interface Playing {
  n: number;
  bot: Bot;
  player: Color;
  mode: BotMode;
  moves: string[];
}

interface Props {
  active: boolean;
  signedIn: boolean;
  onAnalyse: (pgn: string) => void;
}

/** The bot gallery, and games against the bots. Free for everyone. */
export function BotsView({ active, signedIn, onAnalyse }: Props) {
  const [setup, setSetup] = useState<Setup>(() => read(SETUP_KEY, parseSetup) ?? DEFAULT_SETUP);
  const [saved, setSaved] = useState<SavedBotGame | null>(() => read(SAVED_GAME_KEY, parseSavedGame));
  const [playing, setPlaying] = useState<Playing | null>(null);
  const { progress, record } = useLearnProgress(signedIn);
  const setupRef = useRef<HTMLElement>(null);

  useEffect(() => write(SETUP_KEY, setup), [setup]);

  const bot = botById(setup.botId) ?? BOTS[0]!;

  const start = (b: Bot, s: Setup, moves: string[] = [], player?: Color) =>
    setPlaying(p => ({
      n: (p?.n ?? 0) + 1,
      bot: b,
      player: player ?? (s.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : s.color),
      mode: s.mode,
      moves,
    }));

  const choose = (id: string) => {
    setSetup(s => ({ ...s, botId: id }));
    // on a narrow screen the setup panel is above the gallery
    if (window.matchMedia?.('(max-width: 800px)').matches) setupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (playing)
    return (
      <BotGame
        key={playing.n}
        bot={playing.bot}
        player={playing.player}
        mode={playing.mode}
        assists={setup.assists}
        moves={playing.moves}
        active={active}
        onAssists={assists => setSetup(s => ({ ...s, assists }))}
        onSave={moves => {
          const game: SavedBotGame | null = moves ? { botId: playing.bot.id, player: playing.player, mode: playing.mode, assists: setup.assists, moves } : null;
          write(SAVED_GAME_KEY, game);
          setSaved(game);
        }}
        onResult={value => value && record(botKey(playing.bot.id), value)}
        onAgain={() => start(playing.bot, { ...setup, mode: playing.mode }, [], setup.color === 'random' ? undefined : playing.player)}
        onExit={() => setPlaying(null)}
        onAnalyse={onAnalyse}
      />
    );

  const savedBot = saved ? botById(saved.botId) : undefined;

  return (
    <main className="bots-home">
      <section className="panel bots-setup" ref={setupRef} aria-label={`Play ${bot.name}`}>
        <div className="bot-who">
          <BotAvatar bot={bot} size={72} />
          <div>
            <h2>{bot.name}</h2>
            <p className="muted small">
              ≈{bot.rating} · {STYLE_LABEL[bot.style]}
              {resultBadge(progress[botKey(bot.id)]) ? ` · ${resultBadge(progress[botKey(bot.id)])}` : ''}
            </p>
          </div>
        </div>
        <p className="small">{bot.description}</p>
        <p className="muted small">{bot.openings}</p>

        <fieldset className="bot-choice">
          <legend>Your colour</legend>
          <div className="segmented" role="radiogroup" aria-label="Your colour">
            {(['w', 'random', 'b'] as const).map(c => (
              <button key={c} type="button" role="radio" aria-checked={setup.color === c} className={setup.color === c ? 'on' : ''} onClick={() => setSetup(s => ({ ...s, color: c }))}>
                {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="bot-choice">
          <legend>Mode</legend>
          <div className="segmented" role="radiogroup" aria-label="Mode">
            {(['challenge', 'assisted'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={setup.mode === m} className={setup.mode === m ? 'on' : ''} onClick={() => setSetup(s => ({ ...s, mode: m }))}>
                {m === 'challenge' ? 'Challenge' : 'Assisted'}
              </button>
            ))}
          </div>
          <p className="muted small">
            {setup.mode === 'challenge'
              ? 'No help. A win or a draw is recorded on the bot’s card.'
              : 'Turn on the help you want. You can change it during the game.'}
          </p>
          {setup.mode === 'assisted' && (
            <div className="bot-assists">
              {ASSIST_KEYS.map(k => (
                <label key={k}>
                  <input type="checkbox" checked={setup.assists[k]} onChange={e => setSetup(s => ({ ...s, assists: { ...s.assists, [k]: e.target.checked } }))} />{' '}
                  {ASSIST_LABEL[k]}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <button type="button" className="primary" onClick={() => start(bot, setup)}>
          Play {bot.name}
        </button>
        <p className="muted small">
          {signedIn ? 'Your results are saved with your account.' : 'Your results are kept in this browser. Sign in to keep them with your account too.'}
        </p>
      </section>

      <div className="bots-main">
        {saved && savedBot && (
          <section className="panel bot-resume" role="status">
            <p>
              You have a game in progress against <strong>{savedBot.name}</strong> ({saved.mode === 'challenge' ? 'Challenge' : 'Assisted'}, {saved.moves.length} moves
              played).
            </p>
            <div className="row">
              <button type="button" className="primary" onClick={() => start(savedBot, { ...setup, mode: saved.mode, assists: saved.assists }, saved.moves, saved.player)}>
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  write(SAVED_GAME_KEY, null);
                  setSaved(null);
                }}
              >
                Abandon
              </button>
            </div>
          </section>
        )}
        <ul className="bot-gallery" aria-label="Bots">
          {BOTS.map(b => {
            const badge = resultBadge(progress[botKey(b.id)]);
            return (
              <li key={b.id}>
                <button type="button" className={`bot-card${b.id === bot.id ? ' on' : ''}`} aria-pressed={b.id === bot.id} onClick={() => choose(b.id)}>
                  <BotAvatar bot={b} />
                  <span className="bot-card-text">
                    <strong>{b.name}</strong>
                    <span className="muted small">
                      ≈{b.rating} · {STYLE_LABEL[b.style]}
                    </span>
                    <span className="small">{b.tagline}</span>
                    {badge && <span className="bot-badge small">{badge}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Ratings are approximate. They come from games between the bots and the engine levels, not from games against people.</p>
      </div>
    </main>
  );
}

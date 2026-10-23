import { useState } from 'react';
import { STAGES } from '../../learn/lessons';
import { DRILLS, timeText } from '../../learn/drills';
import { ENDGAMES } from '../../learn/endgames';
import { drillKey, endgameKey, lessonKey, stageStars } from '../../learn/progress';
import { useLearnProgress } from '../../hooks/useLearnProgress';
import { LessonPlayer } from './LessonPlayer';
import { DrillPlayer } from './DrillPlayer';
import { EndgamePlayer } from './EndgamePlayer';
import { VideoLibrary } from './VideoLibrary';

type Section = 'lessons' | 'drills' | 'endgames' | 'videos';
type Open = { kind: 'level'; stage: number; level: number } | { kind: 'drill'; id: string } | { kind: 'endgame'; id: string } | null;

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'lessons', label: '📘 Lessons' },
  { id: 'drills', label: '⏱ Drills' },
  { id: 'endgames', label: '♔ Endgames' },
  { id: 'videos', label: '🎬 Videos' },
];

interface Props {
  signedIn: boolean;
}

/** Learning: lessons from the basics, timed drills, endgame practice and a video library. Free for everyone. */
export function LearnView({ signedIn }: Props) {
  const [section, setSection] = useState<Section>('lessons');
  const [open, setOpen] = useState<Open>(null);
  const { progress, record } = useLearnProgress(signedIn);

  if (open?.kind === 'level') {
    const stage = STAGES[open.stage]!;
    const level = stage.levels[open.level]!;
    const nextLevel = open.level + 1 < stage.levels.length ? { ...open, level: open.level + 1 } : open.stage + 1 < STAGES.length ? { kind: 'level' as const, stage: open.stage + 1, level: 0 } : null;
    return (
      <LessonPlayer
        key={level.id}
        stage={stage}
        level={level}
        best={progress[lessonKey(level.id)] ?? null}
        onDone={stars => record(lessonKey(level.id), stars)}
        onNext={nextLevel ? () => setOpen(nextLevel) : null}
        onBack={() => setOpen(null)}
      />
    );
  }
  if (open?.kind === 'drill') {
    const drill = DRILLS.find(d => d.id === open.id)!;
    return <DrillPlayer key={drill.id} drill={drill} best={progress[drillKey(drill.id)] ?? null} onFinish={ms => record(drillKey(drill.id), Math.round(ms))} onBack={() => setOpen(null)} />;
  }
  if (open?.kind === 'endgame') {
    const e = ENDGAMES.find(x => x.id === open.id)!;
    return <EndgamePlayer key={e.id} endgame={e} done={progress[endgameKey(e.id)] === 1} onWin={() => record(endgameKey(e.id), 1)} onBack={() => setOpen(null)} />;
  }

  return (
    <main className="learn-home">
      <section className="panel">
        <h2>Learn</h2>
        <div className="segmented" role="radiogroup" aria-label="Learning section">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" role="radio" aria-checked={section === s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {signedIn ? 'Your progress is saved with your account.' : 'Your progress is kept in this browser. Sign in to keep it with your account too.'}
        </p>
      </section>

      {section === 'lessons' && (
        <div className="learn-grid">
          {STAGES.map((stage, si) => {
            const won = stageStars(progress, stage.levels.map(l => l.id));
            return (
              <section key={stage.id} className="panel learn-card">
                <h3>
                  <span aria-hidden="true">{stage.icon}</span> {stage.title}
                </h3>
                <p className="small">{stage.intro}</p>
                <ol className="learn-levels">
                  {stage.levels.map((l, li) => {
                    const stars = progress[lessonKey(l.id)] ?? 0;
                    return (
                      <li key={l.id}>
                        <button type="button" className="link-button" onClick={() => setOpen({ kind: 'level', stage: si, level: li })}>
                          {l.title}
                        </button>{' '}
                        <span className="learn-stars" aria-label={`${stars} of 3 stars`}>
                          {'★'.repeat(stars)}
                          {'☆'.repeat(3 - stars)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="muted small">
                  {won} of {stage.levels.length * 3} stars
                </p>
              </section>
            );
          })}
        </div>
      )}

      {section === 'drills' && (
        <div className="learn-grid">
          {DRILLS.map(d => (
            <section key={d.id} className="panel learn-card">
              <h3>⏱ {d.title}</h3>
              <p className="small">{d.description}</p>
              <p className="muted small">
                {Math.min(d.size, d.positions.length)} positions · best {progress[drillKey(d.id)] ? timeText(progress[drillKey(d.id)]!) : '–'}
              </p>
              <button type="button" className="primary" onClick={() => setOpen({ kind: 'drill', id: d.id })}>
                Start
              </button>
            </section>
          ))}
        </div>
      )}

      {section === 'endgames' && (
        <div className="learn-grid">
          {ENDGAMES.map(e => (
            <section key={e.id} className="panel learn-card">
              <h3>
                {e.title}
                {progress[endgameKey(e.id)] === 1 ? ' ✓' : ''}
              </h3>
              <p className="small">{e.task}</p>
              <button type="button" className="primary" onClick={() => setOpen({ kind: 'endgame', id: e.id })}>
                Practise
              </button>
            </section>
          ))}
        </div>
      )}

      {section === 'videos' && (
        <section className="panel">
          <VideoLibrary />
        </section>
      )}
    </main>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { checkVideos, embedUrl, filterVideos, LEVELS, youtubeId, type Video, type VideoLevel } from '../../learn/videos';

/** The site's video library, read from /videos.json (empty until whoever runs the site fills it in). */
export function VideoLibrary() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [level, setLevel] = useState<VideoLevel | ''>('');
  const [tag, setTag] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/videos.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : { videos: [] }))
      .then((data: unknown) => {
        if (cancelled) return;
        const checked = checkVideos(data);
        setVideos(checked.videos);
        setProblems(checked.problems);
      })
      .catch(() => !cancelled && setVideos([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const tags = useMemo(() => [...new Set((videos ?? []).flatMap(v => v.tags))].sort(), [videos]);
  const shown = useMemo(() => filterVideos(videos ?? [], { text, level, tag }), [videos, text, level, tag]);

  if (videos === null) return <p role="status">Loading videos…</p>;
  if (videos.length === 0)
    return (
      <div className="video-empty">
        <p>No videos yet.</p>
        <p className="muted small">
          Whoever runs this site can add some to <code>public/videos.json</code>: a list of videos with a title and a link, and optionally an author, a level
          (beginner, intermediate or advanced), tags, a language and a duration. The README has the details.
        </p>
        {problems.length > 0 && <ProblemList problems={problems} />}
      </div>
    );

  return (
    <div className="video-library">
      <div className="row video-filters" role="group" aria-label="Filter videos">
        <input type="search" placeholder="Search titles, authors and tags" value={text} onChange={e => setText(e.target.value)} aria-label="Search videos" />
        <select value={level} onChange={e => setLevel(e.target.value as VideoLevel | '')} aria-label="Level">
          <option value="">Any level</option>
          {LEVELS.map(l => (
            <option key={l} value={l}>
              {l[0]!.toUpperCase() + l.slice(1)}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag">
            <option value="">Any topic</option>
            {tags.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {shown.length === 0 && <p className="muted">No videos match.</p>}
      <ul className="video-list">
        {shown.map(v => {
          const yt = youtubeId(v.url);
          return (
            <li key={v.url} className="video-card">
              <div className="video-head">
                <strong>{v.title}</strong>
                <span className="muted small">
                  {[v.author, v.level, v.duration, v.language?.toUpperCase()].filter(Boolean).join(' · ')}
                </span>
                {v.tags.length > 0 && <span className="muted small">{v.tags.join(', ')}</span>}
              </div>
              {yt && playing === v.url ? (
                <div className="video-frame">
                  <iframe
                    src={embedUrl(yt)}
                    title={v.title}
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              ) : yt ? (
                <button type="button" onClick={() => setPlaying(v.url)}>
                  ▶ Play here
                </button>
              ) : (
                <a href={v.url} target="_blank" rel="noopener noreferrer">
                  Open video ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && <ProblemList problems={problems} />}
    </div>
  );
}

function ProblemList({ problems }: { problems: string[] }) {
  return (
    <details className="small">
      <summary>{problems.length} entr{problems.length === 1 ? 'y' : 'ies'} in videos.json couldn’t be used</summary>
      <ul>
        {problems.map(p => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

// The video library: whoever runs the site lists videos in public/videos.json
// (it ships empty). This checks that file and finds YouTube links, which play
// in YouTube's privacy-enhanced embed; other links open in a new tab.

export type VideoLevel = 'beginner' | 'intermediate' | 'advanced';

export const LEVELS: readonly VideoLevel[] = ['beginner', 'intermediate', 'advanced'];

export interface Video {
  title: string;
  url: string;
  author?: string;
  level?: VideoLevel;
  tags: string[];
  /** A language code such as "en". */
  language?: string;
  /** "12:30". */
  duration?: string;
}

/** The videos that are valid, and why the others were left out. */
export function checkVideos(raw: unknown): { videos: Video[]; problems: string[] } {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { videos?: unknown }).videos) ? ((raw as { videos: unknown[] }).videos) : null;
  if (!list) return { videos: [], problems: raw === null || raw === undefined ? [] : ['The file needs a "videos" list.'] };
  const videos: Video[] = [];
  const problems: string[] = [];
  list.forEach((v, i) => {
    const n = `Video ${i + 1}`;
    if (!v || typeof v !== 'object') return problems.push(`${n} isn’t an object.`);
    const o = v as Record<string, unknown>;
    if (typeof o.title !== 'string' || !o.title.trim()) return problems.push(`${n} has no title.`);
    let url: URL;
    try {
      url = new URL(String(o.url));
    } catch {
      return problems.push(`${n} (“${o.title}”) has no valid link.`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return problems.push(`${n} (“${o.title}”) must link to a web page.`);
    const level = LEVELS.includes(o.level as VideoLevel) ? (o.level as VideoLevel) : undefined;
    if (o.level !== undefined && !level) problems.push(`${n} (“${o.title}”): level must be beginner, intermediate or advanced.`);
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
    const author = str(o.author);
    const language = str(o.language);
    const duration = typeof o.duration === 'string' && /^\d{1,3}:\d{2}(:\d{2})?$/.test(o.duration) ? o.duration : undefined;
    videos.push({
      title: o.title.trim(),
      url: url.href,
      ...(author ? { author } : {}),
      ...(level ? { level } : {}),
      tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim().toLowerCase()) : [],
      ...(language ? { language } : {}),
      ...(duration ? { duration } : {}),
    });
  });
  return { videos, problems };
}

/** The YouTube video id of a link, or null. */
export function youtubeId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? url.pathname === '/watch'
          ? url.searchParams.get('v')
          : (/^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null)
        : null;
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

/** The privacy-enhanced embed address for a YouTube video. */
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;

/** Videos matching a search (title, author or tag), a level and a tag. */
export function filterVideos(videos: readonly Video[], q: { text?: string; level?: VideoLevel | ''; tag?: string }): Video[] {
  const text = (q.text ?? '').trim().toLowerCase();
  return videos.filter(
    v =>
      (!q.level || v.level === q.level) &&
      (!q.tag || v.tags.includes(q.tag)) &&
      (!text || v.title.toLowerCase().includes(text) || (v.author ?? '').toLowerCase().includes(text) || v.tags.some(t => t.includes(text))),
  );
}

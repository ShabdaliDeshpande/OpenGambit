import { describe, expect, it } from 'vitest';
import { checkVideos, embedUrl, filterVideos, youtubeId } from './videos';
import shipped from '../../public/videos.json';

describe('video library', () => {
  it('ships empty, in the documented format', () => {
    expect(checkVideos(shipped)).toEqual({ videos: [], problems: [] });
  });

  it('keeps valid videos and explains the rest', () => {
    const { videos, problems } = checkVideos({
      videos: [
        { title: ' Rook endings ', url: 'https://example.org/v/1', author: 'A. Teacher', level: 'intermediate', tags: ['Endgame', 3], language: 'en', duration: '12:30' },
        { title: 'No link', url: 'not a url' },
        { title: '', url: 'https://example.org' },
        { title: 'Odd level', url: 'https://example.org/v/2', level: 'expert', duration: 'long' },
        { title: 'Script', url: 'javascript:alert(1)' },
      ],
    });
    expect(videos).toEqual([
      { title: 'Rook endings', url: 'https://example.org/v/1', author: 'A. Teacher', level: 'intermediate', tags: ['endgame'], language: 'en', duration: '12:30' },
      { title: 'Odd level', url: 'https://example.org/v/2', tags: [] },
    ]);
    expect(problems).toHaveLength(4);
    expect(checkVideos({ list: [] }).problems).toEqual(['The file needs a "videos" list.']);
  });

  it('finds YouTube video ids in the usual link forms', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abcDEF12345')).toBe('abcDEF12345');
    expect(youtubeId('https://youtu.be/abcDEF12345')).toBe('abcDEF12345');
    expect(youtubeId('https://m.youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345');
    expect(youtubeId('https://example.org/watch?v=abcDEF12345')).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch?v=<script>')).toBeNull();
    expect(embedUrl('abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345');
  });

  it('filters by text, level and tag', () => {
    const { videos } = checkVideos({
      videos: [
        { title: 'Opening principles', url: 'https://e.org/1', level: 'beginner', tags: ['opening'] },
        { title: 'Rook endings', url: 'https://e.org/2', author: 'Kim', level: 'advanced', tags: ['endgame'] },
      ],
    });
    expect(filterVideos(videos, { text: 'kim' }).map(v => v.title)).toEqual(['Rook endings']);
    expect(filterVideos(videos, { level: 'beginner' }).map(v => v.title)).toEqual(['Opening principles']);
    expect(filterVideos(videos, { tag: 'endgame', level: 'beginner' })).toEqual([]);
  });
});

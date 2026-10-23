import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STAGES } from '../../learn/lessons';
import { DRILLS } from '../../learn/drills';
import { ENDGAMES } from '../../learn/endgames';
import { BUILTIN_PUZZLES } from '../../puzzles/builtin';
import { LearnView } from './LearnView';
import { LessonPlayer } from './LessonPlayer';
import { DrillPlayer } from './DrillPlayer';
import { EndgamePlayer } from './EndgamePlayer';
import { VideoLibrary } from './VideoLibrary';
import { SolutionExplainer } from '../puzzles/SolutionExplainer';

const noop = () => {};
const count = (html: string, text: string) => html.split(text).length - 1;

describe('learn screens', () => {
  it('lists every lesson stage with its stars, for guests too', () => {
    const html = renderToStaticMarkup(createElement(LearnView, { signedIn: false }));
    for (const stage of STAGES) expect(html).toContain(stage.title);
    expect(html).toContain('aria-label="0 of 3 stars"');
    expect(html).toContain('Your progress is kept in this browser.');
    expect(html).toContain('⏱ Drills');
    expect(html).toContain('🎬 Videos');
  });

  it('shows a lesson’s task, its stars on the board and a hint', () => {
    const stage = STAGES[0]!;
    const level = stage.levels[0]!;
    const html = renderToStaticMarkup(createElement(LessonPlayer, { stage, level, best: 2, onDone: noop, onNext: null, onBack: noop }));
    expect(html).toContain(level.task);
    expect(count(html, 'class="star"')).toBe(level.goal.kind === 'collect' ? level.goal.stars.length : 0);
    expect(html).toContain('three stars in 3');
    expect(html).toContain('<summary>Hint</summary>');
    expect(html).toContain('Your best: ★★☆');
  });

  it('starts a drill on request and shows the best time', () => {
    const drill = DRILLS[0]!;
    const html = renderToStaticMarkup(createElement(DrillPlayer, { drill, best: 42_300, onFinish: noop, onBack: noop }));
    expect(html).toContain('>Start<');
    expect(html).toContain(`0 of ${Math.min(drill.size, drill.positions.length)}`);
    expect(html).toContain('Your best: 0:42.3');
  });

  it('opens an endgame with its goal while the engine looks at it', () => {
    const endgame = ENDGAMES[0]!;
    const html = renderToStaticMarkup(createElement(EndgamePlayer, { endgame, done: true, onWin: noop, onBack: noop }));
    expect(html).toContain(endgame.task);
    expect(html).toContain(`${endgame.title} ✓`);
    expect(html).toContain('The engine is thinking');
    expect(html).toContain('you play White against the engine');
  });

  it('loads the video library and offers the puzzle explanation', () => {
    expect(renderToStaticMarkup(createElement(VideoLibrary))).toContain('Loading videos…');
    expect(renderToStaticMarkup(createElement(SolutionExplainer, { puzzle: BUILTIN_PUZZLES[0]! }))).toContain('💡 Explain the solution');
  });
});

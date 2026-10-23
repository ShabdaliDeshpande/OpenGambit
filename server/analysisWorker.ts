// Runs in a worker thread: analyses every position of one game with this
// app's engine (two lines each, like the browser's review) and reports back,
// so a long analysis never blocks the server's main thread.
import { parentPort } from 'node:worker_threads';
import { analyse, type UciMove } from '../src/engine/search.ts';
import type { AnalyserRequest, AnalyserMessage } from './analysisQueue.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const toUci = (s: string): UciMove => ({ from: s.slice(0, 2), to: s.slice(2, 4), ...(s[4] ? { promotion: s[4] } : {}) }) as UciMove;

parentPort!.on('message', (req: AnalyserRequest) => {
  const post = (m: AnalyserMessage) => parentPort!.postMessage(m);
  try {
    const moves = req.moves.map(toUci);
    const positions: AnalyserMessage & { type: 'done' } = { type: 'done', positions: [] };
    for (let i = 0; i <= moves.length; i++) {
      const info = analyse(START, moves.slice(0, i), { multiPv: 2, maxDepth: 16, maxMs: req.ms });
      const [first, second] = info?.lines ?? [];
      positions.positions.push({
        first: first ? { cp: first.cp, mate: first.mate, pv: first.pv.slice(0, 8) } : null,
        second: second ? { cp: second.cp, mate: second.mate } : null,
      });
      post({ type: 'progress', done: i + 1, total: moves.length + 1 });
    }
    post(positions);
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
});

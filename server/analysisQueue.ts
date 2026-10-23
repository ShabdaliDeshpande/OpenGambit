// Optional server-side game analysis (ANALYSIS_QUEUE=1). Signed-in players
// can ask the server to review one of their games; games wait in a queue and
// are analysed one at a time in a worker thread, then saved like a review
// made in the browser. Off by default: free hosting has slow, shared CPUs.
import { Worker } from 'node:worker_threads';
import { Chess } from 'chess.js';
import type { Store, StoredGame } from './store.ts';
import { reviewMoves, type GameMove, type PositionEval } from '../src/analysis/gameReview.ts';
import { scoreOf } from '../src/analysis/review.ts';
import { toStoredReview } from '../src/analysis/savedReview.ts';
import { reviewStats } from '../src/analysis/reviewData.ts';
import type { UciMove } from '../src/engine/search.ts';
import { Explorer } from './explorer/explorerStore.ts';

export interface AnalyserRequest {
  /** The game's moves in UCI, from the standard start. */
  moves: string[];
  /** Engine time per position. */
  ms: number;
}

export interface RawLine {
  cp: number | null;
  mate: number | null;
  pv?: UciMove[];
}

/** One analysed position: the engine's best line and the score of its second choice. */
export interface RawPosition {
  first: RawLine | null;
  second: RawLine | null;
}

export type AnalyserMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; positions: RawPosition[] }
  | { type: 'error'; error: string };

export type Analyser = (req: AnalyserRequest, onProgress: (done: number, total: number) => void) => Promise<RawPosition[]>;

/** Analyses a game in a fresh worker thread. */
export const workerAnalyser: Analyser = (req, onProgress) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysisWorker.ts', import.meta.url));
    const finish = () => void worker.terminate();
    worker.on('message', (m: AnalyserMessage) => {
      if (m.type === 'progress') onProgress(m.done, m.total);
      else if (m.type === 'done') {
        finish();
        resolve(m.positions);
      } else {
        finish();
        reject(new Error(m.error));
      }
    });
    worker.on('error', e => {
      finish();
      reject(e);
    });
    worker.postMessage(req);
  });

/** Names the engine and settings saved with server reviews. */
export const SERVER_ENGINE = 'opengambit-2 multipv2 server';

export type AnalysisStatus =
  | { status: 'none' }
  | { status: 'queued'; position: number }
  | { status: 'running'; done: number; total: number }
  | { status: 'failed' };

interface Job {
  game: StoredGame;
  userId: string;
}

export class AnalysisQueue {
  private readonly store: Store;
  private readonly analyser: Analyser;
  /** Engine time per position. */
  readonly ms: number;
  private readonly maxQueue: number;
  private readonly waiting: Job[] = [];
  private running: { gameId: string; done: number; total: number } | null = null;
  private readonly failed = new Set<string>();
  private work: Promise<void> = Promise.resolve();

  constructor(store: Store, analyser: Analyser = workerAnalyser, options: { ms?: number; maxQueue?: number } = {}) {
    this.store = store;
    this.analyser = analyser;
    this.ms = options.ms ?? 600;
    this.maxQueue = options.maxQueue ?? 30;
  }

  status(gameId: string): AnalysisStatus {
    if (this.running?.gameId === gameId) return { status: 'running', done: this.running.done, total: this.running.total };
    const i = this.waiting.findIndex(j => j.game.id === gameId);
    if (i >= 0) return { status: 'queued', position: i + 1 };
    return this.failed.has(gameId) ? { status: 'failed' } : { status: 'none' };
  }

  /** Puts a game in the queue (once); returns its place, or null when the queue is full. */
  enqueue(game: StoredGame, userId: string): AnalysisStatus | null {
    const now = this.status(game.id);
    if (now.status === 'queued' || now.status === 'running') return now;
    if (this.waiting.length >= this.maxQueue) return null;
    this.failed.delete(game.id);
    this.waiting.push({ game, userId });
    if (!this.running) this.work = this.pump();
    return this.status(game.id);
  }

  /** Resolves once the queue is empty (for tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running || this.waiting.length) await this.work;
  }

  private async pump(): Promise<void> {
    for (let job = this.waiting.shift(); job; job = this.waiting.shift()) {
      this.running = { gameId: job.game.id, done: 0, total: job.game.moves.length + 1 };
      try {
        const raw = await this.analyser({ moves: job.game.moves, ms: this.ms }, (done, total) => {
          if (this.running) this.running = { ...this.running, done, total };
        });
        await this.save(job, raw);
      } catch (e) {
        console.error(`Analysis of game ${job.game.id} failed:`, e);
        this.failed.add(job.game.id);
      }
      this.running = null;
    }
  }

  private async save({ game, userId }: Job, raw: RawPosition[]) {
    const chess = new Chess();
    const fens = [chess.fen()];
    const moves: GameMove[] = game.moves.map((u, i) => {
      const fenBefore = chess.fen();
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u[4] ? { promotion: u[4] } : {}) });
      fens.push(chess.fen());
      return { ply: i + 1, color: m.color, fenBefore, fenAfter: chess.fen(), uci: { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }, san: m.san };
    });
    if (raw.length !== fens.length) throw new Error('analysis does not cover every position');
    const evals: PositionEval[] = raw.map((p, i) => ({
      score: scoreOf(p.first ?? undefined, fens[i]!),
      best: p.first?.pv?.[0] ?? null,
      second: p.second ? scoreOf(p.second, fens[i]!) : null,
      pv: p.first?.pv ?? [],
    }));
    // book moves come from imported master games, when there are any
    const flags = await new Explorer(this.store.db).bookFlags(game.moves);
    const id = (fen: string, m: { from: string; to: string; promotion?: string }) => `${fen}|${m.from}${m.to}${m.promotion ?? ''}`;
    const book = new Set(moves.filter((_m, i) => flags[i]).map(m => id(m.fenBefore, m.uci)));
    const reviewed = reviewMoves(moves, evals, { isBook: (fen, m) => book.has(id(fen, m)) });
    const review = toStoredReview(evals, reviewed, SERVER_ENGINE, this.ms);
    const { accuracy, performance } = reviewStats(review, 'w', { w: game.whiteRating, b: game.blackRating });
    await this.store.saveReview({
      gameId: game.id,
      review,
      whiteAccuracy: accuracy.w,
      blackAccuracy: accuracy.b,
      whitePerformance: performance.w,
      blackPerformance: performance.b,
      reviewedBy: userId,
    });
  }
}

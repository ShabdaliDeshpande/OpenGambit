import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import {
  checkPassword,
  checkUsername,
  clearedSessionCookie,
  dummyHash,
  hashPassword,
  LoginLimiter,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  verifyPassword,
} from './auth.ts';
import { CATEGORIES, currentGlicko, displayRating, SESSION_TTL_MS, type Ratings, type StoredGame, type Store, type User } from './store.ts';
import { clientIp, sameOrigin } from './transport.ts';
import { buildDashboard } from './puzzleDashboard.ts';
import { PuzzleCatalogue, solves, themeWeight } from './puzzles.ts';
import type { UciMove } from '../src/puzzles/types.ts';
import { checkReview, reviewStats } from '../src/analysis/reviewData.ts';
import type { Account } from './types.ts';

export interface ApiOptions {
  trustProxy?: boolean;
  now?: () => number;
  /** Failed logins allowed per username or address within 15 minutes. */
  maxLoginFailures?: number;
  /** New accounts allowed per address per hour. */
  maxSignupsPerHour?: number;
  /** Puzzles the server can rate; defaults to the built-in set plus any imported file. */
  puzzles?: PuzzleCatalogue;
  /** Puzzle attempts allowed per player per 10 minutes. */
  maxPuzzleAttempts?: number;
  /** Saved reviews allowed per player per 10 minutes. */
  maxReviewWrites?: number;
}

const MAX_BODY = 4096;
/** A review carries a score, best move and short line for every position. */
const MAX_REVIEW_BODY = 256 * 1024;
const GAME_ID = /^[A-Za-z0-9]{1,16}$/;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reject(new HttpError(415, 'Expected JSON.'));
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // keep reading (and dropping) the rest, so the 413 reply can still be sent
      if (size <= maxBody) chunks.push(chunk);
      else if (size > maxBody * 16) req.destroy();
    });
    req.on('end', () => {
      if (size > maxBody) return reject(new HttpError(413, 'Request too large.'));
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const isHttps = (req: IncomingMessage, trustProxy: boolean) =>
  !!(req.socket as TLSSocket).encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');

/** Ratings as the API shows them: rounded, with deviation, game count and the provisional flag. */
export function publicRatings(ratings: Ratings, now: number) {
  return Object.fromEntries(
    CATEGORIES.map(c => {
      const g = currentGlicko(ratings[c], now);
      return [c, { ...displayRating(g), deviation: Math.round(g.deviation), games: ratings[c].games }];
    }),
  );
}

export function publicGame(g: StoredGame, withMoves = false) {
  const side = (c: 'white' | 'black') => ({
    id: g[`${c}Id`],
    name: g[`${c}Name`],
    rating: g[`${c}Rating`],
    diff: g[`${c}Diff`],
  });
  return {
    id: g.id,
    white: side('white'),
    black: side('black'),
    tc: g.tc,
    category: g.category,
    rated: g.rated,
    result: g.result,
    reason: g.reason,
    plies: g.moves.length,
    startedAt: g.startedAt,
    endedAt: g.endedAt,
    ...(withMoves ? { moves: g.moves } : {}),
    ...(g.review !== undefined ? { review: g.review } : {}),
  };
}

/**
 * The account API, mounted at /api by the dev server and the standalone
 * server. Sessions are random tokens in an HttpOnly cookie; the database only
 * keeps their hash. Every write requires JSON and a same-site Origin, which
 * together with SameSite=Lax cookies keeps other sites from acting for a user.
 */
export function createApi(store: Store, options: ApiOptions = {}) {
  const { trustProxy = false, now = () => Date.now() } = options;
  const maxFailures = options.maxLoginFailures ?? 10;
  const logins = new LoginLimiter(maxFailures, 15 * 60_000, now);
  // one address may be a whole school or office behind NAT, so it gets more room
  const loginsByIp = new LoginLimiter(maxFailures * 3, 15 * 60_000, now);
  const signups = new LoginLimiter(options.maxSignupsPerHour ?? 5, 60 * 60_000, now);
  const puzzles = options.puzzles ?? PuzzleCatalogue.load();
  const puzzleAttempts = new LoginLimiter(options.maxPuzzleAttempts ?? 120, 10 * 60_000, now);
  const reviewWrites = new LoginLimiter(options.maxReviewWrites ?? 30, 10 * 60_000, now);

  const puzzleRatingOf = async (userId: string) => {
    const g = currentGlicko(await store.puzzleRating(userId), now());
    return { ...displayRating(g), deviation: Math.round(g.deviation) };
  };

  const currentUser = async (req: IncomingMessage): Promise<User | undefined> => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    return token ? store.userForSession(token) : undefined;
  };

  const me = async (user: User | undefined) =>
    user
      ? {
          id: user.id,
          username: user.username,
          ratings: publicRatings(await store.ratings(user.id), now()),
          puzzleRating: await puzzleRatingOf(user.id),
        }
      : null;

  const startSession = async (req: IncomingMessage, res: ServerResponse, user: User) => {
    const token = await store.createSession(user.id);
    send(res, 200, { user: await me(user) }, { 'set-cookie': sessionCookie(token, isHttps(req, trustProxy), SESSION_TTL_MS) });
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method ?? 'GET';

    if (method === 'POST') {
      if (!req.headers.origin || !sameOrigin(req)) throw new HttpError(403, 'Cross-site request refused.');
      const ip = clientIp(req, trustProxy);

      if (path === '/api/signup') {
        const body = await readJson(req);
        const problem = checkUsername(body.username) ?? checkPassword(body.password, String(body.username));
        if (problem) throw new HttpError(400, problem);
        if (signups.blocked(ip)) throw new HttpError(429, 'Too many new accounts from your address. Try again later.');
        const user = await store.createUser(body.username as string, await hashPassword(body.password as string));
        if (!user) throw new HttpError(409, 'That username is taken.');
        signups.fail(ip);
        return startSession(req, res, user);
      }

      if (path === '/api/login') {
        const body = await readJson(req);
        if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 40 || body.password.length > 128)
          throw new HttpError(400, 'Enter your username and password.');
        const key = `user:${body.username.toLowerCase()}`;
        if (logins.blocked(key) || loginsByIp.blocked(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
        const found = await store.credentials(body.username);
        const ok = await verifyPassword(body.password, found?.passwordHash ?? (await dummyHash()));
        if (!found || !ok) {
          logins.fail(key);
          loginsByIp.fail(ip);
          throw new HttpError(401, 'Wrong username or password.');
        }
        logins.succeed(key);
        return startSession(req, res, found.user);
      }

      if (path === '/api/puzzles/run') {
        const user = await currentUser(req);
        if (!user) throw new HttpError(401, 'Sign in to keep your best runs.');
        const body = await readJson(req);
        const mode = body.mode === 'streak' || body.mode === 'storm' ? body.mode : null;
        if (!mode) throw new HttpError(400, 'Unknown run type.');
        // runs are scored in the browser, so only plausible scores are kept (no leaderboard, as on lila)
        const max = mode === 'streak' ? puzzles.size : 300;
        if (!Number.isInteger(body.score) || (body.score as number) < 0 || (body.score as number) > max) throw new HttpError(400, 'That score isn’t possible.');
        if (puzzleAttempts.blocked(user.id)) throw new HttpError(429, 'That’s a lot of puzzles! Take a short break.');
        puzzleAttempts.fail(user.id);
        return send(res, 200, await store.recordRun(user.id, mode, body.score as number));
      }

      if (path === '/api/puzzles/attempt') {
        const user = await currentUser(req);
        if (!user) throw new HttpError(401, 'Sign in to get a puzzle rating.');
        const body = await readJson(req);
        const puzzle = typeof body.id === 'string' ? puzzles.get(body.id) : undefined;
        if (!puzzle) throw new HttpError(404, 'No such puzzle.');
        if (typeof body.win !== 'boolean') throw new HttpError(400, 'Say whether the puzzle was solved.');
        if (puzzleAttempts.blocked(user.id)) throw new HttpError(429, 'That’s a lot of puzzles! Take a short break.');
        // a solve must come with the moves, and they must be the solution
        if (body.win && !(Array.isArray(body.moves) && body.moves.length <= 40 && solves(puzzle, body.moves as UciMove[])))
          throw new HttpError(400, 'Those moves don’t solve the puzzle.');
        puzzleAttempts.fail(user.id);
        // training one theme counts for less, as lila does; the theme must be one the puzzle has
        const theme = typeof body.theme === 'string' && puzzle.themes.includes(body.theme) ? body.theme : null;
        const result = await store.recordPuzzle(user.id, puzzle, body.win, themeWeight(theme, body.win));
        return send(res, 200, {
          first: result.first,
          diff: result.diff,
          rating: { ...displayRating(result.rating), deviation: Math.round(result.rating.deviation) },
        });
      }

      if (path === '/api/account/password' || path === '/api/account/delete') {
        const user = await currentUser(req);
        if (!user) throw new HttpError(401, 'Sign in first.');
        const body = await readJson(req);
        const key = `user:${user.username.toLowerCase()}`;
        if (logins.blocked(key) || loginsByIp.blocked(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
        const current = typeof body.current === 'string' ? body.current : '';
        if (!(await verifyPassword(current, (await store.passwordHash(user.id)) ?? (await dummyHash())))) {
          logins.fail(key);
          loginsByIp.fail(ip);
          throw new HttpError(403, 'Your current password is wrong.');
        }
        const token = readCookie(req.headers.cookie, SESSION_COOKIE) ?? null;
        if (path === '/api/account/password') {
          const problem = checkPassword(body.password, user.username);
          if (problem) throw new HttpError(400, problem);
          if (body.password === current) throw new HttpError(400, 'Choose a password different from the current one.');
          await store.setPassword(user.id, await hashPassword(body.password as string), token);
          return send(res, 200, { ok: true });
        }
        if (body.confirm !== user.username) throw new HttpError(400, 'Type your username to confirm.');
        await store.deleteUser(user.id);
        return send(res, 200, { user: null }, { 'set-cookie': clearedSessionCookie(isHttps(req, trustProxy)) });
      }

      const reviewPost = /^\/api\/games\/([^/]+)\/review$/.exec(path);
      if (reviewPost) {
        const user = await currentUser(req);
        if (!user) throw new HttpError(401, 'Sign in to save reviews with your games.');
        const id = reviewPost[1]!;
        const game = GAME_ID.test(id) ? await store.game(id) : undefined;
        if (!game) throw new HttpError(404, 'No such game.');
        if (game.whiteId !== user.id && game.blackId !== user.id) throw new HttpError(403, 'Only the players can save a review of this game.');
        if (reviewWrites.blocked(user.id)) throw new HttpError(429, 'That’s a lot of reviews. Try again in a few minutes.');
        const body = await readJson(req, MAX_REVIEW_BODY);
        const review = checkReview(body.review, game.moves.length);
        if (typeof review === 'string') throw new HttpError(400, review);
        reviewWrites.fail(user.id);
        // the server works out accuracy itself, from the scores; online games always start with White to move
        const { accuracy, performance } = reviewStats(review, 'w', { w: game.whiteRating, b: game.blackRating });
        const saved = await store.saveReview({
          gameId: game.id,
          review,
          whiteAccuracy: accuracy.w,
          blackAccuracy: accuracy.b,
          whitePerformance: performance.w,
          blackPerformance: performance.b,
          reviewedBy: user.id,
        });
        return send(res, 200, { saved, accuracy: { white: accuracy.w, black: accuracy.b } });
      }

      if (path === '/api/logout') {
        const token = readCookie(req.headers.cookie, SESSION_COOKIE);
        if (token) await store.deleteSession(token);
        return send(res, 200, { user: null }, { 'set-cookie': clearedSessionCookie(isHttps(req, trustProxy)) });
      }
      throw new HttpError(404, 'Not found.');
    }

    if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');

    if (path === '/api/me') return send(res, 200, { user: await me(await currentUser(req)) });

    if (path === '/api/puzzles/daily') {
      const daily = puzzles.daily(now());
      const user = await currentUser(req);
      const today = Math.floor(now() / 86_400_000) * 86_400_000;
      const solved = user ? (await store.puzzleAttempts(user.id, 200)).some(a => a.puzzleId === daily.id && a.win && a.createdAt >= today) : false;
      return send(res, 200, { id: daily.id, date: new Date(today).toISOString().slice(0, 10), solved });
    }

    if (path === '/api/puzzles/runs') {
      const user = await currentUser(req);
      if (!user) throw new HttpError(401, 'Sign in to keep your best runs.');
      return send(res, 200, { runs: await store.runBests(user.id) });
    }

    if (path === '/api/puzzles/dashboard') {
      const user = await currentUser(req);
      if (!user) throw new HttpError(401, 'Sign in to see your puzzle dashboard.');
      const rating = currentGlicko(await store.puzzleRating(user.id), now());
      return send(res, 200, { dashboard: buildDashboard(await store.puzzleAttempts(user.id), rating) });
    }

    const profile = /^\/api\/users\/([^/]+)$/.exec(path);
    const history = /^\/api\/users\/([^/]+)\/games$/.exec(path);
    if (profile || history) {
      const name = decodeURIComponent((profile ?? history)![1]!);
      const user = name.length <= 40 ? await store.userByName(name) : undefined;
      if (!user) throw new HttpError(404, 'No such player.');
      const before = Number(url.searchParams.get('before')) || undefined;
      const games = (await store.gamesOf(user.id, 20, before)).map(g => publicGame(g));
      if (history) return send(res, 200, { games });
      return send(res, 200, {
        user: { id: user.id, username: user.username, createdAt: user.createdAt },
        ratings: publicRatings(await store.ratings(user.id), now()),
        puzzleRating: await puzzleRatingOf(user.id),
        runs: await store.runBests(user.id),
        totalGames: await store.countGames(user.id),
        games,
      });
    }

    if (path === '/api/leaderboard') {
      const boards = Object.fromEntries(
        await Promise.all([...CATEGORIES, 'puzzle' as const].map(async c => [c, await store.leaderboard(c, 10)] as const)),
      );
      return send(res, 200, { leaderboard: boards });
    }

    if (path === '/api/tournaments') return send(res, 200, { tournaments: await store.recentTournaments(30) });
    const tour = /^\/api\/tournaments\/([^/]+)$/.exec(path);
    if (tour) {
      const id = tour[1]!;
      const stored = GAME_ID.test(id) ? await store.tournament(id) : undefined;
      if (!stored) throw new HttpError(404, 'No such tournament.');
      return send(res, 200, { tournament: stored });
    }

    const reviewGet = /^\/api\/games\/([^/]+)\/review$/.exec(path);
    if (reviewGet) {
      const id = reviewGet[1]!;
      const stored = GAME_ID.test(id) ? await store.game(id) : undefined;
      if (!stored) throw new HttpError(404, 'No such game.');
      const found = await store.review(id);
      return send(res, 200, { review: found?.review ?? null });
    }

    const game = /^\/api\/games\/([^/]+)$/.exec(path);
    if (game) {
      const id = game[1]!;
      const stored = GAME_ID.test(id) ? await store.game(id) : undefined;
      if (!stored) throw new HttpError(404, 'No such game.');
      return send(res, 200, { game: publicGame(stored, true) });
    }

    throw new HttpError(404, 'Not found.');
  }

  /** Node/connect style handler; requests outside /api are passed on. */
  const handler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (!(req.url ?? '').startsWith('/api/') && req.url !== '/api') {
      if (next) next();
      else send(res, 404, { error: 'Not found.' });
      return;
    }
    route(req, res).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('API error:', err);
      send(res, 500, { error: 'Something went wrong.' });
    });
  };

  /** The account behind a WebSocket upgrade request's session cookie. */
  const identify = async (req: IncomingMessage): Promise<Account | null> => {
    const user = await currentUser(req);
    return user ? { user, ratings: await store.ratings(user.id) } : null;
  };

  return { handler, identify };
}

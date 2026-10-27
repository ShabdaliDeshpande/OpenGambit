// HTTP routes for daily chess, notifications, vacation and flair. The main
// API hands over any request it doesn't know; this returns false when the
// path isn't one of these either.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { validFlair } from '../../src/account/flair.ts';
import { LoginLimiter } from '../auth.ts';
import { HttpError, readJson, send } from '../http.ts';
import type { Store, User } from '../store.ts';
import type { DailyService } from './daily.ts';

const ID = /^[A-Za-z0-9]{1,16}$/;

export interface DailyRouteContext {
  store: Store;
  daily: DailyService;
  currentUser: (req: IncomingMessage) => Promise<User | undefined>;
  /** Test clock (DAILY_TEST_CLOCK=1 only): moves the daily clock forward. */
  advanceClock?: ((ms: number) => void) | null;
}

export function dailyRoutes(ctx: DailyRouteContext) {
  const { store, daily, currentUser } = ctx;
  // generous: a player with many games may move in most of them in one sitting
  const writes = new LoginLimiter(300, 10 * 60_000, daily.now);

  const signedIn = async (req: IncomingMessage) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Sign in to play daily chess.');
    return user;
  };
  const writer = async (req: IncomingMessage) => {
    const user = await signedIn(req);
    if (writes.blocked(user.id)) throw new HttpError(429, 'That’s a lot of actions. Try again in a few minutes.');
    writes.fail(user.id);
    return user;
  };

  return async function route(method: string, path: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const reply = (body: unknown) => {
      send(res, 200, body);
      return true;
    };
    let m: RegExpExecArray | null;

    if (method === 'GET') {
      if (path === '/api/daily/seeks') return reply({ seeks: await daily.seeks(await currentUser(req)) });
      if (path === '/api/daily/games') return reply({ games: await daily.myGames(await signedIn(req)) });
      if (path === '/api/daily/challenges') return reply({ challenges: await daily.challenges(await signedIn(req)) });
      if (path === '/api/daily/tours') return reply({ tours: await daily.tours.list() });
      if ((m = /^\/api\/daily\/tours\/([^/]+)$/.exec(path))) {
        const tour = ID.test(m[1]!) ? await daily.tours.view(m[1]!) : null;
        if (!tour) throw new HttpError(404, 'No such tournament.');
        return reply({ tour });
      }
      if ((m = /^\/api\/daily\/games\/([^/]+)$/.exec(path))) {
        const game = ID.test(m[1]!) ? await daily.view(m[1]!, await currentUser(req)) : null;
        if (!game) throw new HttpError(404, 'No such daily game.');
        return reply({ game });
      }
      if (path === '/api/notifications') return reply(await daily.notifications(await signedIn(req)));
      if (path === '/api/account/vacation') return reply({ vacation: await daily.vacation(await signedIn(req)) });
      return false;
    }

    if (path === '/api/daily/seeks') {
      const user = await writer(req);
      const body = await readJson(req);
      return reply({ id: await daily.createSeek(user, body.days, body.color, body.rated) });
    }
    if ((m = /^\/api\/daily\/seeks\/([^/]+)\/(accept|cancel)$/.exec(path))) {
      const user = await writer(req);
      if (!ID.test(m[1]!)) throw new HttpError(404, 'That seek is gone.');
      if (m[2] === 'cancel') {
        await daily.cancelSeek(user, m[1]!);
        return reply({ ok: true });
      }
      return reply({ game: await daily.acceptSeek(user, m[1]!) });
    }
    if (path === '/api/daily/challenges') {
      const user = await writer(req);
      const body = await readJson(req);
      return reply({ id: await daily.challenge(user, body.to, body.days, body.color, body.rated) });
    }
    if ((m = /^\/api\/daily\/challenges\/([^/]+)\/(accept|decline|cancel)$/.exec(path))) {
      const user = await writer(req);
      if (!ID.test(m[1]!)) throw new HttpError(404, 'No such challenge.');
      return reply({ game: await daily.answerChallenge(user, m[1]!, m[2] as 'accept' | 'decline' | 'cancel') });
    }
    if ((m = /^\/api\/daily\/games\/([^/]+)\/(move|resign|draw|lines)$/.exec(path))) {
      const user = await writer(req);
      const id = m[1]!;
      if (!ID.test(id)) throw new HttpError(404, 'No such daily game.');
      const body = await readJson(req, m[2] === 'lines' ? 32 * 1024 : undefined);
      if (m[2] === 'move') {
        if (typeof body.uci !== 'string' || !Number.isInteger(body.ply)) throw new HttpError(400, 'Send the move (uci) and the ply it’s played at.');
        return reply({ game: await daily.move(user, id, body.uci, body.ply as number) });
      }
      if (m[2] === 'resign') await daily.resign(user, id);
      else if (m[2] === 'draw') {
        if (body.action !== 'offer' && body.action !== 'accept' && body.action !== 'decline') throw new HttpError(400, 'Offer, accept or decline.');
        await daily.draw(user, id, body.action);
      } else return reply({ lines: await daily.setLines(user, id, body.lines) });
      return reply({ game: await daily.view(id, user) });
    }
    if (path === '/api/daily/tours') {
      const user = await writer(req);
      const b = await readJson(req);
      const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
      const id = await daily.createTour(user, {
        kind: b.kind as 'swiss' | 'arena',
        name: typeof b.name === 'string' ? b.name : '',
        days: num(b.days),
        rated: b.rated === true,
        startInHours: num(b.startInHours),
        nbRounds: num(b.nbRounds),
        durationDays: num(b.durationDays),
      });
      return reply({ id });
    }
    if ((m = /^\/api\/daily\/tours\/([^/]+)\/(join|leave)$/.exec(path))) {
      const user = await writer(req);
      if (!ID.test(m[1]!)) throw new HttpError(404, 'No such tournament.');
      if (m[2] === 'join') await daily.tours.join(user.id, user.username, m[1]!);
      else await daily.tours.leave(user.id, m[1]!);
      return reply({ tour: await daily.tours.view(m[1]!) });
    }
    if (path === '/api/notifications/seen') {
      const user = await signedIn(req);
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x.length <= 20).slice(0, 100) : null;
      await daily.markSeen(user, ids);
      return reply(await daily.notifications(user));
    }
    if (path === '/api/account/vacation') {
      const user = await writer(req);
      const body = await readJson(req);
      const days = body.end === true ? null : Number(body.days);
      return reply({ vacation: await daily.setVacation(user, days) });
    }
    if (path === '/api/account/flair') {
      const user = await signedIn(req);
      const body = await readJson(req);
      if (body.flair !== null && !validFlair(body.flair)) throw new HttpError(400, 'Choose one of the listed flairs.');
      await store.setFlair(user.id, body.flair as string | null);
      return reply({ flair: body.flair });
    }
    if (path === '/api/daily/test-clock' && ctx.advanceClock) {
      const body = await readJson(req);
      const ms = Number(body.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 400 * 86_400_000) throw new HttpError(400, 'Give a number of milliseconds.');
      ctx.advanceClock(ms);
      await daily.sweep();
      return reply({ now: daily.now() });
    }
    return false;
  };
}

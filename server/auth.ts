import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** "scrypt$N$r$p$salt$hash", so the cost can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummy: Promise<string> | null = null;
/** A hash to compare against when the user doesn't exist, so timing doesn't reveal it. */
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(12).toString('hex')));

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
const RESERVED = new Set(['admin', 'administrator', 'anonymous', 'guest', 'moderator', 'system', 'root', 'support', 'null', 'undefined']);

export function checkUsername(name: unknown): string | null {
  if (typeof name !== 'string' || !USERNAME.test(name))
    return 'Usernames are 3–20 characters: letters, digits, _ or -, starting with a letter or digit.';
  if (RESERVED.has(name.toLowerCase()) || /^guest[\s_-]?\d*$/i.test(name)) return 'That username is reserved.';
  return null;
}

export function checkPassword(password: unknown, username = ''): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Passwords need at least 8 characters.';
  if (password.length > 128) return 'Passwords can be at most 128 characters.';
  if (username && password.toLowerCase() === username.toLowerCase()) return 'Your password can’t be your username.';
  return null;
}

export const SESSION_COOKIE = 'ocb_session';

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean, maxAgeMs: number): string {
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export const clearedSessionCookie = (secure: boolean) => sessionCookie('', secure, 0);

/**
 * Slows down password guessing: after `max` failures for the same key
 * (username or address) within the window, attempts are refused until it passes.
 */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max = 10, windowMs = 15 * 60_000, now: () => number = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  blocked(...keys: string[]): boolean {
    const since = this.now() - this.windowMs;
    return keys.some(k => (this.failures.get(k) ?? []).filter(t => t > since).length >= this.max);
  }

  fail(...keys: string[]): void {
    const now = this.now();
    for (const k of keys) {
      const recent = (this.failures.get(k) ?? []).filter(t => t > now - this.windowMs);
      recent.push(now);
      this.failures.set(k, recent);
    }
    if (this.failures.size > 10_000) this.failures.clear();
  }

  succeed(...keys: string[]): void {
    for (const k of keys) this.failures.delete(k);
  }
}

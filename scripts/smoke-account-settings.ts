// End-to-end check against a running server: change password, read the
// leaderboard, then delete the test account again.
// Usage: node scripts/smoke-account-settings.ts [http://localhost:5173]
const base = process.argv[2] ?? 'http://localhost:5173';
const name = `acct${Date.now().toString(36).slice(-6)}`;

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

const first = cookieOf(await post('/api/signup', { username: name, password: 'first-pass' }));
const second = cookieOf(await post('/api/login', { username: name, password: 'first-pass' }));
const change = await post('/api/account/password', { current: 'first-pass', password: 'second-pass' }, first);
console.log('change password:', change.status);
const meOther = await (await fetch(`${base}/api/me`, { headers: { cookie: second } })).json();
console.log('other session signed out:', meOther.user === null);
console.log('login with new password:', (await post('/api/login', { username: name, password: 'second-pass' })).status);

const board = (await (await fetch(`${base}/api/leaderboard`)).json()).leaderboard;
console.log('leaderboard sizes:', Object.fromEntries(Object.entries(board).map(([k, v]) => [k, (v as unknown[]).length])));

const del = await post('/api/account/delete', { current: 'second-pass', confirm: name }, first);
console.log('delete account:', del.status, '| profile now:', (await fetch(`${base}/api/users/${name}`)).status);

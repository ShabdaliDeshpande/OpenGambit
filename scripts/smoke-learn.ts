// End-to-end check of learning progress against a running server: guests are
// turned away, an account saves lessons, drills and endgames, a worse result
// never overwrites a better one, and another account sees none of it.
// Usage: node scripts/smoke-learn.ts [http://localhost:5173]

const base = process.argv[2] ?? 'http://localhost:5173';
const suffix = Date.now().toString(36).slice(-5);

async function signUp(name: string) {
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username: name, password: 'smoke-test-pass' }),
  });
  if (!res.ok) throw new Error(`signup ${name}: ${res.status} ${await res.text()}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

const save = async (progress: unknown, cookie: string) => {
  const res = await fetch(`${base}/api/learn/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ progress }),
  });
  return { status: res.status, body: (await res.json()) as { progress?: Record<string, number>; error?: string } };
};
const read = async (cookie?: string) => {
  const res = await fetch(`${base}/api/learn/progress`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: (await res.json()) as { progress?: Record<string, number> } };
};

console.log('guest read:', (await read()).status, '· guest save:', (await save({ 'lesson:rook-1': 3 }, '')).status);

const cookieA = await signUp(`learnA${suffix}`);
const cookieB = await signUp(`learnB${suffix}`);
console.log('new account:', JSON.stringify((await read(cookieA)).body.progress));

const first = await save({ 'lesson:rook-1': 2, 'lesson:mate-1': 3, 'drill:mate-in-one': 61_500, 'endgame:kq-k': 1, 'lesson:rook-2': 7, 'not-a-key': 1 }, cookieA);
console.log('first save:', first.status, JSON.stringify(first.body.progress));

const second = await save({ 'lesson:rook-1': 3, 'lesson:mate-1': 1, 'drill:mate-in-one': 70_000 }, cookieA);
console.log('better lesson, worse lesson, slower drill:', JSON.stringify(second.body.progress));

const third = await save({ 'drill:mate-in-one': 48_200 }, cookieA);
console.log('faster drill:', third.body.progress?.['drill:mate-in-one']);

console.log('read back:', JSON.stringify((await read(cookieA)).body.progress));
console.log('other account:', JSON.stringify((await read(cookieB)).body.progress));
console.log('not an object:', (await save([1, 2], cookieA)).status);

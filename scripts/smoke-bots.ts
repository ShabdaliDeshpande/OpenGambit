// End-to-end check of bot results against a running server: a draw and then
// a win against a bot are saved with the account's progress, a later draw
// doesn't undo the win, made-up results are ignored, and lessons stay put.
// Usage: node scripts/smoke-bots.ts [http://localhost:5173]

const base = process.argv[2] ?? 'http://localhost:5173';
const suffix = Date.now().toString(36).slice(-5);

const res = await fetch(`${base}/api/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ username: `bots${suffix}`, password: 'smoke-test-pass' }),
});
if (!res.ok) throw new Error(`signup: ${res.status} ${await res.text()}`);
const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;

const save = async (progress: Record<string, number>) => {
  const r = await fetch(`${base}/api/learn/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ progress }),
  });
  return ((await r.json()) as { progress: Record<string, number> }).progress;
};

console.log('draw against Moss, plus a lesson:', JSON.stringify(await save({ 'bot:moss': 1, 'lesson:rook-1': 3 })));
console.log('then a win:', JSON.stringify(await save({ 'bot:moss': 2 })));
console.log('a later draw keeps the win:', JSON.stringify(await save({ 'bot:moss': 1 })));
console.log('made-up results are ignored:', JSON.stringify(await save({ 'bot:summit': 5, 'bot:Not A Bot': 2 })));
const read = await fetch(`${base}/api/learn/progress`, { headers: { cookie } });
console.log('read back:', JSON.stringify(((await read.json()) as { progress: object }).progress));

// End-to-end check of the app in WebKit, the browser engine iPhones use, on an
// iPhone-sized screen and against a running server: the board, the computer's
// engine (a module worker), bots, puzzles, promotion, the analysis board, the
// online lobby, and that no screen scrolls sideways.
//
// Playwright isn't one of the project's packages; get it and its WebKit first:
//   npm i --no-save playwright && npx playwright install webkit
// Usage: node scripts/smoke-iphone.ts [http://localhost:8787] [webkit|chromium]
import process from 'node:process';

const base = process.argv[2] ?? 'http://localhost:8787';
const engine = process.argv[3] ?? 'webkit';
// @ts-ignore: installed on demand (see above)
const playwright = await import('playwright');

let failures = 0;
const check = (ok: unknown, what: string) => {
  if (!ok) failures++;
  console.log(ok ? 'ok   -' : 'FAIL -', what);
};

const { defaultBrowserType: _unused, ...iphone } = playwright.devices['iPhone 14'];
const browser = await playwright[engine].launch();
const context = await browser.newContext(iphone);
const page = await context.newPage();
const errors: string[] = [];
page.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e: Error) => errors.push(`uncaught: ${e.message}`));

const tab = (name: string) => page.locator('nav.tabs [role=tab]', { hasText: name }).first().click();
const square = (sq: string) => page.locator(`.board:visible [data-square=${sq}]`).first();
const move = async (from: string, to: string) => {
  await square(from).click();
  await square(to).click();
};
const moveCount = () => page.locator('.move-list:visible .move:not(.empty)').count();
const fitsScreen = async (screen: string) => {
  const [content, screenWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  check(content <= screenWidth + 1, `${screen}: fits the screen's width (${content} of ${screenWidth}px)`);
};

try {
  await page.goto(base);
  await page.waitForSelector('nav.tabs');
  console.log(`     ${engine} ${browser.version()}, ${iphone.viewport.width}×${iphone.viewport.height}`);

  // the board draws its pieces (sized with container units) and a move by touch-sized taps works
  const piece = await page.evaluate(() => {
    const el = document.querySelector('.board [data-square=e1] .piece');
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  });
  check(piece >= 20, `pieces are drawn at board size (${piece}px tall)`);
  await fitsScreen('Play');

  // the computer: its engine runs in a module worker
  await page.getByRole('radio', { name: 'vs Computer' }).click();
  await page.locator('section.setup select').first().selectOption('none');
  await page.locator('section.setup select').nth(1).selectOption('3');
  await page.getByRole('radio', { name: 'White' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await move('e2', 'e4');
  await page.waitForFunction(() => document.querySelectorAll('.move-list .move:not(.empty)').length >= 2, null, { timeout: 20_000 });
  check((await moveCount()) >= 2, 'the computer answers a move (engine worker)');

  // promotion picker
  await page.locator('section.pgn:visible textarea').last().fill('7k/P7/8/8/8/8/8/K7 w - - 0 1');
  await page.locator('section.pgn:visible').getByRole('button', { name: 'Load FEN' }).click();
  await move('a7', 'a8');
  check((await page.locator('.promotion-choice').count()) === 4, 'the promotion picker opens');
  await page.locator('.promotion-choice').nth(3).click();
  await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('section.pgn input')?.value ?? '').startsWith('N6k/'), null, { timeout: 5_000 });
  check(true, 'promotes to the chosen piece');

  // online lobby: the game socket
  await tab('Online');
  await page.getByText(/You are Guest \d+ \(guest\)/).waitFor({ timeout: 15_000 });
  check(true, 'joins the online lobby (WebSocket)');
  await fitsScreen('Online');

  // a bot
  await tab('Bots');
  await fitsScreen('Bots');
  await page.getByRole('button', { name: /^Play / }).first().click();
  await page.locator('.board:visible').waitFor();
  await move('e2', 'e4');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.move-list')].some(l => (l as HTMLElement).offsetParent && l.querySelectorAll('.move:not(.empty)').length >= 2),
    null,
    { timeout: 20_000 },
  );
  check(true, 'a bot answers a move');

  // puzzles
  await tab('Puzzles');
  await fitsScreen('Puzzles');
  await page.getByRole('button', { name: 'Show solution' }).click();
  await page.getByRole('button', { name: /Next puzzle/ }).waitFor({ timeout: 20_000 });
  check(true, 'a puzzle plays out its solution');

  // lessons
  await tab('Learn');
  await fitsScreen('Learn');
  await page.getByRole('button', { name: 'Straight lines' }).first().click();
  await page.locator('.board:visible').waitFor({ timeout: 10_000 });
  check(true, 'a lesson opens');

  // analysis board and its engine
  await tab('Analysis');
  await move('d2', 'd4');
  await page.getByText(/depth \d+/).first().waitFor({ timeout: 20_000 });
  check(true, 'the analysis engine reports a depth');
  await fitsScreen('Analysis');

  // sign-in dialog (a <dialog>)
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
  check(await page.locator('dialog[open]').isVisible(), 'the sign-in dialog opens');

  check(errors.length === 0, `no errors in the console${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  failures++;
  console.log('FAIL -', (err as Error).message.split('\n')[0]);
  if (errors.length) console.log('     console:', errors.join(' | '));
} finally {
  await page.screenshot({ path: 'smoke-iphone.png' }).catch(() => undefined);
  await browser.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { makePng, pieceCount, prepare, solveAll, startSolo, waitForEngine } from './helpers';

async function newPlayer(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await context.newPage();
  await prepare(page, { playerName: name });
  return page;
}

function seedOf(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __jigsaw: { engine: { model: { spec: { seed: number } } } } }).__jigsaw.engine.model.spec.seed);
}

test('daily puzzle: play, finish, streak and shareable result', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await prepare(page);
  await page.goto('/daily');
  const heading = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  const number = /#(\d+)/.exec(heading)![1]!;
  const pieces = Number(/(\d+) pieces/.exec((await page.locator('.daily__lede').textContent()) ?? '')![1]);

  await page.getByRole('button', { name: "Play today's puzzle" }).click();
  await page.waitForURL(/\/play\/daily-\d{4}-\d{2}-\d{2}$/);
  await waitForEngine(page);
  expect(await pieceCount(page)).toBe(pieces);
  const seed = await seedOf(page);

  await solveAll(page);
  const card = page.getByRole('region', { name: `Daily puzzle #${number} solved` });
  await expect(card).toBeVisible();
  await expect(card.getByText('1 day')).toBeVisible();

  await card.getByRole('button', { name: 'Share result' }).click();
  await expect(page.getByText('Result copied')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain(`Jigbee daily #${number}`);
  expect(text).toContain(`${pieces} pieces in `);
  expect(text).toMatch(/\/daily$/);

  await page.goto('/daily');
  await expect(page.getByText(/^Solved in \d+:\d\d$/)).toBeVisible();
  await expect(page.getByText(/Next puzzle in/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share result' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Daily puzzle #\d+.*Solved in/ })).toBeVisible();

  // Everyone gets the same cut: a second browser derives the same seed for today.
  const other = await newPlayer(page.context().browser()!, 'Other');
  await other.goto('/daily');
  await other.getByRole('button', { name: "Play today's puzzle" }).click();
  await waitForEngine(other);
  expect(await seedOf(other)).toBe(seed);
  await other.context().close();
});

test('challenge a friend: same cut, and the times are compared', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await prepare(page, { playerName: 'Alice' });
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const seed = await seedOf(page);
  const total = await pieceCount(page);
  await solveAll(page);
  await expect(page.getByRole('heading', { name: 'Puzzle complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Challenge a friend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Challenge a friend' });
  await expect(dialog.getByLabel('From')).toHaveValue('Alice');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  const link = await dialog.getByLabel('Puzzle link').inputValue();
  expect(link).toMatch(/\/s\/[a-z0-9]{10}$/);

  // The link preview names the challenger and their time.
  const preview = await (await page.request.get(link)).text();
  expect(preview).toMatch(/<title>Alice solved this jigsaw in \d+:\d\d\. Can you beat it\?<\/title>/);

  const bob = await newPlayer(browser, 'Bob');
  await bob.goto(link);
  await expect(bob.getByRole('heading', { name: /^Alice solved this in \d+:\d\d$/ })).toBeVisible();
  await bob.getByRole('button', { name: 'Accept the challenge' }).click();
  await bob.waitForURL(/\/play\/share-/);
  await waitForEngine(bob);
  expect(await pieceCount(bob)).toBe(total);
  expect(await seedOf(bob)).toBe(seed);
  await solveAll(bob);
  await expect(bob.getByRole('heading', { name: /^(You won the challenge!|Alice wins this time|It’s a tie!)$/ })).toBeVisible();
  await expect(bob.getByText('Alice’s time')).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Challenge back' })).toBeVisible();
  await bob.context().close();
});

test('photo gift: uploaded once, veiled until played, works after reload', async ({ page, browser }) => {
  await prepare(page, { playerName: 'Alice' });
  await page.goto('/puzzles');
  const png = await makePng(page, 1200, 800);
  await page.locator('input[type=file]').setInputFiles({ name: 'beach day.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('radio', { name: /^Easy/ }).click();
  await page.getByRole('button', { name: 'Send to a friend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send this puzzle' });
  await expect(dialog.getByText(/Your photo is uploaded/)).toBeVisible();
  await dialog.getByLabel('Message').fill('Remember this day?');
  const uploads: string[] = [];
  page.on('request', (r) => r.url().endsWith('/api/uploads') && uploads.push(r.url()));
  await dialog.getByRole('button', { name: 'Create link' }).click();
  const link = await dialog.getByLabel('Puzzle link').inputValue();
  expect(uploads).toHaveLength(1);

  const preview = await (await page.request.get(link)).text();
  expect(preview).toContain('<title>Alice sent you a jigsaw puzzle</title>');
  expect(preview).toMatch(/og:image" content="[^"]+\/og\/upload\/u[a-z0-9]{20}-veiled\.jpg"/);
  const ogImage = /og:image" content="([^"]+)"/.exec(preview)![1]!;
  expect((await page.request.get(ogImage)).headers()['content-type']).toBe('image/jpeg');

  const bo = await newPlayer(browser, 'Bo');
  await bo.goto(link);
  await expect(bo.getByRole('heading', { name: 'Alice sent you a jigsaw puzzle' })).toBeVisible();
  await expect(bo.getByText('Remember this day?')).toBeVisible();
  await expect(bo.getByText('Solve it to see the picture')).toBeVisible();
  await bo.getByRole('button', { name: 'Start puzzle' }).click();
  await waitForEngine(bo);
  expect(await pieceCount(bo)).toBeGreaterThanOrEqual(20);
  expect(await pieceCount(bo)).toBeLessThanOrEqual(30);
  await bo.reload();
  await waitForEngine(bo);
  await expect(bo.getByText('beach day')).toBeVisible();
  await bo.context().close();
});

test('expired or mistyped share links explain what happened', async ({ page }) => {
  await prepare(page);
  await page.goto('/s/abcdefghij');
  await expect(page.getByRole('heading', { name: 'This puzzle link has expired' })).toBeVisible();
  await expect(page.getByRole('link', { name: "Play today's puzzle" })).toBeVisible();
  await page.goto('/s/oops');
  await expect(page.getByRole('heading', { name: 'Could not open this puzzle' })).toBeVisible();
});

test('puzzle pages, category links and the sitemap', async ({ page }) => {
  await prepare(page);
  const res = await page.goto('/puzzle/great-wave');
  expect(res!.status()).toBe(200);
  await expect(page).toHaveTitle('The Great Wave off Kanagawa jigsaw puzzle — Jigbee');
  await expect(page.getByRole('heading', { level: 1, name: 'The Great Wave off Kanagawa' })).toBeVisible();
  await page.getByRole('button', { name: 'Play this puzzle' }).click();
  await expect(page.getByRole('dialog', { name: 'The Great Wave off Kanagawa' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Fine art' }).click();
  await expect(page.getByRole('button', { name: 'Fine art' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Autumn Avenue\./ })).toHaveCount(0);

  await page.goto('/credits');
  await page.getByRole('link', { name: 'The Starry Night' }).click();
  await expect(page).toHaveURL(/\/puzzle\/starry-night$/);

  expect((await page.goto('/puzzle/not-a-picture'))!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "This piece doesn't fit anywhere" })).toBeVisible();

  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/puzzle/great-wave</loc>');
});

test('usage counting: page views are reported and the owner can read totals', async ({ page }) => {
  await prepare(page);
  // Beacon bodies are not visible to Playwright, so check that the request is sent and later that it was counted.
  const beacon = page.waitForRequest((r) => r.url().endsWith('/api/events') && r.method() === 'POST');
  await page.goto('/multiplayer');
  await beacon;
  const created = await page.request.post('/api/rooms', {
    data: { image: { kind: 'catalog', id: 'great-wave' }, pieces: 24, rotation: false, capacity: 4, aspect: 1.5 },
  });
  expect(created.status()).toBe(201);

  await page.goto('/stats');
  await page.getByLabel('Access key').fill('not-the-right-key');
  await page.getByRole('button', { name: 'Show numbers' }).click();
  await expect(page.getByRole('alert')).toHaveText('That access key is not right.');
  await page.getByLabel('Access key').fill('e2e-stats-access-key');
  await page.getByRole('button', { name: 'Show numbers' }).click();
  const rooms = page.locator('.stats-tiles > div', { hasText: 'Rooms' }).locator('dd');
  await expect(rooms).not.toHaveText('0');
  await expect(page.getByRole('heading', { name: 'Popular pictures' })).toBeVisible();
  await expect(page.locator('.stats-list', { hasText: 'Popular pictures' }).getByText('The Great Wave off Kanagawa')).toBeVisible();
  await expect(page.locator('.stats-list', { hasText: 'Pages' }).getByText('/multiplayer', { exact: true })).toBeVisible();
});

test('photo puzzle maker page: choose a photo and start', async ({ page }) => {
  await prepare(page);
  await page.goto('/create');
  await expect(page).toHaveTitle('Make a jigsaw puzzle from your photo — Jigbee');
  await page.getByText('What happens to my photo?').click();
  await expect(page.getByText(/A puzzle you play alone stays on your device/)).toBeVisible();
  const png = await makePng(page, 1000, 750);
  await page.locator('input[type=file]').setInputFiles({ name: 'garden.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('dialog', { name: 'garden' })).toBeVisible();
  await page.getByRole('radio', { name: /^Easy/ }).click();
  await page.getByRole('button', { name: 'Start puzzle' }).click();
  await waitForEngine(page);
  expect(await pieceCount(page)).toBeLessThanOrEqual(30);
});

test('embedded puzzle plays inside another site and links back in a new tab', async ({ page, baseURL }) => {
  await prepare(page);
  await page.goto('/puzzle/golden-hour-lake');
  await page.getByText('Put this puzzle on your website').click();
  await page.getByRole('radio', { name: /^Easy/ }).click();
  const code = await page.getByLabel('Code to paste into your page').inputValue();
  expect(code).toMatch(/^<iframe src="http:\/\/localhost:\d+\/embed\/golden-hour-lake\?pieces=\d+" title="Golden Hour Lake jigsaw puzzle"/);

  // A blog on another origin pastes the code. It is served from a real loopback server:
  // Chrome refuses to let pages without a local address frame localhost.
  const blog = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>My blog</title><h1>Puzzle break</h1>${code}`);
  });
  await new Promise<void>((resolve) => blog.listen(0, '127.0.0.1', resolve));
  const blogUrl = `http://127.0.0.1:${(blog.address() as AddressInfo).port}/post`;
  await page.goto(blogUrl);
  const frame = page.frameLocator('iframe');
  const backLink = frame.getByRole('link', { name: 'Open Jigbee in a new tab' });
  await expect(backLink).toBeVisible({ timeout: 20_000 });
  await expect(backLink).toHaveAttribute('target', '_blank');
  await expect(backLink).toHaveAttribute('href', '/puzzle/golden-hour-lake');
  const inner = page.frames().find((f) => f.url().includes('/play/embed-golden-hour-lake-'))!;
  expect(inner).toBeTruthy();
  await inner.waitForFunction(() => !!(window as unknown as { __jigsaw?: unknown }).__jigsaw);
  const total = await inner.evaluate(() => (window as unknown as { __jigsaw: { engine: { model: { pieceCount: number } } } }).__jigsaw.engine.model.pieceCount);
  expect(total).toBeGreaterThanOrEqual(20);
  expect(total).toBeLessThanOrEqual(30);
  await frame.getByRole('button', { name: 'More options' }).click();
  await expect(frame.getByRole('menuitem', { name: 'More puzzles on Jigbee' })).toBeVisible();

  // Ordinary pages still refuse to be framed.
  const home = await page.request.get(`${baseURL}/`);
  expect(home.headers()['x-frame-options']).toBe('SAMEORIGIN');
  const embedded = await page.request.get(`${baseURL}/embed/golden-hour-lake`);
  expect(embedded.headers()['x-frame-options']).toBeUndefined();
  expect(embedded.headers()['content-security-policy']).toContain('frame-ancestors *');
  blog.close();
});

test('daily archive: play an earlier day; late solves do not count towards the streak', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const key = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    if (!localStorage.getItem('jigsaw.daily.v1')) {
      localStorage.setItem(
        'jigsaw.daily.v1',
        JSON.stringify({
          results: {
            [key(1)]: { ms: 310_000, moves: 60, pieces: 48, completedAt: Date.now(), late: true },
            [key(2)]: { ms: 320_000, moves: 61, pieces: 48, completedAt: Date.now() - 2 * 86_400_000 },
          },
        }),
      );
    }
  });
  await page.goto('/daily');
  const stat = (name: string) => page.locator('.daily__stats > div', { hasText: new RegExp(`^${name}`) }).locator('dd');
  await expect(stat('Played')).toHaveText('2');
  // Yesterday was solved late, so there is no current streak; the day before counts on its own.
  await expect(stat('Streak')).toHaveText('0');
  await expect(stat('Best streak')).toHaveText('1');
  await expect(page.getByRole('button', { name: /Solved late in 5:10$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Solved in 5:20$/ })).toBeVisible();

  const third = page.locator('.daily-archive__item').nth(2);
  const label = (await third.getAttribute('aria-label')) ?? '';
  const pieces = Number(/(\d+) pieces$/.exec(label)![1]);
  await third.click();
  await page.waitForURL(/\/play\/daily-\d{4}-\d{2}-\d{2}$/);
  await waitForEngine(page);
  expect(await pieceCount(page)).toBe(pieces);
  await expect(page.getByRole('heading', { level: 1, name: /^Daily puzzle #\d+$/ })).toBeVisible();
});

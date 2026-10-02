import { expect, test, type Page } from '@playwright/test';
import { debugPiece, dragPieceHome, grabPoint, lockedCount, prepare, waitForEngine } from './helpers';

type Group = { id: number; rot: number; x: number; y: number; locked: boolean; pieces: number[] };

const groupOf = (page: Page, piece: number) =>
  page.evaluate((p) => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { groupOf(p: number): Group } } } }).__jigsaw.engine;
    const g = e.model.groupOf(p);
    return { id: g.id, rot: g.rot, x: g.x, y: g.y, locked: g.locked, pieces: g.pieces };
  }, piece);

async function startWith(page: Page, image: string, opts: { rotation?: boolean } = {}) {
  await page.goto('/puzzles');
  await page.getByRole('button', { name: new RegExp(`^${image}\\.`) }).click();
  await page.getByRole('radio', { name: /^Easy/ }).click();
  if (opts.rotation) await page.getByRole('switch', { name: 'Rotating pieces' }).click();
  await page.getByRole('button', { name: 'Start puzzle' }).click();
  await page.waitForURL(/\/play\//);
  await waitForEngine(page);
}

test.beforeEach(async ({ page }) => {
  await prepare(page, { playerName: 'Sam' });
});

test('rotation puzzles: pieces must be turned upright before they fit', async ({ page }) => {
  await startWith(page, 'Pansy Garden', { rotation: true });
  // Find a piece that starts rotated.
  const piece = await page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { pieceCount: number; groupOf(p: number): Group }; debugGrabPoint(p: number): unknown } } }).__jigsaw.engine;
    for (let p = 0; p < e.model.pieceCount; p++) if (e.model.groupOf(p).rot !== 0 && e.debugGrabPoint(p)) return p;
    return -1;
  });
  expect(piece).toBeGreaterThanOrEqual(0);

  // Dragged home while still rotated: it does not lock.
  await dragPieceHome(page, piece);
  expect((await groupOf(page, piece)).locked).toBe(false);

  // Right-click turns it 90° at a time.
  const before = (await groupOf(page, piece)).rot;
  const pt = await grabPoint(page, piece);
  await page.mouse.click(pt![0], pt![1], { button: 'right' });
  await expect.poll(async () => (await groupOf(page, piece)).rot).toBe((before + 1) % 4);

  // Double-click keeps turning it. Once upright it sits on its home spot, so the turn itself snaps it in.
  while ((await groupOf(page, piece)).rot !== 0) {
    const p = await grabPoint(page, piece);
    await page.mouse.dblclick(p![0], p![1]);
    await page.waitForTimeout(120);
  }
  if (!(await groupOf(page, piece)).locked) await dragPieceHome(page, piece);
  await expect.poll(async () => (await groupOf(page, piece)).locked).toBe(true);

  // R rotates the keyboard-selected piece.
  await page.locator('canvas.game__canvas').focus();
  await page.keyboard.press('n');
  const sel = await page.evaluate(() => (window as unknown as { __jigsaw: { engine: { selected: number } } }).__jigsaw.engine.selected);
  const rot0 = await page.evaluate((id) => (window as unknown as { __jigsaw: { engine: { model: { groups: Map<number, Group> } } } }).__jigsaw.engine.model.groups.get(id)!.rot, sel);
  await page.keyboard.press('r');
  await expect
    .poll(() => page.evaluate((id) => (window as unknown as { __jigsaw: { engine: { model: { groups: Map<number, Group> } } } }).__jigsaw.engine.model.groups.get(id)?.rot, sel))
    .toBe((rot0 + 1) % 4);
});

test('shuffle re-scatters loose pieces and leaves placed ones alone', async ({ page }) => {
  await startWith(page, 'Golden Hour Lake');
  await dragPieceHome(page, 0);
  await expect.poll(() => lockedCount(page)).toBe(1);
  const before = await groupOf(page, 5);
  await page.getByRole('button', { name: 'Shuffle loose pieces' }).click();
  await expect.poll(async () => {
    const g = await groupOf(page, 5);
    return Math.hypot(g.x - before.x, g.y - before.y);
  }).toBeGreaterThan(1);
  expect((await debugPiece(page, 0)).locked).toBe(true);
});

test('restart asks for confirmation and reshuffles from zero', async ({ page }) => {
  await startWith(page, 'Golden Hour Lake');
  await dragPieceHome(page, 0);
  await expect.poll(() => lockedCount(page)).toBe(1);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'Restart puzzle' }).click();
  await expect(page.getByRole('heading', { name: 'Restart this puzzle?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await lockedCount(page)).toBe(1);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'Restart puzzle' }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.waitForFunction(() => {
    const e = (window as unknown as { __jigsaw?: { engine: { model: { groups: Map<number, { locked: boolean }> } } } }).__jigsaw?.engine;
    return !!e && ![...e.model.groups.values()].some((g) => g.locked);
  });
  await expect(page.getByRole('timer')).toHaveText('0:00');
});

test('home lists puzzles in progress; remove with undo', async ({ page }) => {
  await startWith(page, 'Golden Hour Lake');
  await dragPieceHome(page, 0);
  await page.waitForTimeout(600);
  await page.goto('/');
  const cont = page.getByRole('button', { name: /^Continue Golden Hour Lake/ });
  await expect(cont).toBeVisible();
  await page.getByRole('button', { name: 'Remove Golden Hour Lake' }).click();
  await expect(cont).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cont).toBeVisible();
  await cont.click();
  await waitForEngine(page);
  expect(await lockedCount(page)).toBe(1);
});

test('a full room shows a clear message to the extra player', async ({ page, browser }) => {
  await page.goto('/puzzles?mode=room');
  await page.getByRole('button', { name: /^Orchid Bloom\./ }).click();
  await page.getByRole('radio', { name: /^Easy/ }).click();
  const slider = page.getByRole('slider', { name: 'Maximum players' });
  await slider.focus();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\//);
  await waitForEngine(page);
  const code = page.url().split('/room/')[1]!;

  const second = await (await browser.newContext()).newPage();
  await second.addInitScript(() => {
    localStorage.setItem('jigsaw.settings.v1', JSON.stringify({ state: { sound: false, playerName: 'Two' }, version: 1 }));
  });
  await second.goto(`/room/${code}`);
  await expect(second.locator('canvas.game__canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '2 players online. Show players' })).toBeVisible();

  const third = await (await browser.newContext()).newPage();
  await third.addInitScript(() => {
    localStorage.setItem('jigsaw.settings.v1', JSON.stringify({ state: { sound: false, playerName: 'Three' }, version: 1 }));
  });
  await third.goto(`/room/${code}`);
  await expect(third.getByRole('heading', { name: 'This room is full' })).toBeVisible();
  // From the lobby the code check says so too.
  await third.goto('/multiplayer');
  await third.getByLabel('Room code').fill(code);
  await third.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(third.getByText(/That room is full/)).toBeVisible();

  // The host raises the limit; now the third player can join.
  await page.getByRole('button', { name: /players online/ }).click();
  const cap = page.getByRole('slider', { name: 'Maximum players' });
  await cap.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Save room size' }).click();
  await page.keyboard.press('Escape');
  await third.goto(`/room/${code}`);
  await expect(third.locator('canvas.game__canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '3 players online. Show players' })).toBeVisible();
});

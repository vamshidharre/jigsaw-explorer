import { expect, test } from '@playwright/test';
import { debugPiece, dragBy, dragPieceHome, grabPoint, lockedCount, pieceCount, prepare, startSolo, waitForEngine } from './helpers';

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test('home page renders without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Piece it together');
  await page.getByRole('link', { name: 'Puzzles' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a puzzle' })).toBeVisible();
  await page.getByRole('button', { name: 'Fine art' }).click();
  await expect(page.getByRole('button', { name: /^The Starry Night\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Autumn Avenue\./ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('difficulty changes the real number of pieces', async ({ page }) => {
  await startSolo(page, 'Autumn Avenue', 'Easy');
  const easy = await pieceCount(page);
  await startSolo(page, 'Autumn Avenue', 'Hard');
  const hard = await pieceCount(page);
  expect(easy).toBeGreaterThanOrEqual(20);
  expect(easy).toBeLessThanOrEqual(30);
  expect(hard).toBeGreaterThan(120);
  await expect(page.getByText(`${hard} pieces`)).toBeVisible();
});

test('drag a piece onto the board: it snaps, locks and progress updates', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  await expect(page.getByRole('progressbar', { name: 'Puzzle progress' })).toHaveAttribute('aria-valuenow', '0');
  await dragPieceHome(page, 0, [4, -3]);
  await expect.poll(() => debugPiece(page, 0).then((d) => d.locked)).toBe(true);
  const after = await debugPiece(page, 0);
  // Snapped exactly onto its solved position.
  expect(Math.abs(after.screen[0] - after.home[0])).toBeLessThan(0.5);
  expect(Math.abs(after.screen[1] - after.home[1])).toBeLessThan(0.5);
  await expect(page.getByRole('progressbar', { name: 'Puzzle progress' })).not.toHaveAttribute('aria-valuenow', '0');
  // Locked pieces can no longer be dragged: pressing on one pans the table instead,
  // so the piece stays exactly on its solved spot relative to the board.
  const before = await debugPiece(page, 0);
  await dragBy(page, before.screen, 120, 80);
  const still = await debugPiece(page, 0);
  expect(still.locked).toBe(true);
  expect(Math.abs(still.screen[0] - still.home[0])).toBeLessThan(0.5);
  expect(Math.abs(still.screen[1] - still.home[1])).toBeLessThan(0.5);
  expect(Math.round(still.home[0] - before.home[0])).toBe(120);
});

test('a piece dropped far from its place does not snap', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const d = await debugPiece(page, 5);
  const p = await grabPoint(page, 5);
  await dragBy(page, p!, d.home[0] - d.screen[0] + 60, d.home[1] - d.screen[1] + 45);
  expect((await debugPiece(page, 5)).locked).toBe(false);
});

test('neighbouring pieces join off the board and move as a group', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  // Move piece 0 to an empty area of the table, then bring piece 1 next to it.
  const a0 = await debugPiece(page, 0);
  const p0 = await grabPoint(page, 0);
  const homeDx = a0.home[0] - a0.screen[0];
  const homeDy = a0.home[1] - a0.screen[1];
  await dragBy(page, p0!, homeDx + 260, homeDy - 230);
  const placed0 = await debugPiece(page, 0);
  expect(placed0.locked).toBe(false);
  // Now drag piece 1 so it sits exactly where it belongs relative to piece 0.
  const a1 = await debugPiece(page, 1);
  const p1 = await grabPoint(page, 1);
  const rel = [a1.home[0] - a0.home[0], a1.home[1] - a0.home[1]];
  await dragBy(page, p1!, placed0.screen[0] + rel[0] - a1.screen[0] + 3, placed0.screen[1] + rel[1] - a1.screen[1] - 2);
  await expect.poll(async () => (await debugPiece(page, 1)).group).toBe((await debugPiece(page, 0)).group);
  // Dragging piece 0 now moves piece 1 too.
  const g0 = await debugPiece(page, 0);
  const g1 = await debugPiece(page, 1);
  const grab = await grabPoint(page, 0);
  await dragBy(page, grab!, -40, 30);
  const m0 = await debugPiece(page, 0);
  const m1 = await debugPiece(page, 1);
  expect(Math.round(m0.screen[0] - g0.screen[0])).toBe(Math.round(m1.screen[0] - g1.screen[0]));
  expect(Math.round(m0.screen[1] - g0.screen[1])).toBe(Math.round(m1.screen[1] - g1.screen[1]));
});

test('complete a puzzle, see the summary, and keep progress after reload', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const total = await pieceCount(page);
  const half = Math.floor(total / 2);
  for (let p = 0; p < half; p++) await dragPieceHome(page, p);
  await expect.poll(() => lockedCount(page)).toBe(half);
  // Timer started with the first move.
  await expect(page.getByRole('timer')).not.toHaveText('0:00', { timeout: 5000 });

  // Reload: progress is restored from IndexedDB.
  await page.waitForTimeout(700);
  await page.reload();
  await waitForEngine(page);
  expect(await lockedCount(page)).toBe(half);

  for (let p = half; p < total; p++) await dragPieceHome(page, p);
  await expect(page.getByRole('heading', { name: 'Puzzle complete' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Puzzle progress' })).toHaveAttribute('aria-valuenow', '100');
  // The timer stops on completion.
  const t1 = await page.getByRole('timer').textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByRole('timer').textContent()).toBe(t1);
});

test('zoom controls, fit, edge filter and pause work', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Medium');
  const zoomLabel = page.getByRole('button', { name: 'Fit everything in view' });
  await expect(zoomLabel).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomLabel).not.toHaveText('100%');
  await zoomLabel.click();
  await expect(zoomLabel).toHaveText('100%');
  // Mouse wheel zoom.
  await page.mouse.move(683, 430);
  await page.mouse.wheel(0, -300);
  await expect(zoomLabel).not.toHaveText('100%');
  await page.keyboard.press('0');
  await expect(zoomLabel).toHaveText('100%');

  // Edge filter hides interior pieces: an interior piece can no longer be picked.
  const interior = 9; // grid is at least 8 columns wide at Medium; piece 9 is not on an edge
  expect(await grabPoint(page, interior)).not.toBeNull();
  await page.getByRole('button', { name: 'Show edge pieces only' }).click();
  expect(await grabPoint(page, interior)).toBeNull();
  await page.getByRole('button', { name: 'Show all pieces' }).click();
  expect(await grabPoint(page, interior)).not.toBeNull();

  // Pause blocks interaction and shows the overlay.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  // While paused, pieces cannot be picked up.
  await page.locator('.pause-overlay').getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toHaveCount(0);
  await page.keyboard.press('p');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.pause-overlay').getByRole('button', { name: 'Resume' }).click();
});

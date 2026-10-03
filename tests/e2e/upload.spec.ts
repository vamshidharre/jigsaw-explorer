import { expect, test } from '@playwright/test';
import { dragPieceHome, lockedCount, makePng, pieceCount, prepare, waitForEngine } from './helpers';

test.beforeEach(async ({ page }) => {
  await prepare(page, { playerName: 'Uploader' });
});

test('upload a photo and play it solo; it survives a reload', async ({ page }) => {
  await page.goto('/puzzles');
  const png = await makePng(page, 1200, 800);
  await page.locator('input[type=file]').setInputFiles({ name: 'my_holiday-photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('dialog', { name: 'my holiday photo' })).toBeVisible();
  await page.getByRole('radio', { name: /^Easy/ }).click();
  await page.getByRole('button', { name: 'Start puzzle' }).click();
  await page.waitForURL(/\/play\//);
  await waitForEngine(page);
  expect(await pieceCount(page)).toBeGreaterThan(15);
  await dragPieceHome(page, 0);
  await expect.poll(() => lockedCount(page)).toBe(1);
  await page.waitForTimeout(600);
  await page.reload();
  await waitForEngine(page);
  expect(await lockedCount(page)).toBe(1);
  // The saved puzzle is listed on the home page.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Continue my holiday photo/ })).toBeVisible();
});

test('rejects files that are not images or are too small', async ({ page }) => {
  await page.goto('/puzzles');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('definitely not an image') });
  await expect(page.getByText(/could not be read as an image/)).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByText('Please choose an image file (JPG, PNG, WebP or GIF).')).toBeVisible();
  const tiny = await makePng(page, 120, 90);
  await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tiny });
  await expect(page.getByText(/That image is too small \(120×90\)/)).toBeVisible();
});

test('a custom photo can be shared in a multiplayer room', async ({ page, browser }) => {
  await page.goto('/puzzles?mode=room');
  const png = await makePng(page, 1000, 1000);
  await page.locator('input[type=file]').setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('radio', { name: /^Easy/ }).click();
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  await waitForEngine(page);
  const code = page.url().split('/room/')[1]!;
  const ctx = await browser.newContext();
  const friend = await ctx.newPage();
  await friend.addInitScript(() => {
    localStorage.setItem('jigsaw.e2e', '1');
    localStorage.setItem('jigsaw.settings.v1', JSON.stringify({ state: { sound: false, playerName: 'Friend' }, version: 1 }));
  });
  await friend.goto(`/room/${code}`);
  await waitForEngine(friend);
  await expect(friend.getByRole('heading', { name: 'Custom puzzle' })).toBeVisible();
  expect(await pieceCount(friend)).toBe(await pieceCount(page));
  await ctx.close();
});

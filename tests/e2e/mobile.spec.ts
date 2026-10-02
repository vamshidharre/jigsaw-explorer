import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { debugPiece, grabPoint, prepare, startSolo } from './helpers';

async function touch(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function touchDrag(cdp: CDPSession, from: [number, number], to: [number, number], steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, id: 1 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __jigsaw: { engine: { camera: { zoom: number } } } }).__jigsaw.engine.camera.zoom);
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test('touch: drag a piece into place, pinch to zoom, double-tap to zoom', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const cdp = await touch(page);

  // Drag with a finger.
  const from = await grabPoint(page, 0);
  expect(from).not.toBeNull();
  const d = await debugPiece(page, 0);
  await touchDrag(cdp, from!, [from![0] + d.home[0] - d.screen[0] + 2, from![1] + d.home[1] - d.screen[1] - 2]);
  await expect.poll(() => debugPiece(page, 0).then((x) => x.locked)).toBe(true);

  // Pinch out with two fingers zooms in.
  const z0 = await zoom(page);
  const c = [200, 420];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: c[0] - 30, y: c[1], id: 1 },
      { x: c[0] + 30, y: c[1], id: 2 },
    ],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: c[0] - 30 - i * 10, y: c[1], id: 1 },
        { x: c[0] + 30 + i * 10, y: c[1], id: 2 },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const z1 = await zoom(page);
  expect(z1).toBeGreaterThan(z0 * 1.5);

  // One finger on empty table pans.
  const before = await debugPiece(page, 0);
  await touchDrag(cdp, [380, 120], [300, 200]);
  const after = await debugPiece(page, 0);
  expect(Math.round(after.screen[0] - before.screen[0])).toBe(-80);

  // Double-tap on empty table zooms in.
  const empty = await page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { hitTest(x: number, y: number, t: string): number | null } } }).__jigsaw.engine;
    for (let y = 200; y < 600; y += 20) for (let x = 20; x < 380; x += 20) if (e.hitTest(x, y, 'touch') === null) return [x, y];
    return null;
  });
  expect(empty).not.toBeNull();
  const zBeforeTap = await zoom(page);
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: empty![0], y: empty![1], id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
  }
  expect(await zoom(page)).toBeCloseTo(zBeforeTap * 1.6, 1);

  // Fit button resets the view.
  await page.getByRole('button', { name: 'Fit board' }).click();
  await page.waitForTimeout(500);
  expect(await zoom(page)).toBeLessThan(z1);
});

test('mobile layout keeps controls reachable and readable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a puzzle' })).toBeVisible();
  // No horizontal overflow on any main page.
  for (const path of ['/', '/puzzles', '/multiplayer', '/credits']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  // Toolbar buttons are touch-sized.
  const boxes = await page.getByRole('toolbar', { name: 'Puzzle tools' }).getByRole('button').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getBoundingClientRect().height),
  );
  expect(boxes.length).toBeGreaterThan(4);
  for (const h of boxes) expect(h).toBeGreaterThanOrEqual(40);
  // Toolbar fits the screen width.
  const tb = await page.getByRole('toolbar', { name: 'Puzzle tools' }).boundingBox();
  expect(tb!.x).toBeGreaterThanOrEqual(0);
  expect(tb!.x + tb!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

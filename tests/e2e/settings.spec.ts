import { expect, test, type Page } from '@playwright/test';
import { debugPiece, dragBy, grabPoint, prepare, startSolo, waitForEngine } from './helpers';

type EngineDebug = {
  atlasStyle: { outline: string; bevel: boolean };
  render: { guide: boolean; guideOpacity: number; shadows: boolean; edgesOnly: boolean };
  snapStrength: string;
  reducedMotion: boolean;
  autoPan: boolean;
  tableFill: string;
};

const engineSettings = (page: Page) =>
  page.evaluate(() => (window as unknown as { __jigsaw: { engine: { debugSettings(): EngineDebug } } }).__jigsaw.engine.debugSettings());

async function openSettings(page: Page, tab: 'Gameplay' | 'Appearance' | 'Accessibility') {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('tab', { name: tab }).click();
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Sum of RGBA values in a screen rectangle of the puzzle canvas. */
async function regionSum(page: Page, x: number, y: number, w: number, h: number): Promise<number[]> {
  return page.evaluate(
    ([x, y, w, h]) => {
      const c = document.querySelector('canvas.game__canvas') as HTMLCanvasElement;
      const dpr = c.width / c.clientWidth;
      const d = c.getContext('2d')!.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr)).data;
      const s = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 4; k++) s[k]! += d[i + k]!;
      return s;
    },
    [x, y, w, h],
  );
}

async function boardCenter(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { spec: { width: number; height: number } }; camera: { toScreen(x: number, y: number): [number, number] } } } }).__jigsaw.engine;
    return e.camera.toScreen(e.model.spec.width / 2, e.model.spec.height / 2);
  });
}

async function frame(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test('snapping strength changes how close a piece must be', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const pieceScreen = await page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { pieceWidth: number; pieceHeight: number }; camera: { zoom: number } } } }).__jigsaw.engine;
    return Math.min(e.model.pieceWidth, e.model.pieceHeight) * e.camera.zoom;
  });
  const offset = pieceScreen * 0.27; // between "Precise" (0.13) and "Forgiving" (0.34)

  await openSettings(page, 'Gameplay');
  await page.getByRole('radio', { name: 'Precise' }).click();
  await closeSettings(page);
  expect((await engineSettings(page)).snapStrength).toBe('gentle');
  let d = await debugPiece(page, 0);
  await dragBy(page, (await grabPoint(page, 0))!, d.home[0] - d.screen[0] + offset, d.home[1] - d.screen[1]);
  expect((await debugPiece(page, 0)).locked).toBe(false);

  await openSettings(page, 'Gameplay');
  await page.getByRole('radio', { name: 'Forgiving' }).click();
  await closeSettings(page);
  d = await debugPiece(page, 1);
  await dragBy(page, (await grabPoint(page, 1))!, d.home[0] - d.screen[0] + offset, d.home[1] - d.screen[1]);
  await expect.poll(() => debugPiece(page, 1).then((x) => x.locked)).toBe(true);

  // Persisted across reloads.
  await page.reload();
  await waitForEngine(page);
  expect((await engineSettings(page)).snapStrength).toBe('strong');
});

test('guide picture toggle and opacity change what is drawn on the board', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const [cx, cy] = await boardCenter(page);
  const withGuide = await regionSum(page, cx - 20, cy - 20, 40, 40);
  await page.keyboard.press('g');
  await frame(page);
  const without = await regionSum(page, cx - 20, cy - 20, 40, 40);
  expect(withGuide).not.toEqual(without);
  expect((await engineSettings(page)).render.guide).toBe(false);
  await page.keyboard.press('g');

  await openSettings(page, 'Gameplay');
  const slider = page.getByRole('slider', { name: 'Guide opacity' });
  await slider.focus();
  await page.keyboard.press('End');
  await closeSettings(page);
  await frame(page);
  const strong = await regionSum(page, cx - 20, cy - 20, 40, 40);
  expect((await engineSettings(page)).render.guideOpacity).toBeCloseTo(0.7, 2);
  // A more opaque guide is clearly brighter (the sunset image is bright in the middle).
  expect(strong[0]! + strong[1]! + strong[2]!).toBeGreaterThan(withGuide[0]! + withGuide[1]! + withGuide[2]!);
});

test('timer and progress can be hidden', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Puzzle progress' })).toBeVisible();
  await openSettings(page, 'Gameplay');
  await page.getByLabel('Show timer').click();
  await page.getByLabel('Show progress').click();
  await closeSettings(page);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Puzzle progress' })).toHaveCount(0);
  await page.reload();
  await waitForEngine(page);
  await expect(page.getByRole('timer')).toHaveCount(0);
});

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const seconds = async (page: Page) => {
  const [m, s] = (await page.getByRole('timer').textContent())!.split(':').map(Number);
  return m! * 60 + s!;
};

test('pause when switching tabs stops the clock only when enabled', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  await dragBy(page, (await grabPoint(page, 3))!, 30, 10);
  await page.waitForTimeout(1100);
  const t0 = await seconds(page);
  await setHidden(page, true);
  await page.waitForTimeout(2600);
  await setHidden(page, false);
  const t1 = await seconds(page);
  expect(t1 - t0).toBeLessThanOrEqual(1);

  await openSettings(page, 'Gameplay');
  await page.getByLabel('Pause when I switch tabs').click();
  await closeSettings(page);
  const t2 = await seconds(page);
  await setHidden(page, true);
  await page.waitForTimeout(2600);
  await setHidden(page, false);
  const t3 = await seconds(page);
  expect(t3 - t2).toBeGreaterThanOrEqual(2);
});

test('edge scrolling pans while dragging only when enabled', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const pan = () => page.evaluate(() => (window as unknown as { __jigsaw: { engine: { camera: { panX: number } } } }).__jigsaw.engine.camera.panX);
  const holdAtEdge = async (piece: number) => {
    const p = (await grabPoint(page, piece))!;
    await page.mouse.move(p[0], p[1]);
    await page.mouse.down();
    await page.mouse.move(page.viewportSize()!.width - 6, p[1], { steps: 6 });
    const before = await pan();
    await page.waitForTimeout(600);
    const after = await pan();
    await page.mouse.up();
    return after - before;
  };
  expect(await holdAtEdge(2)).toBeLessThan(-50);
  await page.keyboard.press('0');
  await openSettings(page, 'Gameplay');
  await page.getByLabel('Scroll at screen edges').click();
  await closeSettings(page);
  expect(await holdAtEdge(3)).toBe(0);
});

test('sound effects and volume control real audio playback', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __audioNodes: number; AudioContext: typeof AudioContext };
    w.__audioNodes = 0;
    const Orig = window.AudioContext;
    w.AudioContext = class extends Orig {
      createBufferSource() {
        w.__audioNodes++;
        return super.createBufferSource();
      }
      createOscillator() {
        w.__audioNodes++;
        return super.createOscillator();
      }
    } as typeof AudioContext;
  });
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  const nodes = () => page.evaluate(() => (window as unknown as { __audioNodes: number }).__audioNodes);
  // Sound is off in the test defaults: picking up a piece makes no sound.
  await dragBy(page, (await grabPoint(page, 0))!, 20, 0);
  expect(await nodes()).toBe(0);
  await openSettings(page, 'Gameplay');
  await page.getByLabel('Sound effects').click();
  await closeSettings(page);
  const afterToggle = await nodes(); // the toggle plays a preview sound
  expect(afterToggle).toBeGreaterThan(0);
  await dragBy(page, (await grabPoint(page, 1))!, 20, 0);
  expect(await nodes()).toBeGreaterThan(afterToggle);
  // Volume 0 is silent.
  await openSettings(page, 'Gameplay');
  await page.getByRole('slider', { name: 'Volume' }).focus();
  await page.keyboard.press('Home');
  await closeSettings(page);
  const muted = await nodes();
  await dragBy(page, (await grabPoint(page, 2))!, 20, 0);
  expect(await nodes()).toBe(muted);
});

test('appearance settings: theme, table, outlines, bevel, shadows and density', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  await openSettings(page, 'Appearance');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const fillBefore = (await engineSettings(page)).tableFill;
  await page.getByRole('radio', { name: 'Green felt' }).click();
  await expect(page.locator('.game')).toHaveClass(/table-felt/);
  expect((await engineSettings(page)).tableFill).not.toBe(fillBefore);

  await page.getByRole('radio', { name: 'Bold' }).click();
  await page.getByLabel('Bevelled edges').click();
  await expect.poll(async () => (await engineSettings(page)).atlasStyle).toEqual({ outline: 'bold', bevel: false });

  // Shadows: the area around a loose piece gets darker pixels with shadows on.
  const p = (await debugPiece(page, 4)).screen;
  const box: [number, number, number, number] = [p[0] - 60, p[1] - 60, 120, 120];
  await closeSettings(page);
  await frame(page);
  const withShadow = await regionSum(page, ...box);
  await openSettings(page, 'Appearance');
  await page.getByLabel('Piece shadows').click();
  await closeSettings(page);
  await frame(page);
  const noShadow = await regionSum(page, ...box);
  expect((await engineSettings(page)).render.shadows).toBe(false);
  expect(withShadow[3]).toBeGreaterThan(noShadow[3]!);

  // Density changes control sizes.
  const settingsBtn = page.getByRole('button', { name: 'Settings' }).first();
  const comfortable = (await settingsBtn.boundingBox())!.height;
  await openSettings(page, 'Appearance');
  await page.getByRole('radio', { name: 'Compact' }).click();
  await closeSettings(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect((await settingsBtn.boundingBox())!.height).toBeLessThan(comfortable);

  // Everything persists after a reload.
  await page.reload();
  await waitForEngine(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.game')).toHaveClass(/table-felt/);
  expect(await engineSettings(page)).toMatchObject({ atlasStyle: { outline: 'bold', bevel: false }, render: { shadows: false } });
});

test('accessibility: reduced motion, announcements and keyboard play', async ({ page }) => {
  await startSolo(page, 'Golden Hour Lake', 'Easy');
  await openSettings(page, 'Accessibility');
  await page.getByRole('radio', { name: 'Reduced' }).click();
  await closeSettings(page);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect((await engineSettings(page)).reducedMotion).toBe(true);

  // Keyboard: select a piece with N, pick it up with Enter, move with arrows, drop with Enter.
  const live = page.locator('[aria-live="polite"].visually-hidden').last();
  await page.locator('canvas.game__canvas').focus();
  await page.keyboard.press('n');
  await expect(live).toContainText('selected');
  const before = await page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { groups: Map<number, { x: number; y: number }> } } } }).__jigsaw.engine;
    return Array.from(e.model.groups.values()).map((g) => [g.x, g.y]);
  });
  await page.keyboard.press('Enter');
  await expect(live).toContainText('picked up');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  await expect(live).toContainText('dropped');
  const after = await page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { groups: Map<number, { x: number; y: number }> } } } }).__jigsaw.engine;
    return Array.from(e.model.groups.values()).map((g) => [g.x, g.y]);
  });
  expect(after).not.toEqual(before);

  // Announcements on snap are spoken only when enabled. (Keyboard selection moved the camera; fit everything again.)
  await page.keyboard.press('0');
  await page.waitForTimeout(100);
  const d = await debugPiece(page, 0);
  await dragBy(page, (await grabPoint(page, 0))!, d.home[0] - d.screen[0], d.home[1] - d.screen[1]);
  await expect(live).toContainText('Connected');
  await openSettings(page, 'Accessibility');
  await page.getByLabel('Screen reader announcements').click();
  await closeSettings(page);
  await page.evaluate(() => {
    const el = document.querySelectorAll('[aria-live="polite"].visually-hidden');
    el[el.length - 1]!.textContent = '';
  });
  const d1 = await debugPiece(page, 1);
  await dragBy(page, (await grabPoint(page, 1))!, d1.home[0] - d1.screen[0], d1.home[1] - d1.screen[1]);
  await expect.poll(() => debugPiece(page, 1).then((x) => x.locked)).toBe(true);
  await page.waitForTimeout(200);
  await expect(live).toHaveText('');
});

test('reset to defaults restores every preference except the player name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await page.getByRole('tab', { name: 'Gameplay' }).click();
  await page.getByLabel('Your name in multiplayer rooms').fill('Morgan');
  await page.getByLabel('Your name in multiplayer rooms').press('Enter');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  await expect(page.getByLabel('Your name in multiplayer rooms')).toHaveValue('Morgan');
});

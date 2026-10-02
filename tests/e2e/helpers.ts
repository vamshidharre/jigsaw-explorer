import { expect, type Page } from '@playwright/test';

type Debug = {
  screen: [number, number];
  home: [number, number];
  group: number;
  locked: boolean;
};

/** Enables the engine test hook and sets predictable preferences before the app loads. */
export async function prepare(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript((s) => {
    localStorage.setItem('jigsaw.e2e', '1');
    if (!localStorage.getItem('jigsaw.settings.v1')) {
      localStorage.setItem('jigsaw.settings.v1', JSON.stringify({ state: { sound: false, ...s }, version: 1 }));
    }
  }, settings);
}

export async function waitForEngine(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __jigsaw?: unknown }).__jigsaw, null, { timeout: 30_000 });
  // Let the initial camera settle.
  await page.waitForTimeout(300);
}

export async function startSolo(page: Page, imageTitle: string, preset: 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master' = 'Easy') {
  await page.goto('/puzzles');
  await page.getByRole('button', { name: new RegExp(`^${imageTitle}\\.`) }).click();
  await page.getByRole('radio', { name: new RegExp(`^${preset}`) }).click();
  await page.getByRole('button', { name: 'Start puzzle' }).click();
  await page.waitForURL(/\/play\//);
  await waitForEngine(page);
}

export async function pieceCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { pieceCount: number } } } }).__jigsaw.engine;
    return e.model.pieceCount;
  });
}

export async function debugPiece(page: Page, piece: number): Promise<Debug> {
  return page.evaluate((p) => {
    const e = (window as unknown as { __jigsaw: { engine: { debugPiece(p: number): Debug } } }).__jigsaw.engine;
    return e.debugPiece(p);
  }, piece);
}

export async function grabPoint(page: Page, piece: number): Promise<[number, number] | null> {
  return page.evaluate((p) => {
    const e = (window as unknown as { __jigsaw: { engine: { debugGrabPoint(p: number): [number, number] | null } } }).__jigsaw.engine;
    return e.debugGrabPoint(p);
  }, piece);
}

/** Drags a piece with the real mouse so that the grabbed point moves by (dx, dy). */
export async function dragBy(page: Page, from: [number, number], dx: number, dy: number, steps = 8) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + dx, from[1] + dy, { steps });
  await page.mouse.up();
}

/** Drags a piece so that its centre lands `offset` screen pixels from its solved position. */
export async function dragPieceHome(page: Page, piece: number, offset: [number, number] = [3, -2]) {
  const point = await grabPoint(page, piece);
  expect(point, `piece ${piece} should be reachable`).not.toBeNull();
  const d = await debugPiece(page, piece);
  const dx = d.home[0] - d.screen[0] + offset[0];
  const dy = d.home[1] - d.screen[1] + offset[1];
  await dragBy(page, point!, dx, dy);
}

export async function lockedCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const e = (window as unknown as { __jigsaw: { engine: { model: { groups: Map<number, { locked: boolean; pieces: number[] }> } } } }).__jigsaw.engine;
    let n = 0;
    for (const g of e.model.groups.values()) if (g.locked) n += g.pieces.length;
    return n;
  });
}

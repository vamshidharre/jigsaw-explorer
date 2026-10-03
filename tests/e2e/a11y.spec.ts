import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { prepare, startSolo, waitForEngine } from './helpers';

async function audit(page: Page, label: string, include?: string) {
  // Colour contrast is only meaningful once open/close animations have settled.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
  expect(summary, `${label} accessibility violations`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test.beforeEach(async ({ page }) => {
      await prepare(page, { playerName: 'Ari' });
    });

    test('site pages', async ({ page }) => {
      for (const path of ['/', '/puzzles', '/multiplayer', '/daily', '/puzzle/great-wave', '/stats', '/credits', '/s/abcdefghij', '/nope']) {
        await page.goto(path);
        await page.waitForTimeout(300);
        await audit(page, path);
      }
    });

    test('setup dialog and settings', async ({ page }) => {
      await page.goto('/puzzles');
      await page.getByRole('button', { name: /^The Scream\./ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('radio', { name: /^Custom/ }).click();
      await audit(page, 'setup dialog', '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings' }).click();
      for (const tab of ['Gameplay', 'Appearance', 'Accessibility']) {
        await page.getByRole('tab', { name: tab }).click();
        await audit(page, `settings ${tab}`, '[role="dialog"]');
      }
    });

    test('share links: dialog and landing page', async ({ page }) => {
      await page.goto('/puzzles');
      await page.getByRole('button', { name: /^The Scream\./ }).click();
      await page.getByRole('button', { name: 'Send to a friend' }).click();
      await audit(page, 'share form', '[role="dialog"]:has(.share-form, .share-result)');
      await page.getByRole('button', { name: 'Create link' }).click();
      const link = await page.getByLabel('Puzzle link').inputValue();
      await audit(page, 'share result', '[role="dialog"]:has(.share-form, .share-result)');
      await page.goto(link);
      await expect(page.getByRole('heading', { name: 'Ari sent you a jigsaw puzzle' })).toBeVisible();
      await audit(page, 'gift page');
      const challenge = await page.request.post('/api/shares', {
        data: { image: { kind: 'catalog', id: 'great-wave' }, cols: 6, rows: 4, rotation: false, from: 'Ari', challenge: { ms: 95000, moves: 30 } },
      });
      await page.goto(`/s/${((await challenge.json()) as { id: string }).id}`);
      await expect(page.getByRole('heading', { name: 'Ari solved this in 1:35' })).toBeVisible();
      await audit(page, 'challenge page');
    });

    test('game screen, menus and help', async ({ page }) => {
      await startSolo(page, 'Golden Hour Lake', 'Easy');
      await audit(page, 'game');
      await page.getByRole('button', { name: 'More options' }).click();
      await audit(page, 'game menu', '[role="menu"]');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Guide image on the board' }).click();
      await audit(page, 'guide popover', '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await audit(page, 'help', '[role="dialog"]');
    });

    test('multiplayer room', async ({ page }) => {
      await page.goto('/puzzles?mode=room');
      await page.getByRole('button', { name: /^Orchid Bloom\./ }).click();
      await page.getByRole('radio', { name: /^Easy/ }).click();
      await page.getByRole('button', { name: 'Create room' }).click();
      await page.waitForURL(/\/room\//);
      await waitForEngine(page);
      await audit(page, 'room');
      await page.getByRole('button', { name: /players? online/ }).click();
      await audit(page, 'players panel', '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Invite', exact: true }).click();
      await audit(page, 'invite dialog', '[role="dialog"]');
    });
  });
}

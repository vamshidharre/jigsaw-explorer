import { expect, test, type Browser, type Page } from '@playwright/test';
import { debugPiece, dragPieceHome, grabPoint, lockedCount, waitForEngine } from './helpers';

async function player(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  await page.addInitScript((n) => {
    localStorage.setItem('jigsaw.e2e', '1');
    if (!localStorage.getItem('jigsaw.settings.v1')) {
      localStorage.setItem('jigsaw.settings.v1', JSON.stringify({ state: { sound: false, playerName: n }, version: 1 }));
    }
  }, name);
  return page;
}

async function createRoom(page: Page, image = 'Golden Hour Lake', preset = 'Easy'): Promise<string> {
  await page.goto('/multiplayer');
  await page.getByRole('button', { name: 'Choose a puzzle' }).click();
  await page.getByRole('button', { name: new RegExp(`^${image}\\.`) }).click();
  await page.getByRole('radio', { name: new RegExp(`^${preset}`) }).click();
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  await waitForEngine(page);
  return page.url().split('/room/')[1]!;
}

async function joinByCode(page: Page, code: string) {
  await page.goto('/multiplayer');
  await page.getByLabel('Room code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.waitForURL(new RegExp(`/room/${code}$`));
  await waitForEngine(page);
}

async function openPlayers(page: Page) {
  await page.getByRole('button', { name: /players? online/ }).click();
  return page.getByRole('list', { name: 'Players' });
}

test('two players see each other and every move in real time', async ({ browser }) => {
  const alice = await player(browser, 'Alice');
  const bob = await player(browser, 'Bob');
  const code = await createRoom(alice);
  await joinByCode(bob, code);

  // Both see both players; Alice is host.
  await expect(alice.getByRole('button', { name: '2 players online. Show players' })).toBeVisible();
  const list = await openPlayers(bob);
  await expect(list.getByText('Alice')).toBeVisible();
  await expect(list.getByText('Bob')).toBeVisible();
  await expect(list.locator('li', { hasText: 'Alice' }).getByText('Host')).toBeAttached();
  await bob.keyboard.press('Escape');
  await expect(alice.getByText('Bob joined')).toBeVisible();

  // Alice drags piece 3 slowly; Bob sees it move while she is still holding it.
  const before = await debugPiece(bob, 3);
  const grab = await grabPoint(alice, 3);
  await alice.mouse.move(grab![0], grab![1]);
  await alice.mouse.down();
  await alice.mouse.move(grab![0] + 90, grab![1] + 40, { steps: 6 });
  await expect.poll(async () => (await debugPiece(bob, 3)).screen[0] - before.screen[0], { timeout: 4000 }).toBeGreaterThan(40);
  // Wait until Bob's smoothed view has caught up with where Alice actually holds the piece.
  const rel = (d: { screen: [number, number]; home: [number, number] }) => [d.screen[0] - d.home[0], d.screen[1] - d.home[1]];
  await expect
    .poll(async () => {
      const [a, b] = [rel(await debugPiece(alice, 3)), rel(await debugPiece(bob, 3))];
      return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
    })
    .toBeLessThan(1);
  // Bob cannot take the piece Alice is holding.
  const bobGrab = await grabPoint(bob, 3);
  if (bobGrab) {
    const held = await debugPiece(bob, 3);
    await bob.mouse.move(bobGrab[0], bobGrab[1]);
    await bob.mouse.down();
    await bob.mouse.move(bobGrab[0] - 200, bobGrab[1], { steps: 4 });
    await bob.mouse.up();
    // The press turns into a pan of the table, so measure the piece relative to the board.
    const after = await debugPiece(bob, 3);
    expect(Math.abs(after.screen[0] - after.home[0] - (held.screen[0] - held.home[0]))).toBeLessThan(30);
    await expect(bob.getByText('Alice is moving that piece')).toBeVisible();
  }
  await alice.mouse.up();
  // Bob's refused press panned his view; fit everything again.
  await bob.keyboard.press('0');
  // She then puts it in its place so it does not cover other pieces.
  await dragPieceHome(alice, 3);
  await expect.poll(() => debugPiece(bob, 3).then((d) => d.locked)).toBe(true);

  // Alice places piece 0 on the board; Bob sees it locked.
  await dragPieceHome(alice, 0);
  await expect.poll(() => debugPiece(bob, 0).then((d) => d.locked)).toBe(true);

  // Bob places piece 1; Alice sees it and the pieces are joined on the board.
  await dragPieceHome(bob, 1);
  await expect.poll(() => debugPiece(alice, 1).then((d) => d.locked)).toBe(true);
  await expect.poll(() => lockedCount(alice)).toBe(3);
  await expect(alice.getByRole('progressbar', { name: 'Puzzle progress' })).not.toHaveAttribute('aria-valuenow', '0');

  // Both act at the same time on different pieces.
  await Promise.all([dragPieceHome(alice, 2), dragPieceHome(bob, 4)]);
  await expect.poll(() => lockedCount(alice)).toBe(5);
  await expect.poll(() => lockedCount(bob)).toBe(5);

  // A refresh keeps Bob's seat (no duplicate player) and the shared progress.
  await bob.reload();
  await waitForEngine(bob);
  await expect.poll(() => lockedCount(bob)).toBe(5);
  await expect(alice.getByRole('button', { name: '2 players online. Show players' })).toBeVisible();

  // Network drop: Bob goes offline, Alice sees him reconnecting; he comes back automatically.
  await bob.context().setOffline(true);
  await expect(bob.getByText(/You're offline/)).toBeVisible();
  const aliceList = await openPlayers(alice);
  await expect(aliceList.locator('li', { hasText: 'Bob' }).getByText('Reconnecting…')).toBeVisible();
  await alice.keyboard.press('Escape');
  // Alice keeps playing while Bob is away.
  await dragPieceHome(alice, 5);
  await bob.context().setOffline(false);
  await expect(bob.getByText(/You're offline/)).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => lockedCount(bob), { timeout: 15000 }).toBe(6);

  // A third player joins, then Bob leaves.
  const carol = await player(browser, 'Carol');
  await carol.goto(`/room/${code}`);
  await waitForEngine(carol);
  await expect.poll(() => lockedCount(carol)).toBe(6);
  await expect(alice.getByRole('button', { name: '3 players online. Show players' })).toBeVisible();
  await bob.getByRole('button', { name: 'More options' }).click();
  await bob.getByRole('menuitem', { name: 'Leave room' }).click();
  await bob.waitForURL(/\/multiplayer$/);
  await expect(alice.getByText('Bob left')).toBeVisible();
  await expect(alice.getByRole('button', { name: '2 players online. Show players' })).toBeVisible();

  // Alice leaves: Carol becomes host.
  await alice.getByRole('button', { name: 'More options' }).click();
  await alice.getByRole('menuitem', { name: 'Leave room' }).click();
  await expect(carol.getByText('You are now the host')).toBeVisible();
  await carol.getByRole('button', { name: 'More options' }).click();
  await expect(carol.getByRole('menuitem', { name: 'New puzzle for everyone' })).toBeVisible();
  await carol.keyboard.press('Escape');

  await alice.context().close();
  await bob.context().close();
  await carol.context().close();
});

test('players finish a puzzle together and see contributions', async ({ browser }) => {
  const alice = await player(browser, 'Alice');
  const bob = await player(browser, 'Bob');
  const code = await createRoom(alice, 'Orchid Bloom', 'Easy');
  await bob.goto(`/room/${code}`);
  await waitForEngine(bob);
  const total = await alice.evaluate(() => (window as unknown as { __jigsaw: { engine: { model: { pieceCount: number } } } }).__jigsaw.engine.model.pieceCount);
  for (let p = 0; p < total; p++) {
    const page = p % 2 === 0 ? alice : bob;
    if (!(await debugPiece(page, p)).locked) await dragPieceHome(page, p);
    // Give the server round trip a moment before the other player acts.
    await expect.poll(() => debugPiece(page === alice ? bob : alice, p).then((d) => d.locked)).toBe(true);
  }
  for (const page of [alice, bob]) {
    await expect(page.getByRole('heading', { name: 'Solved together!' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Solved together!' }).getByText('Alice')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Solved together!' }).getByText('Bob')).toBeVisible();
  }
  await expect(bob.getByText('Waiting for the host to start a new puzzle…')).toBeVisible();

  // Host starts a new puzzle for everyone.
  await alice.getByRole('button', { name: 'New puzzle for everyone' }).click();
  await alice.getByRole('button', { name: 'The Great Wave off Kanagawa' }).click();
  await alice.getByRole('radio', { name: /^Easy/ }).click();
  await alice.getByRole('button', { name: 'Start new puzzle for everyone' }).click();
  await expect(bob.getByText('Alice started a new puzzle')).toBeVisible();
  await expect(bob.getByRole('heading', { name: 'The Great Wave off Kanagawa' })).toBeVisible();
  await waitForEngine(bob);
  await expect.poll(() => lockedCount(bob)).toBe(0);
  await alice.context().close();
  await bob.context().close();
});

test('invalid and unknown room codes show helpful errors', async ({ browser }) => {
  const page = await player(browser, 'Dana');
  await page.goto('/room/abc');
  await expect(page.getByRole('heading', { name: "That room link isn't valid" })).toBeVisible();
  await page.goto('/room/ZZZZZZ');
  await expect(page.getByRole('heading', { name: 'Room not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a new room' })).toBeVisible();
  await page.goto('/multiplayer');
  await page.getByLabel('Room code').fill('12');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText(/Room codes are 6 letters/)).toBeVisible();
  await page.getByLabel('Room code').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText('No room with that code. It may have expired.')).toBeVisible();
  await page.context().close();
});

test('a new player is asked for a name before joining', async ({ browser }) => {
  const host = await player(browser, 'Host');
  const code = await createRoom(host);
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.addInitScript(() => localStorage.setItem('jigsaw.e2e', '1'));
  await guest.goto(`/room/${code}`);
  await expect(guest.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest.getByText('Please enter a name.')).toBeVisible();
  await guest.getByLabel('Your name').fill('  Zoë   the   Great ');
  await guest.getByRole('button', { name: 'Join room' }).click();
  await waitForEngine(guest);
  const list = await openPlayers(host);
  await expect(list.getByText('Zoë the Great')).toBeVisible();
  await host.context().close();
  await ctx.close();
});

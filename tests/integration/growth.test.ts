import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyPuzzle, utcDayKey } from '../../src/shared/daily';
import type { ShareInfo } from '../../src/shared/protocol';
import { createRoom, launch, sleep, TestClient, type TestServer } from './helpers';

const TEMPLATE = `<!doctype html><html><head>
<!-- head:meta (replaced per page) -->
<title>Default</title>
<!-- /head:meta -->
</head><body><div id="root"></div></body></html>`;

let server: TestServer;
let dir: string;

async function start(overrides: Parameters<typeof launch>[1] = {}) {
  const publicDir = path.join(dir, 'client');
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), TEMPLATE);
  server = await launch(path.join(dir, 'data'), { publicDir, statsToken: 'test-stats-token', ...overrides });
}

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  dir = await mkdtemp(path.join(tmpdir(), 'jigsaw-growth-'));
});

afterEach(async () => {
  await server?.stop();
  await rm(dir, { recursive: true, force: true });
});

function post(pathname: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${server.url}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function createShare(body: Record<string, unknown> = {}) {
  const res = await post('/api/shares', { image: { kind: 'catalog', id: 'great-wave' }, cols: 10, rows: 6, rotation: false, ...body });
  return { res, body: (await res.json()) as { id: string; expiresAt: number; error?: string } };
}

async function page(pathname: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${server.url}${pathname}`, { headers });
  return { status: res.status, html: await res.text() };
}

function meta(html: string, key: string): string | null {
  const m = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html);
  return m ? m[1]! : null;
}

async function uploadPhoto(): Promise<string> {
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3a7' } }).png().toBuffer();
  const res = await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('share links', () => {
  beforeEach(() => start());

  it('creates and returns a share with sanitised text', async () => {
    const { res, body } = await createShare({
      seed: 4242,
      from: '  Ana\u0000 ',
      message: `Beat   this!\n${'x'.repeat(300)}`,
      challenge: { ms: 271_000, moves: 88 },
    });
    expect(res.status).toBe(201);
    expect(body.id).toMatch(/^[a-z0-9]{10}$/);
    const info = (await (await fetch(`${server.url}/api/shares/${body.id}`)).json()) as ShareInfo;
    expect(info).toMatchObject({
      id: body.id,
      title: 'The Great Wave off Kanagawa',
      seed: 4242,
      cols: 10,
      rows: 6,
      from: 'Ana',
      challenge: { ms: 271_000, moves: 88 },
    });
    expect(info.message!.startsWith('Beat this! xxx')).toBe(true);
    expect(info.message!.length).toBe(140);
    expect(info.expiresAt - info.createdAt).toBe(30 * 86_400_000);
  });

  it('rejects bad input', async () => {
    expect((await createShare({ cols: 40, rows: 2 })).res.status).toBe(400); // pieces far from square
    expect((await createShare({ cols: 100, rows: 100 })).res.status).toBe(400);
    expect((await createShare({ image: { kind: 'catalog', id: 'nope' } })).res.status).toBe(400);
    expect((await createShare({ image: { kind: 'upload', id: 'u' + 'a'.repeat(20) } })).res.status).toBe(400);
    expect((await createShare({ challenge: { ms: 5, moves: 1 } })).res.status).toBe(400);
    expect((await fetch(`${server.url}/api/shares/NOT-AN-ID`)).status).toBe(400);
    expect((await fetch(`${server.url}/api/shares/abcdefghij`)).status).toBe(404);
  });

  it('keeps shares across restarts and keeps their uploaded photo', async () => {
    const upload = await uploadPhoto();
    const { body } = await createShare({ image: { kind: 'upload', id: upload }, cols: 8, rows: 6, title: 'Our holiday' });
    const info = (await (await fetch(`${server.url}/api/shares/${body.id}`)).json()) as ShareInfo;
    expect(info).toMatchObject({ title: 'Our holiday', width: 640, height: 480 });
    // A cleanup pass with zero retention still keeps the photo the share points to.
    await server.uploads.cleanup(0, new Set([...server.rooms.uploadsInUse(), ...server.shares.uploadsInUse()]));
    expect((await fetch(`${server.url}/api/images/${upload}`)).status).toBe(200);

    await server.stop();
    server = await launch(path.join(dir, 'data'), { publicDir: path.join(dir, 'client') });
    expect((await fetch(`${server.url}/api/shares/${body.id}`)).status).toBe(200);
  });
});

describe('share expiry', () => {
  it('expires links after their lifetime', async () => {
    await start({ shareTtlMs: 300 });
    const { body } = await createShare();
    expect((await fetch(`${server.url}/api/shares/${body.id}`)).status).toBe(200);
    await sleep(400);
    expect((await fetch(`${server.url}/api/shares/${body.id}`)).status).toBe(404);
    expect(await server.shares.sweep()).toBe(1);
    expect((await page(`/s/${body.id}`)).status).toBe(404);
  });
});

describe('page metadata and link previews', () => {
  beforeEach(() => start());

  it('gives each page its own title, description and preview image', async () => {
    const home = await page('/');
    expect(home.html).toContain('<title>Jigbee — Online jigsaw puzzles, solo or together</title>');
    expect(home.html).not.toContain('<title>Default</title>');
    expect(meta(home.html, 'og:image')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/og\/catalog\/[a-z-]+\.jpg$/);
    expect(home.html).toContain('<link rel="canonical"');

    const puzzle = await page('/puzzle/great-wave');
    expect(puzzle.html).toContain('<title>The Great Wave off Kanagawa jigsaw puzzle — Jigbee</title>');
    expect(meta(puzzle.html, 'og:image')).toContain('/og/catalog/great-wave.jpg');
    expect(meta(puzzle.html, 'robots')).toBeNull();

    const daily = await page('/daily');
    const today = dailyPuzzle(utcDayKey());
    expect(daily.html).toContain(`Daily jigsaw #${today.number}`);
    expect(meta(daily.html, 'og:image')).toContain(`/og/catalog/${today.imageId}.jpg`);

    const missing = await page('/no/such/page');
    expect(missing.status).toBe(404);
    expect(meta(missing.html, 'robots')).toBe('noindex');
  });

  it('describes invite links for rooms without indexing them', async () => {
    const { code } = await createRoom(server.url, { image: { kind: 'catalog', id: 'orchid-bloom' }, pieces: 24 });
    const room = await page(`/room/${code}`);
    expect(room.html).toContain('<title>Join my Orchid Bloom jigsaw puzzle</title>');
    expect(meta(room.html, 'og:description')).toMatch(/^\d+ pieces\. 0% done\. Opens in your browser/);
    expect(meta(room.html, 'robots')).toBe('noindex');
    expect(room.html).not.toContain('rel="canonical"');
    const gone = await page('/room/ZZZZZZ');
    expect(gone.status).toBe(200);
    expect(gone.html).toContain('<title>Join a jigsaw puzzle room</title>');
  });

  it('escapes user text in share previews and veils gift pictures', async () => {
    const gift = await createShare({ from: '"><script>alert(1)</script>', message: 'Hi <b>there</b> & "you"' });
    const html = (await page(`/s/${gift.body.id}`)).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(meta(html, 'og:description')).toContain('Hi &lt;b&gt;there&lt;/b&gt; &amp; &quot;you&quot;');
    expect(meta(html, 'og:image')).toContain('/og/catalog/great-wave-veiled.jpg');

    const challenge = await createShare({ from: 'Ana', challenge: { ms: 125_000, moves: 40 } });
    const c = (await page(`/s/${challenge.body.id}`)).html;
    expect(c).toContain('<title>Ana solved this jigsaw in 2:05. Can you beat it?</title>');
    expect(meta(c, 'og:image')).toContain('/og/catalog/great-wave.jpg');
  });

  it('uses PUBLIC_URL for absolute links and ignores forged host headers', async () => {
    // fetch() cannot override Host, so send this one with node:http.
    const forged = await new Promise<string>((resolve, reject) => {
      const req = request(`${server.url}/puzzles`, { headers: { host: 'evil.example"><x' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.end();
    });
    expect(meta(forged, 'og:url')).toBe('http://localhost/puzzles');
    await server.stop();
    server = await launch(path.join(dir, 'data'), { publicDir: path.join(dir, 'client'), publicUrl: 'https://jigbee.com' });
    const res = await page('/puzzles');
    expect(meta(res.html, 'og:url')).toBe('https://jigbee.com/puzzles');
    expect(meta(res.html, 'og:image')).toMatch(/^https:\/\/jigbee\.com\/og\//);
    expect(await (await fetch(`${server.url}/robots.txt`)).text()).toContain('Sitemap: https://jigbee.com/sitemap.xml');
  });

  it('renders 1200×630 preview images for gallery pictures and uploads', async () => {
    const res = await fetch(`${server.url}/og/catalog/great-wave.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const info = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([info.width, info.height, info.format]).toEqual([1200, 630, 'jpeg']);

    expect((await fetch(`${server.url}/og/catalog/great-wave-veiled.jpg`)).status).toBe(200);
    const upload = await uploadPhoto();
    expect((await fetch(`${server.url}/og/upload/${upload}.jpg`)).status).toBe(200);
    expect((await fetch(`${server.url}/og/upload/${upload}-veiled.jpg`)).status).toBe(200);
    expect((await fetch(`${server.url}/og/catalog/unknown.jpg`)).status).toBe(404);
    expect((await fetch(`${server.url}/og/upload/u${'b'.repeat(20)}.jpg`)).status).toBe(404);
    expect((await fetch(`${server.url}/og/other/great-wave.jpg`)).status).toBe(404);
  });

  it('serves robots.txt and a sitemap of public pages', async () => {
    const robots = await (await fetch(`${server.url}/robots.txt`)).text();
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toContain('Disallow: /s/');
    const sitemap = await (await fetch(`${server.url}/sitemap.xml`)).text();
    expect(sitemap).toContain('/puzzle/great-wave</loc>');
    expect(sitemap).toContain('/daily</loc>');
    expect(sitemap).not.toContain('/room/');
  });
});

describe('usage counting', () => {
  const browser = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36' };
  const auth = { authorization: 'Bearer test-stats-token' };

  async function stats(): Promise<Record<string, number>> {
    const res = await fetch(`${server.url}/api/stats?days=1`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: Array<{ counts: Record<string, number> }> };
    return body.days[0]!.counts;
  }

  it('counts allowed events and ignores bots and unknown labels', async () => {
    await start();
    expect((await post('/api/events', { e: 'visit', l: 'reddit.com' }, browser)).status).toBe(204);
    expect((await post('/api/events', { e: 'pageview', l: '/daily' }, browser)).status).toBe(204);
    expect((await post('/api/events', { e: 'pageview', l: '/daily' }, browser)).status).toBe(204);
    expect((await post('/api/events', { e: 'solo_start', l: 'great-wave' }, browser)).status).toBe(204);
    expect((await post('/api/events', { e: 'pageview', l: '/room/ABCDEF' }, browser)).status).toBe(400);
    expect((await post('/api/events', { e: 'room_create' }, browser)).status).toBe(400); // server-only event
    expect((await post('/api/events', { e: 'visit' }, { 'user-agent': 'Googlebot/2.1' })).status).toBe(204);
    // sendBeacon sends text/plain for string bodies.
    const beacon = await fetch(`${server.url}/api/events`, { method: 'POST', headers: { 'content-type': 'text/plain', ...browser }, body: '{"e":"daily_start"}' });
    expect(beacon.status).toBe(204);

    const { code } = await createRoom(server.url);
    const a = await TestClient.connect(server.url);
    const welcome = a.waitFor('welcome');
    a.hello(code, 'Ana');
    const w = await welcome;
    // A reconnect with the same seat is not a new player.
    a.close();
    await sleep(50);
    const again = await TestClient.connect(server.url);
    const resumed = again.waitFor('welcome');
    again.hello(code, 'Ana', { resume: { playerId: w.you.id, token: w.you.token } });
    await resumed;
    again.close();

    expect(await stats()).toEqual({
      'visit|reddit.com': 1,
      'pageview|/daily': 2,
      'solo_start|great-wave': 1,
      daily_start: 1,
      'room_create|starry-night': 1,
      room_join: 1,
    });
  });

  it('requires the access key and persists counts across restarts', async () => {
    await start();
    expect((await fetch(`${server.url}/api/stats`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/stats`, { headers: { authorization: 'Bearer wrong-token-value' } })).status).toBe(401);
    await post('/api/events', { e: 'daily_complete' }, browser);
    await server.stop();
    const saved = JSON.parse(await readFile(path.join(dir, 'data', 'analytics.json'), 'utf8')) as { days: Record<string, Record<string, number>> };
    expect(Object.values(saved.days)[0]).toEqual({ daily_complete: 1 });
    server = await launch(path.join(dir, 'data'), { publicDir: path.join(dir, 'client'), statsToken: 'test-stats-token' });
    expect(await stats()).toEqual({ daily_complete: 1 });
  });

  it('turns off cleanly', async () => {
    await start({ statsToken: null, analytics: false });
    expect((await fetch(`${server.url}/api/stats`, { headers: auth })).status).toBe(404);
    expect((await post('/api/events', { e: 'visit' }, browser)).status).toBe(204);
    expect(server.analytics.report(1)[0]!.counts).toEqual({});
  });
});

describe('upload storage limit', () => {
  it('refuses new photos once the storage budget is used up', async () => {
    await start({ uploadStorageBytes: 1 });
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#a33' } }).png().toBuffer();
    const res = await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/storage is full/);
  });
});

describe('hosting defaults', () => {
  it('generates a stats access key once and keeps it across restarts', async () => {
    await start({ statsToken: null });
    const token = (await readFile(path.join(dir, 'data', 'stats-token'), 'utf8')).trim();
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect((await fetch(`${server.url}/api/stats`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    await server.stop();
    server = await launch(path.join(dir, 'data'), { publicDir: path.join(dir, 'client'), statsToken: null });
    expect((await fetch(`${server.url}/api/stats`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it('adds search-engine verification tags to every page', async () => {
    await start({ googleSiteVerification: 'google-token_123', bingSiteVerification: 'BING0123456789' });
    for (const p of ['/', '/puzzles', '/room/ABCDEF']) {
      const { html } = await page(p);
      expect(meta(html, 'google-site-verification')).toBe('google-token_123');
      expect(meta(html, 'msvalidate.01')).toBe('BING0123456789');
    }
  });
});

describe('photo maker and embeds', () => {
  beforeEach(() => start());

  it('describes the photo puzzle maker and lists it in the sitemap', async () => {
    const { html } = await page('/create');
    expect(html).toContain('<title>Make a jigsaw puzzle from your photo — Jigbee</title>');
    expect(await (await fetch(`${server.url}/sitemap.xml`)).text()).toContain('/create</loc>');
  });

  it('lets only embedded puzzles be framed by other sites', async () => {
    const normal = await fetch(`${server.url}/puzzle/great-wave`);
    expect(normal.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(normal.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    for (const p of ['/embed/great-wave?pieces=24', '/play/embed-great-wave-6x4?embed=1']) {
      const res = await fetch(`${server.url}${p}`);
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('content-security-policy')).toContain('frame-ancestors *');
    }
    const play = await fetch(`${server.url}/play/some-game`);
    expect(play.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const embedPage = await page('/embed/great-wave');
    expect(meta(embedPage.html, 'robots')).toBe('noindex');
    expect((await page('/embed/not-a-picture')).status).toBe(404);
  });
});

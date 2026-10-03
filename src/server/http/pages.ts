/**
 * Server-side page metadata. The client is a single-page app, so link
 * previews (chat apps, social sites) and search engines would otherwise see the
 * same title and description everywhere. Each response of `index.html` gets a
 * title, description, canonical URL and Open Graph / Twitter card tags for the
 * route being requested.
 */
import { BRAND, pageTitle } from '../../shared/brand';
import { CATALOG, CATEGORIES, getCatalogImage } from '../../shared/catalog';
import { dailyPuzzle, utcDayKey } from '../../shared/daily';
import { isValidRoomCode, SHARE_ID_PATTERN, type ImageRef } from '../../shared/protocol';
import { DIFFICULTY_PRESETS, maxPiecesForImage } from '../../shared/puzzle/spec';
import type { RoomManager } from '../rooms/RoomManager';
import type { ShareStore } from '../shares/ShareStore';
import { OG_HEIGHT, OG_WIDTH } from '../images/ogImage';

export interface PageMeta {
  status: number;
  title: string;
  description: string;
  /** Path of the page (canonical URL and og:url). */
  path: string;
  /** Path of the 1200×630 preview image. */
  image: string;
  imageAlt: string;
  /** Private or per-player pages are kept out of search engines. */
  noindex: boolean;
}

export interface PageContext {
  rooms: RoomManager;
  shares: ShareStore;
}

export function ogImagePath(ref: ImageRef, veiled = false): string {
  return `/og/${ref.kind}/${ref.id}${veiled ? '-veiled' : ''}.jpg`;
}

const HOME_IMAGE = ogImagePath({ kind: 'catalog', id: 'great-wave' });

function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function resolvePageMeta(pathname: string, ctx: PageContext, now = new Date()): PageMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const base = {
    status: 200,
    path,
    image: HOME_IMAGE,
    imageAlt: 'A jigsaw puzzle with one piece lifted out',
    noindex: false,
  };

  if (path === '/') return { ...base, title: pageTitle(), description: BRAND.description };

  if (path === '/puzzles') {
    return {
      ...base,
      title: pageTitle('Free jigsaw puzzles'),
      description: `Browse ${CATALOG.length} free online jigsaw puzzles — ${CATEGORIES.map((c) => c.label.toLowerCase()).join(', ')}. From 6 to 1,000 pieces, or turn your own photo into a puzzle.`,
    };
  }

  if (path === '/multiplayer') {
    return {
      ...base,
      title: pageTitle('Play jigsaw puzzles together'),
      description: 'Create a room, share the link and solve a jigsaw puzzle with friends in real time. Live cursors, no sign-up, works on phones and computers.',
    };
  }

  if (path === '/daily') {
    const daily = dailyPuzzle(utcDayKey(now));
    const pieces = daily.spec.cols * daily.spec.rows;
    return {
      ...base,
      title: pageTitle(`Daily jigsaw #${daily.number}`),
      description: `Today's free jigsaw puzzle: ${daily.title}, ${pieces} pieces. A new puzzle every day — keep your streak going and share your time.`,
      image: ogImagePath({ kind: 'catalog', id: daily.imageId }),
      imageAlt: `${daily.title} as a jigsaw puzzle`,
    };
  }

  if (path === '/create') {
    return {
      ...base,
      title: pageTitle('Make a jigsaw puzzle from your photo'),
      description: 'Turn any photo into a free online jigsaw puzzle in seconds. Solve it yourself, play it with friends in real time, or send it as a gift. No sign-up.',
      image: ogImagePath({ kind: 'catalog', id: 'pug-portrait' }),
      imageAlt: 'A photo turned into a jigsaw puzzle',
    };
  }

  if (path === '/credits') {
    return { ...base, title: pageTitle('Image credits'), description: `Sources and licences of the pictures used on ${BRAND.name}.` };
  }

  const puzzle = /^\/puzzle\/([a-z0-9-]{1,64})$/.exec(path);
  if (puzzle) {
    const img = getCatalogImage(puzzle[1]!);
    if (img) {
      const max = maxPiecesForImage(img.width, img.height);
      const category = CATEGORIES.find((c) => c.id === img.category)?.label.toLowerCase() ?? 'picture';
      return {
        ...base,
        title: pageTitle(`${img.title} jigsaw puzzle`),
        description: `Play ${img.title} as a free online jigsaw puzzle (${category}). Choose ${DIFFICULTY_PRESETS[0]!.pieces} to ${max} pieces, turn on rotation for a challenge, or solve it together with friends.`,
        image: ogImagePath({ kind: 'catalog', id: img.id }),
        imageAlt: `${img.title} as a jigsaw puzzle`,
      };
    }
  }

  const embed = /^\/embed\/([a-z0-9-]{1,64})$/.exec(path);
  if (embed) {
    const img = getCatalogImage(embed[1]!);
    return {
      ...base,
      status: img ? 200 : 404,
      title: pageTitle(img ? `${img.title} jigsaw puzzle` : 'Puzzle not found'),
      description: BRAND.description,
      image: img ? ogImagePath({ kind: 'catalog', id: img.id }) : base.image,
      noindex: true,
    };
  }

  const room = /^\/room\/([A-Za-z0-9]{1,12})$/.exec(path);
  if (room) {
    const code = room[1]!.toUpperCase();
    const found = isValidRoomCode(code) ? ctx.rooms.get(code) : undefined;
    if (found) {
      const summary = ctx.rooms.summary(found);
      const pct = Math.round(summary.progress * 100);
      const playing = summary.online === 0 ? '' : summary.online === 1 ? ', 1 person is playing' : `, ${summary.online} people are playing`;
      const state = summary.completed ? 'Finished — start the next one together.' : `${pct}% done${playing}.`;
      return {
        ...base,
        title: summary.image.kind === 'catalog' ? `Join my ${summary.title} jigsaw puzzle` : 'Join my jigsaw puzzle',
        description: `${summary.pieces} pieces${summary.rotation ? ' with rotation' : ''}. ${state} Opens in your browser — no sign-up.`,
        image: ogImagePath(summary.image),
        imageAlt: 'The puzzle being solved in this room',
        noindex: true,
      };
    }
    return {
      ...base,
      title: 'Join a jigsaw puzzle room',
      description: `Solve a jigsaw puzzle together on ${BRAND.name}. Opens in your browser — no sign-up.`,
      noindex: true,
    };
  }

  const share = /^\/s\/([A-Za-z0-9]{1,16})$/.exec(path);
  if (share) {
    const id = share[1]!.toLowerCase();
    const record = SHARE_ID_PATTERN.test(id) ? ctx.shares.get(id, now.getTime()) : undefined;
    if (record) {
      const pieces = record.cols * record.rows;
      const from = record.from ?? 'Someone';
      const challenge = record.challenge;
      return {
        ...base,
        title: challenge ? `${from} solved this jigsaw in ${formatClock(challenge.ms)}. Can you beat it?` : `${from} sent you a jigsaw puzzle`,
        description: record.message
          ? `“${record.message}” — ${pieces} pieces, opens in your browser.`
          : challenge
            ? `${record.title}, ${pieces} pieces, cut exactly the same way. Opens in your browser — no sign-up.`
            : `A ${pieces}-piece puzzle. Solve it to see the picture. Opens in your browser — no sign-up.`,
        image: ogImagePath(record.image, !challenge),
        imageAlt: challenge ? `${record.title} as a jigsaw puzzle` : 'A hidden picture, cut into jigsaw pieces',
        noindex: true,
      };
    }
    return {
      ...base,
      status: 404,
      title: pageTitle('Puzzle link expired'),
      description: 'This puzzle link has expired or does not exist.',
      noindex: true,
    };
  }

  if (/^\/play\/[^/]+$/.test(path)) {
    return { ...base, title: pageTitle('Puzzle'), description: BRAND.description, noindex: true };
  }

  if (path === '/stats') return { ...base, title: pageTitle('Usage'), description: BRAND.description, noindex: true };

  return { ...base, status: 404, title: pageTitle('Page not found'), description: BRAND.description, noindex: true };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface SiteVerification {
  google?: string | null;
  bing?: string | null;
}

export function renderHeadTags(meta: PageMeta, origin: string, verification: SiteVerification = {}): string {
  const url = `${origin}${meta.path}`;
  const image = `${origin}${meta.image}`;
  const tags: Array<[string, string, string]> = [
    ['name', 'description', meta.description],
    ['property', 'og:site_name', BRAND.name],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', url],
    ['property', 'og:image', image],
    ['property', 'og:image:type', 'image/jpeg'],
    ['property', 'og:image:width', String(OG_WIDTH)],
    ['property', 'og:image:height', String(OG_HEIGHT)],
    ['property', 'og:image:alt', meta.imageAlt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', meta.title],
    ['name', 'twitter:description', meta.description],
    ['name', 'twitter:image', image],
  ];
  if (meta.noindex) tags.push(['name', 'robots', 'noindex']);
  if (verification.google) tags.push(['name', 'google-site-verification', verification.google]);
  if (verification.bing) tags.push(['name', 'msvalidate.01', verification.bing]);
  const lines = [`<title>${escapeHtml(meta.title)}</title>`];
  for (const [attr, key, value] of tags) lines.push(`<meta ${attr}="${key}" content="${escapeHtml(value)}" />`);
  if (!meta.noindex) lines.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
  return lines.join('\n    ');
}

const HEAD_BLOCK = /<!-- head:meta[^>]*-->[\s\S]*?<!-- \/head:meta -->/;

export function hasHeadBlock(template: string): boolean {
  return HEAD_BLOCK.test(template);
}

/** Replaces the marked block in index.html with the page's tags. */
export function injectHead(template: string, tags: string): string {
  return template.replace(HEAD_BLOCK, () => tags);
}

export function sitemapXml(origin: string): string {
  const paths = ['/', '/puzzles', '/daily', '/create', '/multiplayer', '/credits', ...CATALOG.map((img) => `/puzzle/${img.id}`)];
  const urls = paths.map((p) => `  <url><loc>${escapeHtml(origin + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Room and share pages stay crawlable on purpose: link-preview bots (some of
 * which obey robots.txt) must reach them, and search engines must be able to
 * read their `noindex` tag.
 */
export function robotsTxt(origin: string): string {
  return ['User-agent: *', 'Disallow: /api/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { puzzleLabel, validClientLabel } from '../../shared/analytics';
import { getCatalogImage } from '../../shared/catalog';
import {
  isValidRoomCode,
  MAX_SHARE_MESSAGE,
  MAX_SHARE_TITLE,
  sanitizeName,
  sanitizeText,
  SHARE_ID_PATTERN,
  UPLOAD_ID_PATTERN,
  type CreateRoomResponse,
  type CreateShareResponse,
  type ShareInfo,
  type UploadResponse,
} from '../../shared/protocol';
import { MAX_PIECES, MIN_PIECE_PIXELS, MIN_PIECES } from '../../shared/puzzle/spec';
import { randomSeed } from '../../shared/rng';
import type { Analytics } from '../analytics/Analytics';
import { OgImageCache, renderOgImage } from '../images/ogImage';
import { resolveImage } from '../images/resolveImage';
import { UploadError, type UploadStore } from '../images/uploadStore';
import { log } from '../logger';
import { RoomError, type RoomManager } from '../rooms/RoomManager';
import { ShareError, type ShareStore } from '../shares/ShareStore';
import { safeEqual } from '../util/ids';
import { WindowRateLimiter } from '../util/rateLimit';
import { analyticsEventSchema, createRoomSchema, createShareSchema } from '../ws/schemas';
import { hasHeadBlock, injectHead, renderHeadTags, resolvePageMeta, robotsTxt, sitemapXml, type SiteVerification } from './pages';

export interface AppOptions {
  rooms: RoomManager;
  uploads: UploadStore;
  shares: ShareStore;
  analytics: Analytics;
  publicDir: string;
  uploadMaxBytes: number;
  trustProxy: number;
  isProduction: boolean;
  /** Canonical origin for absolute URLs (link previews, sitemap); derived from the request when null. */
  publicUrl: string | null;
  /** Access key for GET /api/stats; the endpoint is disabled when null. */
  statsToken: string | null;
  /** Search-engine ownership tokens, added to every page. */
  verification?: SiteVerification;
}

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit/i;

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'worker-src': ["'self'", 'blob:'],
          'script-src': ["'self'"],
          // All URLs are relative; leave scheme upgrades to the TLS terminator so plain-HTTP self-hosting works.
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: opts.isProduction,
    }),
  );
  // Embedded puzzles may be shown in iframes on any site; every other page keeps frame-ancestors 'self'.
  app.use((req, res, next) => {
    const embedded = req.path.startsWith('/embed/') || (req.path.startsWith('/play/') && req.query.embed === '1');
    if (embedded) {
      res.removeHeader('X-Frame-Options');
      const csp = res.getHeader('Content-Security-Policy');
      if (typeof csp === 'string') res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors [^;]*/, 'frame-ancestors *'));
    }
    next();
  });
  app.use(compression());

  const createLimiter = new WindowRateLimiter(20, 10 * 60_000);
  const uploadLimiter = new WindowRateLimiter(20, 10 * 60_000);
  const shareLimiter = new WindowRateLimiter(30, 10 * 60_000);
  const lookupLimiter = new WindowRateLimiter(120, 60_000);
  const eventLimiter = new WindowRateLimiter(240, 60_000);
  const statsLimiter = new WindowRateLimiter(30, 10 * 60_000);
  const ogLimiter = new WindowRateLimiter(120, 60_000);

  const limit = (limiter: WindowRateLimiter) => (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    if (limiter.take(key)) return next();
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  };

  /** Absolute origin for links in previews and the sitemap. */
  const originFor = (req: Request): string => {
    if (opts.publicUrl) return opts.publicUrl;
    const host = req.get('host') ?? '';
    const proto = req.protocol === 'https' ? 'https' : 'http';
    return HOST_PATTERN.test(host) ? `${proto}://${host}` : 'http://localhost';
  };

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: opts.rooms.size, uptime: Math.round(process.uptime()) });
  });

  api.post('/rooms', limit(createLimiter), express.json({ limit: '4kb' }), (req, res) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid room settings.' });
      return;
    }
    try {
      const room = opts.rooms.create(parsed.data);
      opts.analytics.record('room_create', puzzleLabel(parsed.data.image));
      const body: CreateRoomResponse = { code: room.code, hostKey: room.hostKey };
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof RoomError) res.status(err.status).json({ error: err.message });
      else throw err;
    }
  });

  api.get('/rooms/:code', limit(lookupLimiter), (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: 'That is not a valid room code.' });
      return;
    }
    const room = opts.rooms.get(code);
    if (!room) {
      res.status(404).json({ error: 'This room does not exist or has expired.' });
      return;
    }
    res.json(opts.rooms.summary(room));
  });

  api.post(
    '/uploads',
    limit(uploadLimiter),
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: opts.uploadMaxBytes }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Send the image as the request body with an image content type.' });
        return;
      }
      try {
        const meta = await opts.uploads.save(req.body);
        opts.analytics.record('upload');
        const body: UploadResponse = { id: meta.id, width: meta.width, height: meta.height };
        res.status(201).json(body);
      } catch (err) {
        if (err instanceof UploadError) res.status(err.status).json({ error: err.message });
        else throw err;
      }
    },
  );

  api.get('/images/:id', (req, res) => {
    const meta = opts.uploads.get(String(req.params.id));
    if (!meta) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.type('image/webp');
    res.sendFile(opts.uploads.filePath(meta.id));
  });

  api.post('/shares', limit(shareLimiter), express.json({ limit: '4kb' }), async (req, res) => {
    const parsed = createShareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid puzzle link settings.' });
      return;
    }
    const d = parsed.data;
    const image = resolveImage(d.image, opts.uploads);
    if (!image) {
      res.status(400).json({ error: 'That picture is no longer available. Please upload it again.' });
      return;
    }
    const count = d.cols * d.rows;
    const pw = image.width / d.cols;
    const ph = image.height / d.rows;
    if (count < MIN_PIECES || count > MAX_PIECES || Math.min(pw, ph) < MIN_PIECE_PIXELS * 0.75 || Math.max(pw / ph, ph / pw) > 2) {
      res.status(400).json({ error: 'That number of pieces does not work for this picture.' });
      return;
    }
    try {
      const record = await opts.shares.create({
        title: image.title ?? (sanitizeText(d.title ?? '', MAX_SHARE_TITLE) || 'Photo puzzle'),
        image: d.image,
        width: image.width,
        height: image.height,
        seed: d.seed ?? randomSeed(),
        cols: d.cols,
        rows: d.rows,
        rotation: d.rotation,
        from: sanitizeName(d.from ?? '') || null,
        message: sanitizeText(d.message ?? '', MAX_SHARE_MESSAGE) || null,
        challenge: d.challenge ?? null,
      });
      opts.analytics.record('share_create', record.challenge ? 'challenge' : 'gift');
      const body: CreateShareResponse = { id: record.id, expiresAt: record.expiresAt };
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof ShareError) res.status(err.status).json({ error: err.message });
      else throw err;
    }
  });

  api.get('/shares/:id', limit(lookupLimiter), (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!SHARE_ID_PATTERN.test(id)) {
      res.status(400).json({ error: 'That is not a valid puzzle link.' });
      return;
    }
    const record = opts.shares.get(id);
    if (!record || (record.image.kind === 'upload' && !opts.uploads.get(record.image.id))) {
      res.status(404).json({ error: 'This puzzle link has expired or does not exist.' });
      return;
    }
    opts.analytics.record('share_open');
    const { version: _version, ...info } = record;
    res.json(info satisfies ShareInfo);
  });

  // Usage counting. Accepts text/plain too, which is what navigator.sendBeacon sends for strings.
  api.post('/events', limit(eventLimiter), express.json({ limit: '1kb', type: ['application/json', 'text/plain'] }), (req, res) => {
    const parsed = analyticsEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid event.' });
      return;
    }
    const label = validClientLabel(parsed.data.e, parsed.data.l);
    if (label === null) {
      res.status(400).json({ error: 'Invalid event.' });
      return;
    }
    if (!BOT_PATTERN.test(req.get('user-agent') ?? '')) opts.analytics.record(parsed.data.e, label);
    res.status(204).end();
  });

  api.get('/stats', limit(statsLimiter), (req, res) => {
    if (!opts.statsToken) {
      res.status(404).json({ error: 'Usage stats are not enabled on this server. Set STATS_TOKEN to turn them on.' });
      return;
    }
    const auth = req.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !safeEqual(token, opts.statsToken)) {
      res.status(401).json({ error: 'That access key is not right.' });
      return;
    }
    const days = Math.min(400, Math.max(1, Math.round(Number(req.query.days) || 30)));
    res.json({ collecting: opts.analytics.enabled, days: opts.analytics.report(days) });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);

  // Link-preview images. Gallery files come from the client build, or from public/ in development.
  const builtGallery = path.join(opts.publicDir, 'gallery');
  const galleryDir = existsSync(builtGallery) ? builtGallery : path.resolve('public/gallery');
  const ogCache = new OgImageCache(64);
  app.get('/og/:kind/:file', limit(ogLimiter), async (req, res, next) => {
    try {
      // Lazy id so a `-veiled` suffix is not swallowed into the id.
      const m = /^([a-z0-9-]{1,64}?)(-veiled)?\.jpg$/.exec(String(req.params.file));
      const kind = String(req.params.kind);
      if (!m || (kind !== 'catalog' && kind !== 'upload')) return next();
      const id = m[1]!;
      let source: string;
      if (kind === 'catalog') {
        if (!getCatalogImage(id)) return next();
        source = path.join(galleryDir, `${id}.webp`);
      } else {
        if (!UPLOAD_ID_PATTERN.test(id) || !opts.uploads.get(id)) return next();
        source = opts.uploads.filePath(id);
      }
      if (!existsSync(source)) return next();
      const veiled = m[2] !== undefined;
      const jpeg = await ogCache.get(`${kind}/${id}/${veiled ? 1 : 0}`, () => renderOgImage(source, { veiled }));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      // Chat apps and social sites show these images on their own pages.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type('image/jpeg').send(jpeg);
    } catch (err) {
      next(err);
    }
  });

  app.get('/robots.txt', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(robotsTxt(originFor(req)));
  });

  app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml(originFor(req)));
  });

  // Static client. Hashed assets are cached forever; everything else revalidates.
  const indexFile = path.join(opts.publicDir, 'index.html');
  if (existsSync(indexFile)) {
    const template = readFileSync(indexFile, 'utf8');
    if (!hasHeadBlock(template)) log.warn('index.html has no head:meta block; pages will share one title');
    app.use(
      '/assets',
      express.static(path.join(opts.publicDir, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }),
    );
    app.use(
      '/gallery',
      express.static(path.join(opts.publicDir, 'gallery'), { maxAge: '7d', index: false, redirect: false, fallthrough: false }),
    );
    app.use(express.static(opts.publicDir, { index: false, maxAge: '1h' }));
    // Single-page app: every route renders the client, with that page's title and link-preview tags.
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.includes('.')) return next();
      const meta = resolvePageMeta(req.path, { rooms: opts.rooms, shares: opts.shares });
      res.setHeader('Cache-Control', 'no-cache');
      res.status(meta.status).type('html').send(injectHead(template, renderHeadTags(meta, originFor(req), opts.verification)));
    });
  } else if (opts.isProduction) {
    log.warn('client build not found; run `npm run build`', { publicDir: opts.publicDir });
  }

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 500;
    if (status === 413) {
      res.status(413).json({ error: `Images must be smaller than ${Math.round(opts.uploadMaxBytes / 1024 / 1024)} MB.` });
      return;
    }
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request.' });
      return;
    }
    log.error('unhandled request error', { err: String(err) });
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}

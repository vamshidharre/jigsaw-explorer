import { existsSync } from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { isValidRoomCode, type CreateRoomResponse, type UploadResponse } from '../../shared/protocol';
import { UploadError, type UploadStore } from '../images/uploadStore';
import { log } from '../logger';
import { RoomError, type RoomManager } from '../rooms/RoomManager';
import { WindowRateLimiter } from '../util/rateLimit';
import { createRoomSchema } from '../ws/schemas';

export interface AppOptions {
  rooms: RoomManager;
  uploads: UploadStore;
  publicDir: string;
  uploadMaxBytes: number;
  trustProxy: number;
  isProduction: boolean;
}

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
  app.use(compression());

  const createLimiter = new WindowRateLimiter(20, 10 * 60_000);
  const uploadLimiter = new WindowRateLimiter(20, 10 * 60_000);
  const lookupLimiter = new WindowRateLimiter(120, 60_000);

  const limit = (limiter: WindowRateLimiter) => (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    if (limiter.take(key)) return next();
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
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

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);

  // Static client. Hashed assets are cached forever; everything else revalidates.
  if (existsSync(opts.publicDir)) {
    app.use(
      '/assets',
      express.static(path.join(opts.publicDir, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }),
    );
    app.use(
      '/gallery',
      express.static(path.join(opts.publicDir, 'gallery'), { maxAge: '7d', index: false, redirect: false, fallthrough: false }),
    );
    app.use(express.static(opts.publicDir, { index: false, maxAge: '1h' }));
    // Single-page app: unknown paths render the client, which shows its own 404.
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.includes('.')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(opts.publicDir, 'index.html'));
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

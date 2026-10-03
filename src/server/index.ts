import { createServer } from 'node:http';
import { Analytics } from './analytics/Analytics';
import { config } from './config';
import { createApp } from './http/app';
import { UploadStore } from './images/uploadStore';
import { log } from './logger';
import { RoomStore } from './persistence/roomStore';
import { RoomManager } from './rooms/RoomManager';
import { ShareStore } from './shares/ShareStore';
import { attachGateway } from './ws/gateway';

export async function startServer(overrides: Partial<typeof config> = {}) {
  const cfg = { ...config, ...overrides };
  const uploads = new UploadStore(cfg.dataDir, cfg.uploadStorageBytes);
  await uploads.init();
  const store = new RoomStore(cfg.dataDir);
  await store.init();
  const rooms = new RoomManager(uploads, store, {
    maxRooms: cfg.maxRooms,
    roomEmptyTtlMs: cfg.roomEmptyTtlMs,
    timings: { reconnectGraceMs: cfg.reconnectGraceMs },
  });
  await rooms.init();
  const shares = new ShareStore(cfg.dataDir, { ttlMs: cfg.shareTtlMs, maxShares: cfg.maxShares });
  await shares.init();
  const analytics = new Analytics(cfg.dataDir, cfg.analytics);
  await analytics.init();

  const app = createApp({
    rooms,
    uploads,
    shares,
    analytics,
    publicDir: cfg.publicDir,
    publicUrl: cfg.publicUrl,
    statsToken: cfg.statsToken,
    uploadMaxBytes: cfg.uploadMaxBytes,
    trustProxy: cfg.trustProxy,
    isProduction: cfg.isProduction,
  });
  const server = createServer(app);
  const wss = attachGateway(server, rooms, {
    allowedOrigins: cfg.allowedOrigins,
    maxConnectionsPerIp: cfg.maxConnectionsPerIp,
    trustProxy: cfg.trustProxy,
    onEvent: (event) => analytics.record(event),
  });

  const tick = setInterval(() => rooms.tick(), 50);
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    rooms
      .sweep()
      .catch((err) => log.error('sweep failed', { err: String(err) }))
      .finally(() => (sweeping = false));
  }, 5000);
  const cleanup = setInterval(() => {
    shares
      .sweep()
      .then(() => uploads.cleanup(cfg.uploadTtlMs, new Set([...rooms.uploadsInUse(), ...shares.uploadsInUse()])))
      .then((n) => n && log.info('removed expired uploads', { count: n }))
      .catch((err) => log.error('upload cleanup failed', { err: String(err) }));
  }, 30 * 60_000);
  const flushAnalytics = setInterval(() => void analytics.flush(), 60_000);

  await new Promise<void>((resolve) => server.listen(cfg.port, cfg.host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : cfg.port;
  log.info('server listening', { port, env: cfg.isProduction ? 'production' : 'development' });

  async function stop() {
    clearInterval(tick);
    clearInterval(sweep);
    clearInterval(cleanup);
    clearInterval(flushAnalytics);
    await rooms.shutdown();
    await analytics.flush();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
  }

  return { server, port, rooms, uploads, shares, analytics, stop };
}

const isEntry = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntry || process.env.JIGSAW_AUTOSTART === '1') {
  startServer()
    .then(({ stop }) => {
      let stopping = false;
      const shutdown = (signal: string) => {
        if (stopping) return;
        stopping = true;
        log.info('shutting down', { signal });
        const force = setTimeout(() => process.exit(1), 8000);
        stop()
          .then(() => {
            clearTimeout(force);
            process.exit(0);
          })
          .catch(() => process.exit(1));
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    })
    .catch((err) => {
      log.error('failed to start', { err: String(err) });
      process.exit(1);
    });
}

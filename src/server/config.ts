import path from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** Directory holding persisted rooms and uploaded images. */
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  /** Built client assets (served in production). */
  publicDir: path.resolve(process.env.PUBLIC_DIR ?? 'dist/client'),
  /** Comma separated list of extra origins allowed to open WebSockets. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Set when running behind a reverse proxy (Render, Fly, nginx) so client IPs are correct. */
  trustProxy: int('TRUST_PROXY', isProduction ? 1 : 0),
  maxRooms: int('MAX_ROOMS', 500),
  /** How long a room survives with nobody connected. */
  roomEmptyTtlMs: int('ROOM_EMPTY_TTL_MINUTES', 60) * 60_000,
  /** How long a disconnected player keeps their seat before being removed. */
  reconnectGraceMs: int('RECONNECT_GRACE_SECONDS', 60) * 1000,
  uploadMaxBytes: int('UPLOAD_MAX_MB', 15) * 1024 * 1024,
  uploadTtlMs: int('UPLOAD_TTL_HOURS', 48) * 3_600_000,
  maxConnectionsPerIp: int('MAX_CONNECTIONS_PER_IP', 24),
} as const;

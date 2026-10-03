import path from 'node:path';
import { INDEXNOW_KEY_PATTERN } from './seo/indexNow';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

/** Render sets RENDER=true for every service, also ones created without NODE_ENV. */
const onRender = process.env.RENDER === 'true';
const isProduction = process.env.NODE_ENV === 'production' || onRender;

/** Ownership tokens for search-engine webmaster tools. */
function verificationToken(name: string): string | null {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(raw)) throw new Error(`${name} must be the token only (letters, digits, - and _)`);
  return raw;
}

/** An absolute http(s) origin from an environment variable, or null. */
function originFrom(name: string): string | null {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Key for IndexNow search-engine submissions. It is public by design (served
 * at /<key>.txt), so a default lives in the code; INDEXNOW_KEY overrides it.
 */
const DEFAULT_INDEXNOW_KEY = '0402aa82c500cd3231b3ab65dc99512e';

function indexNowKey(): string {
  const raw = (process.env.INDEXNOW_KEY ?? '').trim() || DEFAULT_INDEXNOW_KEY;
  if (!INDEXNOW_KEY_PATTERN.test(raw)) throw new Error('INDEXNOW_KEY must be 8-128 letters, digits or dashes');
  return raw;
}

/** PUBLIC_URL without a trailing slash, e.g. `https://jigbee.com`. */
function publicUrl(): string | null {
  const raw = (process.env.PUBLIC_URL ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PUBLIC_URL must be an absolute URL such as https://jigbee.com');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('PUBLIC_URL must start with http:// or https://');
  return url.origin;
}

function statsToken(): string | null {
  const raw = (process.env.STATS_TOKEN ?? '').trim();
  if (!raw) return null;
  if (raw.length < 12) throw new Error('STATS_TOKEN must be at least 12 characters');
  return raw;
}

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
  /** Disk space all stored photos may use together. */
  uploadStorageBytes: int('UPLOAD_STORAGE_MB', 800) * 1024 * 1024,
  maxConnectionsPerIp: int('MAX_CONNECTIONS_PER_IP', 24),
  /** Canonical site origin for link previews and the sitemap (falls back to the request host). */
  publicUrl: publicUrl(),
  /** How long a shared puzzle link stays valid. */
  shareTtlMs: int('SHARE_TTL_DAYS', 30) * 86_400_000,
  maxShares: int('MAX_SHARES', 50_000),
  /** Cookie-free usage counting; set ANALYTICS=off to disable. */
  analytics: (process.env.ANALYTICS ?? 'on').toLowerCase() !== 'off',
  /** Access key for the /stats page; generated (and logged) at startup when unset. */
  statsToken: statsToken(),
  /** <meta> verification for Google Search Console and Bing Webmaster Tools. */
  googleSiteVerification: verificationToken('GOOGLE_SITE_VERIFICATION'),
  bingSiteVerification: verificationToken('BING_SITE_VERIFICATION'),
  /** The address the site is reached at from the internet: PUBLIC_URL, else Render's own URL. */
  externalUrl: publicUrl() ?? (onRender ? originFrom('RENDER_EXTERNAL_URL') : null),
  /** Submit public pages to IndexNow search engines after each deploy (production only). */
  indexNow: (process.env.INDEXNOW ?? 'on').toLowerCase() !== 'off',
  indexNowKey: indexNowKey(),
  indexNowEndpoint: process.env.INDEXNOW_ENDPOINT ?? 'https://api.indexnow.org/indexnow',
  /** Wait for the new version to receive traffic before submitting, so search engines can fetch the key file. */
  indexNowDelayMs: int('INDEXNOW_DELAY_SECONDS', 180) * 1000,
  /** Identifies the deployed version for IndexNow (Render sets RENDER_GIT_COMMIT). */
  deployId: process.env.RENDER_GIT_COMMIT ?? 'local',
  /** Ping the public URL every 10 minutes so a free Render instance never goes to sleep. */
  keepAwake: process.env.KEEP_AWAKE === '1',
} as const;

/**
 * Cookie-free usage counting. Only aggregate daily counts of a fixed set of
 * events are kept: no user ids, no IP addresses, no full URLs.
 */
import { getCatalogImage } from './catalog';

/** Events the browser reports. */
export const CLIENT_EVENTS = [
  'visit',
  'pageview',
  'solo_start',
  'solo_complete',
  'daily_start',
  'daily_complete',
  'result_share',
  'share_start',
] as const;

/** Events the server records itself. */
export const SERVER_EVENTS = ['room_create', 'room_join', 'room_complete', 'share_create', 'share_open', 'upload'] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export type ServerEvent = (typeof SERVER_EVENTS)[number];
export type AnalyticsEvent = ClientEvent | ServerEvent;

export const PAGE_TEMPLATES = [
  '/',
  '/puzzles',
  '/puzzle/:id',
  '/multiplayer',
  '/daily',
  '/create',
  '/embed/:id',
  '/room/:code',
  '/play/:id',
  '/s/:id',
  '/credits',
  '/stats',
  'other',
] as const;

/** Maps a pathname to a template so ids and room codes are never recorded. */
export function pageTemplate(pathname: string): (typeof PAGE_TEMPLATES)[number] {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/puzzles' || p === '/multiplayer' || p === '/daily' || p === '/create' || p === '/credits' || p === '/stats') return p;
  if (/^\/puzzle\/[^/]+$/.test(p)) return '/puzzle/:id';
  if (/^\/embed\/[^/]+$/.test(p)) return '/embed/:id';
  if (/^\/room\/[^/]+$/.test(p)) return '/room/:code';
  if (/^\/play\/[^/]+$/.test(p)) return '/play/:id';
  if (/^\/s\/[^/]+$/.test(p)) return '/s/:id';
  return 'other';
}

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Referrer label for a visit: a bare host name, or "direct". */
export function referrerLabel(referrer: string, ownHost: string): string {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, '')) return 'direct';
    return HOST_PATTERN.test(host) && host.length <= 100 ? host : 'other';
  } catch {
    return 'other';
  }
}

/** Label describing which picture a puzzle used: a catalogue id or "photo". */
export function puzzleLabel(image: { kind: string; id?: string }): string {
  return image.kind === 'catalog' && image.id && getCatalogImage(image.id) ? image.id : 'photo';
}

/** Validates the label sent with a client event; returns the label to store or null to reject. */
export function validClientLabel(event: ClientEvent, label: string | undefined): string | undefined | null {
  switch (event) {
    case 'pageview':
      return label && (PAGE_TEMPLATES as readonly string[]).includes(label) ? label : null;
    case 'visit':
      if (!label) return 'direct';
      return label === 'direct' || label === 'other' || (HOST_PATTERN.test(label) && label.length <= 100) ? label : null;
    case 'solo_start':
    case 'solo_complete':
      if (!label) return null;
      return label === 'photo' || getCatalogImage(label) ? label : null;
    default:
      return label === undefined ? undefined : null;
  }
}

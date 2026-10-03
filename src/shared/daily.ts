/**
 * The daily puzzle: everyone gets the same picture, cut the same way, on the
 * same calendar day. Days are identified by an ISO date key (`2026-10-03`);
 * the browser uses the player's local date, the server (link previews) UTC.
 */
import { CATALOG } from './catalog';
import { createRng, shuffle } from './rng';
import { gridForPieceCount, maxPiecesForImage, type PuzzleSpec } from './puzzle/spec';

/** Day #1. */
const EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DAILY_WEEKDAY_PIECES = 48;
export const DAILY_WEEKEND_PIECES = 96;

export interface DailyPuzzle {
  key: string;
  number: number;
  imageId: string;
  title: string;
  spec: PuzzleSpec;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date key for the player's local calendar day. */
export function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date key for the UTC calendar day. */
export function utcDayKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isDayKey(key: string): boolean {
  const m = KEY_PATTERN.exec(key);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return utcDayKey(new Date(t)) === key;
}

function keyToUtc(key: string): number {
  const m = KEY_PATTERN.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
}

export function addDays(key: string, days: number): string {
  return utcDayKey(new Date(keyToUtc(key) + days * DAY_MS));
}

export function dailyNumber(key: string): number {
  return daysBetween(utcDayKey(new Date(EPOCH)), key) + 1;
}

/** Bigger puzzles on Saturdays and Sundays. */
export function dailyPieceTarget(key: string): number {
  const weekday = new Date(keyToUtc(key)).getUTCDay();
  return weekday === 0 || weekday === 6 ? DAILY_WEEKEND_PIECES : DAILY_WEEKDAY_PIECES;
}

export function dailyPuzzle(key: string): DailyPuzzle {
  const number = dailyNumber(key);
  // Walk through the whole gallery in a shuffled order before repeating a picture.
  const ids = CATALOG.map((img) => img.id).sort();
  const index = Math.max(0, number - 1);
  const cycle = Math.floor(index / ids.length);
  const order = shuffle(createRng(0x5eed + cycle * 7919), ids);
  const imageId = order[index % ids.length]!;
  const image = CATALOG.find((img) => img.id === imageId)!;
  const target = Math.min(dailyPieceTarget(key), maxPiecesForImage(image.width, image.height));
  const grid = gridForPieceCount(target, image.width, image.height);
  const seed = (Math.imul(number + 1, 2654435761) ^ 0x2545f491) >>> 0;
  return {
    key,
    number,
    imageId,
    title: image.title,
    spec: { seed, cols: grid.cols, rows: grid.rows, width: image.width, height: image.height, rotation: false },
  };
}

/**
 * Streaks from the set of solved days. The current streak still counts
 * until the end of today even if today's puzzle is not solved yet.
 */
export function streaks(solved: ReadonlySet<string>, today: string): { current: number; best: number } {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of Array.from(solved).sort()) {
    run = prev !== null && daysBetween(prev, day) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  let current = 0;
  let cursor = solved.has(today) ? today : addDays(today, -1);
  while (solved.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

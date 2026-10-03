import { describe, expect, it } from 'vitest';
import { pageTemplate, puzzleLabel, referrerLabel, validClientLabel } from '../../src/shared/analytics';
import { pageTitle } from '../../src/shared/brand';
import { CATALOG } from '../../src/shared/catalog';
import {
  addDays,
  dailyNumber,
  dailyPuzzle,
  DAILY_WEEKDAY_PIECES,
  DAILY_WEEKEND_PIECES,
  daysBetween,
  isDayKey,
  localDayKey,
  streaks,
} from '../../src/shared/daily';
import { normalizeShareId, sanitizeText } from '../../src/shared/protocol';
import { isValidSpec } from '../../src/shared/puzzle/spec';

describe('daily puzzle', () => {
  it('numbers days from 1 January 2026', () => {
    expect(dailyNumber('2026-01-01')).toBe(1);
    expect(dailyNumber('2026-01-02')).toBe(2);
    expect(dailyNumber('2027-01-01')).toBe(366);
  });

  it('does date arithmetic across months, years and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-03')).toBe(2);
    expect(daysBetween('2026-10-03', '2026-10-01')).toBe(-2);
  });

  it('validates day keys', () => {
    expect(isDayKey('2026-10-03')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-1-3')).toBe(false);
    expect(isDayKey('../etc')).toBe(false);
    expect(isDayKey(localDayKey(new Date(2026, 9, 3)))).toBe(true);
    expect(localDayKey(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });

  it('gives everyone the same puzzle for a day', () => {
    const a = dailyPuzzle('2026-10-03');
    const b = dailyPuzzle('2026-10-03');
    expect(a).toEqual(b);
    expect(isValidSpec(a.spec)).toBe(true);
    expect(dailyPuzzle('2026-10-04').spec.seed).not.toBe(a.spec.seed);
  });

  it('shows every gallery picture once before repeating', () => {
    const seen = new Set<string>();
    for (let i = 0; i < CATALOG.length; i++) seen.add(dailyPuzzle(addDays('2026-01-01', i)).imageId);
    expect(seen.size).toBe(CATALOG.length);
  });

  it('uses bigger puzzles at weekends', () => {
    const pieces = (key: string) => {
      const p = dailyPuzzle(key);
      return p.spec.cols * p.spec.rows;
    };
    // 2026-10-03 is a Saturday, 2026-10-05 a Monday.
    expect(pieces('2026-10-03')).toBeGreaterThan(pieces('2026-10-05') * 1.5);
    for (let i = 0; i < 60; i++) {
      const key = addDays('2026-01-01', i);
      const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
      const target = weekday === 0 || weekday === 6 ? DAILY_WEEKEND_PIECES : DAILY_WEEKDAY_PIECES;
      expect(Math.abs(pieces(key) - target) / target).toBeLessThan(0.2);
    }
  });

  it('counts current and best streaks', () => {
    const solved = new Set(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-01', '2026-10-02']);
    // Today not solved yet: yesterday's streak still counts.
    expect(streaks(solved, '2026-10-03')).toEqual({ current: 2, best: 4 });
    expect(streaks(new Set([...solved, '2026-10-03']), '2026-10-03')).toEqual({ current: 3, best: 4 });
    // A missed day breaks the current streak.
    expect(streaks(solved, '2026-10-04')).toEqual({ current: 0, best: 4 });
    expect(streaks(new Set(), '2026-10-04')).toEqual({ current: 0, best: 0 });
  });
});

describe('usage counting labels', () => {
  it('maps paths to templates without ids', () => {
    expect(pageTemplate('/')).toBe('/');
    expect(pageTemplate('/daily/')).toBe('/daily');
    expect(pageTemplate('/room/ABC234')).toBe('/room/:code');
    expect(pageTemplate('/s/abcdefghij')).toBe('/s/:id');
    expect(pageTemplate('/play/g123')).toBe('/play/:id');
    expect(pageTemplate('/puzzle/great-wave')).toBe('/puzzle/:id');
    expect(pageTemplate('/wp-admin/x')).toBe('other');
  });

  it('reduces referrers to host names', () => {
    expect(referrerLabel('', 'jigbee.com')).toBe('direct');
    expect(referrerLabel('https://www.reddit.com/r/Jigsawpuzzles/comments/x?y=1', 'jigbee.com')).toBe('reddit.com');
    expect(referrerLabel('https://jigbee.com/daily', 'jigbee.com')).toBe('direct');
    expect(referrerLabel('not a url', 'jigbee.com')).toBe('other');
  });

  it('only accepts known labels', () => {
    expect(validClientLabel('pageview', '/daily')).toBe('/daily');
    expect(validClientLabel('pageview', '/room/ABC234')).toBeNull();
    expect(validClientLabel('visit', undefined)).toBe('direct');
    expect(validClientLabel('visit', 'news.ycombinator.com')).toBe('news.ycombinator.com');
    expect(validClientLabel('visit', '<script>')).toBeNull();
    expect(validClientLabel('solo_start', 'great-wave')).toBe('great-wave');
    expect(validClientLabel('solo_start', 'photo')).toBe('photo');
    expect(validClientLabel('solo_start', 'unknown-image')).toBeNull();
    expect(validClientLabel('daily_complete', undefined)).toBeUndefined();
    expect(validClientLabel('daily_complete', 'x')).toBeNull();
    expect(puzzleLabel({ kind: 'catalog', id: 'great-wave' })).toBe('great-wave');
    expect(puzzleLabel({ kind: 'upload', id: 'u123' })).toBe('photo');
  });
});

describe('share links and brand', () => {
  it('sanitises free text', () => {
    expect(sanitizeText('  Happy\n\nbirthday\u0000!  ', 140)).toBe('Happy birthday !');
    expect(sanitizeText('x'.repeat(300), 140)).toHaveLength(140);
  });

  it('extracts share ids from links', () => {
    expect(normalizeShareId('https://jigbee.com/s/AbCdEfGh12')).toBe('abcdefgh12');
    expect(normalizeShareId(' abcdefgh12 ')).toBe('abcdefgh12');
  });

  it('builds page titles', () => {
    expect(pageTitle()).toBe('Jigbee — Online jigsaw puzzles, solo or together');
    expect(pageTitle('Puzzles')).toBe('Puzzles — Jigbee');
  });
});

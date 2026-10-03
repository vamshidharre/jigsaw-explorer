/**
 * Aggregate usage counts per UTC day, e.g. `{ "2026-10-03": { "visit|direct": 12, "room_create|great-wave": 2 } }`.
 * Nothing identifying a person is stored. Counts live in memory and are
 * written to `analytics.json` in the data directory every minute.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyticsEvent } from '../../shared/analytics';
import { addDays, utcDayKey } from '../../shared/daily';
import { log } from '../logger';

const RETAIN_DAYS = 400;
/** Distinct labels kept per event per day; the rest are counted as "other". */
const MAX_LABELS = 300;

type DayCounts = Record<string, number>;

interface AnalyticsFile {
  version: 1;
  days: Record<string, DayCounts>;
}

export interface StatsDay {
  day: string;
  counts: DayCounts;
}

export class Analytics {
  private days: Record<string, DayCounts> = {};
  private dirty = false;
  private readonly file: string | null;

  constructor(
    dataDir: string | null,
    readonly enabled = true,
  ) {
    this.file = dataDir ? path.join(dataDir, 'analytics.json') : null;
  }

  async init(): Promise<void> {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as AnalyticsFile;
      if (data.version === 1 && data.days && typeof data.days === 'object') this.days = data.days;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('could not read analytics', { err: String(err) });
    }
  }

  record(event: AnalyticsEvent, label?: string, now = new Date()): void {
    if (!this.enabled) return;
    const day = (this.days[utcDayKey(now)] ??= {});
    let key = label ? `${event}|${label}` : event;
    if (label && day[key] === undefined) {
      const prefix = `${event}|`;
      let labels = 0;
      for (const k in day) if (k.startsWith(prefix)) labels++;
      if (labels >= MAX_LABELS) key = `${event}|other`;
    }
    day[key] = (day[key] ?? 0) + 1;
    this.dirty = true;
  }

  /** The last `count` days (oldest first), including days without activity. */
  report(count: number, now = new Date()): StatsDay[] {
    const today = utcDayKey(now);
    const out: StatsDay[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const day = addDays(today, -i);
      out.push({ day, counts: { ...(this.days[day] ?? {}) } });
    }
    return out;
  }

  async flush(now = new Date()): Promise<void> {
    if (!this.dirty || !this.file) return;
    const cutoff = addDays(utcDayKey(now), -RETAIN_DAYS);
    for (const day of Object.keys(this.days)) if (day < cutoff) delete this.days[day];
    this.dirty = false;
    try {
      const body: AnalyticsFile = { version: 1, days: this.days };
      await writeFile(`${this.file}.tmp`, JSON.stringify(body));
      await rename(`${this.file}.tmp`, this.file);
    } catch (err) {
      this.dirty = true;
      log.error('could not write analytics', { err: String(err) });
    }
  }
}

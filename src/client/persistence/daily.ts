/**
 * Daily puzzle results and streaks, kept in localStorage. Only the first
 * completion of a day counts (that is the time people share).
 */
import { streaks, type DailyPuzzle } from '../../shared/daily';
import { BRAND } from '../../shared/brand';
import { formatDuration } from '../lib/format';

const KEY = 'jigsaw.daily.v1';

export interface DailyResult {
  ms: number;
  moves: number;
  pieces: number;
  completedAt: number;
}

export interface DailyStats {
  played: number;
  currentStreak: number;
  bestStreak: number;
  bestMs: number | null;
}

export function dailyResults(): Record<string, DailyResult> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { results?: Record<string, DailyResult> };
    return raw.results && typeof raw.results === 'object' ? raw.results : {};
  } catch {
    return {};
  }
}

export function dailyResult(key: string): DailyResult | null {
  return dailyResults()[key] ?? null;
}

/** Stores the first completion of a day; returns the stored result. */
export function recordDailyResult(key: string, result: DailyResult): DailyResult {
  const results = dailyResults();
  if (results[key]) return results[key];
  results[key] = result;
  try {
    localStorage.setItem(KEY, JSON.stringify({ results }));
  } catch {
    // Storage full or blocked: the result still shows for this session.
  }
  return result;
}

export function dailyStats(today: string, results = dailyResults()): DailyStats {
  const { current, best } = streaks(new Set(Object.keys(results)), today);
  const times = Object.values(results).map((r) => r.ms);
  return { played: Object.keys(results).length, currentStreak: current, bestStreak: best, bestMs: times.length ? Math.min(...times) : null };
}

export function dailyShareText(puzzle: DailyPuzzle, result: DailyResult, streak: number, url: string): string {
  const lines = [`${BRAND.name} daily #${puzzle.number} 🧩`, `${result.pieces} pieces in ${formatDuration(result.ms)}`];
  if (streak > 1) lines.push(`🔥 ${streak}-day streak`);
  lines.push(url);
  return lines.join('\n');
}

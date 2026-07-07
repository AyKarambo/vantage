/**
 * Rollups for the self-rated 0–100 performance slider (issue #44 part 1):
 * rating over time, the win/loss self-read split, and per-hero/per-map
 * averages. Pure and I/O-free; computed from the FILTERED game set (these are
 * ordinary analytics, unlike the filter-independent readiness verdict).
 *
 * Conventions: a multi-hero match's single rating counts toward each hero
 * played (whole-count, mirroring `byHero`); empties are ABSENT/null, never 0.
 */

import type { GameRecord } from './types';
import { dayKey } from './grouping';

export interface PerformanceBucket {
  key: string;
  /** Mean self-rating over the rated games in this bucket (1 decimal). */
  avg: number;
  /** Rated games behind the average. */
  rated: number;
}

export interface PerformanceTrendPoint {
  date: string;
  avg: number;
  games: number;
}

export interface PerformanceStats {
  /** Rated games in range — 0 means every surface shows its empty state. */
  ratedGames: number;
  /** Per-day mean rating, ascending (only days with ≥1 rated game). */
  trend: PerformanceTrendPoint[];
  /** Mean self-rating on wins / on losses (draws excluded); null when that bucket has no rated games. */
  winAvg: number | null;
  lossAvg: number | null;
  byHero: PerformanceBucket[];
  byMap: PerformanceBucket[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function avgOf(list: GameRecord[]): number | null {
  if (list.length === 0) return null;
  return round1(list.reduce((a, g) => a + (g.performance ?? 0), 0) / list.length);
}

function buckets(rated: GameRecord[], keysOf: (g: GameRecord) => string[]): PerformanceBucket[] {
  const acc = new Map<string, { sum: number; rated: number }>();
  for (const g of rated) {
    for (const key of keysOf(g)) {
      const slot = acc.get(key) ?? { sum: 0, rated: 0 };
      slot.sum += g.performance ?? 0;
      slot.rated += 1;
      acc.set(key, slot);
    }
  }
  return [...acc.entries()]
    .map(([key, { sum, rated: n }]) => ({ key, avg: round1(sum / n), rated: n }))
    .sort((a, b) => b.rated - a.rated);
}

/** Compute the performance-rating rollups over an (already filtered) game set. */
export function performanceStats(games: GameRecord[]): PerformanceStats {
  const rated = games
    .filter((g) => typeof g.performance === 'number')
    .sort((a, b) => a.timestamp - b.timestamp);

  const byDay = new Map<string, { sum: number; games: number }>();
  for (const g of rated) {
    const key = dayKey(g.timestamp);
    const slot = byDay.get(key) ?? { sum: 0, games: 0 };
    slot.sum += g.performance ?? 0;
    slot.games += 1;
    byDay.set(key, slot);
  }

  return {
    ratedGames: rated.length,
    trend: [...byDay.entries()]
      .map(([date, { sum, games: n }]) => ({ date, avg: round1(sum / n), games: n }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    winAvg: avgOf(rated.filter((g) => g.result === 'Win')),
    lossAvg: avgOf(rated.filter((g) => g.result === 'Loss')),
    byHero: buckets(rated, (g) => (g.heroes.length ? g.heroes : ['Unknown'])),
    byMap: buckets(rated, (g) => [g.map]),
  };
}

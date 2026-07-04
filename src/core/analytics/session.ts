/**
 * Session-level reads over the game list: the current streak, the latest-day
 * recap, the activity calendar, and the per-hero drill-down.
 * Pure and I/O-free — consumed by both main and the browser preview.
 */
import type { GameRecord, Streak } from './types';
import { byMap, dayKey, winLoss } from './grouping';
import { heroStats } from './heroStats';

/** Current win/loss streak from the most recent decided games. */
export function streak(games: GameRecord[]): Streak {
  const decided = [...games].filter((g) => g.result !== 'Draw').sort((a, b) => b.timestamp - a.timestamp);
  if (!decided.length) return { type: 'none', count: 0 };
  const type = decided[0].result === 'Win' ? 'W' : 'L';
  let count = 0;
  for (const g of decided) {
    if ((g.result === 'Win' ? 'W' : 'L') === type) count++;
    else break;
  }
  return { type, count };
}

/** Recap for the most recent day that has games. */
export function latestSession(games: GameRecord[]) {
  if (!games.length) return null;
  const latest = games.reduce((m, g) => Math.max(m, g.timestamp), 0);
  const day = dayKey(latest);
  const dayGames = games.filter((g) => dayKey(g.timestamp) === day);
  return { date: day, ...winLoss(dayGames), streak: streak(dayGames), topMaps: byMap(dayGames).slice(0, 3) };
}

/** Per-day games + winrate for the last `days` calendar days (heatmap). */
export function calendar(games: GameRecord[], days = 35): Array<{ date: string; games: number; winrate: number | null }> {
  const map = new Map<string, GameRecord[]>();
  for (const g of games) {
    const k = dayKey(g.timestamp);
    (map.get(k) ?? map.set(k, []).get(k)!).push(g);
  }
  const out: Array<{ date: string; games: number; winrate: number | null }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    const gs = map.get(k) ?? [];
    out.push({ date: k, games: gs.length, winrate: gs.length ? winLoss(gs).winrate : null });
  }
  return out;
}

/** One day header + its games (the Matches screen's grouped list). */
export interface DayGroup<T> {
  /** dayKey of the group, newest group first. */
  key: string;
  /** 'Today' / 'Yesterday' for the two most recent days, else the raw key. */
  label: string;
  wins: number;
  losses: number;
  items: T[];
}

/** Group timestamped result rows under day headers (newest day first). */
export function groupByDay<T extends { timestamp: number; result: string }>(
  rows: T[],
  now: number = Date.now(),
): Array<DayGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => b.timestamp - a.timestamp)) {
    const k = dayKey(r.timestamp);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : key,
    wins: items.filter((r) => r.result === 'Win').length,
    losses: items.filter((r) => r.result === 'Loss').length,
    items,
  }));
}

/** The previous day's coach-style recap (the Overview card). */
export interface SessionRecap {
  date: string;
  wins: number;
  losses: number;
  net: number;
  winrate: number;
  games: number;
  bestMap?: string;
  worstMap?: string;
  flags: { tilt: number; toxicMates: number; leaver: number; positiveComms: number };
  /** Hit-rate over that day's graded targets; absent when nothing was graded. */
  targetHitRate?: number;
}

/**
 * Recap of the previous calendar day (shown once on the next day's first
 * open). Null when yesterday had no games. Works over the UNFILTERED history —
 * the recap is about the player's day, not the current filter scope.
 */
export function sessionRecap(games: GameRecord[], now: number = Date.now()): SessionRecap | null {
  const date = dayKey(now - 86_400_000);
  const day = games.filter((g) => dayKey(g.timestamp) === date);
  if (!day.length) return null;

  const wl = winLoss(day);
  const maps = byMap(day).filter((m) => m.games > 0);
  const byWr = [...maps].sort((a, b) => b.winrate - a.winrate);

  const flags = { tilt: 0, toxicMates: 0, leaver: 0, positiveComms: 0 };
  for (const g of day) {
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
      if (g.mental?.[key] || g.review?.flags?.[key]) flags[key]++;
    }
  }

  let hits = 0;
  let attempts = 0;
  for (const g of day) {
    for (const grade of Object.values(g.review?.grades ?? {})) {
      attempts++;
      if (grade === 'hit') hits++;
    }
  }

  return {
    date,
    wins: wl.wins,
    losses: wl.losses,
    net: wl.wins - wl.losses,
    winrate: wl.winrate,
    games: day.length,
    ...(byWr.length >= 2 ? { bestMap: byWr[0].key, worstMap: byWr[byWr.length - 1].key } : {}),
    flags,
    ...(attempts ? { targetHitRate: hits / attempts } : {}),
  };
}

/** Drill-down for one hero: overall, per-map, recent games, exact stats. */
export function heroDetail(games: GameRecord[], hero: string) {
  const gs = games.filter((g) => g.heroes.includes(hero)).sort((a, b) => b.timestamp - a.timestamp);
  return {
    hero,
    overall: winLoss(gs),
    byMap: byMap(gs).slice(0, 12),
    recent: gs.slice(0, 10).map((g) => ({ map: g.map, role: g.role, result: g.result, account: g.account, timestamp: g.timestamp })),
    stats: heroStats(gs).find((h) => h.hero === hero) ?? null,
  };
}

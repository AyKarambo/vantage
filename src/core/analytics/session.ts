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

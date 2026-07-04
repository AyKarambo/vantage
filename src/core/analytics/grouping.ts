/**
 * Win/loss aggregation and grouping: slices completed games by map, role,
 * account, hero, mode or time bucket — the building blocks of every dashboard
 * chart. Pure and I/O-free — consumed by both main and the browser preview.
 */
import type { GameRecord, WinLoss, Group, FocusItem } from './types';

// --- core aggregation -------------------------------------------------------

/** Tally wins/losses/draws and the winrate (0..1, draws excluded) over a set of games. */
export function winLoss(games: GameRecord[]): WinLoss {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const g of games) {
    if (g.result === 'Win') wins++;
    else if (g.result === 'Loss') losses++;
    else draws++;
  }
  const decided = wins + losses;
  return { games: games.length, wins, losses, draws, winrate: decided ? wins / decided : 0 };
}

/** Group games by a key and compute win/loss per group, sorted by most games. */
export function groupBy(games: GameRecord[], keyOf: (g: GameRecord) => string): Group[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) {
    const k = keyOf(g) || 'Unknown';
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(g);
  }
  return [...buckets.entries()]
    .map(([key, gs]) => ({ key, ...winLoss(gs) }))
    .sort((a, b) => b.games - a.games);
}

/** Winrate per map. */
export const byMap = (g: GameRecord[]) => groupBy(g, (x) => x.map);
/** Winrate per role queue. */
export const byRole = (g: GameRecord[]) => groupBy(g, (x) => x.role);
/** Winrate per tracked account. */
export const byAccount = (g: GameRecord[]) => groupBy(g, (x) => x.account);

/** Hero winrate by counting each game toward every hero the player used in it. */
export function byHero(games: GameRecord[]): Group[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) {
    for (const hero of g.heroes.length ? g.heroes : ['Unknown']) {
      (buckets.get(hero) ?? buckets.set(hero, []).get(hero)!).push(g);
    }
  }
  return [...buckets.entries()]
    .map(([key, gs]) => ({ key, ...winLoss(gs) }))
    .sort((a, b) => b.games - a.games);
}

/**
 * "Focus" ranking — where you're losing more than winning. Net = losses − wins;
 * highest net first. This is the dashboard's "what to work on" signal.
 */
export function focusBy(
  games: GameRecord[],
  keyOf: (g: GameRecord) => string,
  minGames = 3,
): FocusItem[] {
  return groupBy(games, keyOf)
    .filter((g) => g.games >= minGames)
    .map((g) => ({ ...g, net: g.losses - g.wins }))
    .sort((a, b) => b.net - a.net);
}

/** Winrate trend bucketed by day or ISO week. */
export function trend(games: GameRecord[], bucket: 'day' | 'week' = 'day'): Group[] {
  const sorted = [...games].sort((a, b) => a.timestamp - b.timestamp);
  return groupBy(sorted, (g) => bucketLabel(g.timestamp, bucket)).sort((a, b) =>
    a.key < b.key ? -1 : 1,
  );
}

/** Winrate per game type (Competitive, Quick Play, …). */
export const byMode = (g: GameRecord[]): Group[] => groupBy(g, (x) => x.gameType);

/** UTC calendar-day key (YYYY-MM-DD) — the shared day-bucketing convention. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// --- helpers ----------------------------------------------------------------

function bucketLabel(ts: number, bucket: 'day' | 'week'): string {
  const d = new Date(ts);
  if (bucket === 'day') return d.toISOString().slice(0, 10);
  // ISO week label YYYY-Www
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

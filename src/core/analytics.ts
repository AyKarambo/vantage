import type { Result, Role, HeroStat } from './model';

/**
 * Analytics layer: turns a list of completed games into the aggregates the
 * dashboard charts and the "what to focus on" insights are built from.
 *
 * Pure and I/O-free so it is fully unit-testable and reusable in the renderer.
 */

export type { HeroStat };

/**
 * Manual (◎) after-game self-report — the "mental" signals the game never
 * reports. All optional; absent means the player didn't flag anything.
 */
export interface MatchMental {
  tilt?: boolean;
  toxicMates?: boolean;
  leaver?: boolean;
  positiveComms?: boolean;
}

/** One finished game, already resolved to display values. */
export interface GameRecord {
  matchId: string;
  timestamp: number; // ms epoch (match end)
  account: string;
  role: Role;
  map: string;
  result: Result;
  gameType: string;
  durationMinutes?: number;
  heroes: string[];
  /** Per-hero breakdown for the local player (from GEP roster), if available. */
  perHero?: HeroStat[];
  /** Manual self-report captured in the Log Match card, if the player added one. */
  mental?: MatchMental;
}

export interface WinLoss {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins / decided games (draws excluded), 0..1. */
  winrate: number;
}

export interface Group extends WinLoss {
  key: string;
}

/** Net losses = losses − wins. Positive ⇒ a weakness worth focusing on. */
export interface FocusItem extends WinLoss {
  key: string;
  net: number;
}

export interface HeroSummary extends WinLoss {
  hero: string;
  role?: Role;
  totals: Omit<HeroStat, 'hero' | 'role'>;
  /** Per-10-minute averages (null when no duration data). */
  per10: Pick<HeroStat, 'eliminations' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'> | null;
  kda: number; // (elims + assists) / max(deaths, 1)
}

// --- core aggregation -------------------------------------------------------

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

export const byMap = (g: GameRecord[]) => groupBy(g, (x) => x.map);
export const byRole = (g: GameRecord[]) => groupBy(g, (x) => x.role);
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

/** Exact per-hero stats for the local player, aggregated across games. */
export function heroStats(games: GameRecord[]): HeroSummary[] {
  const totals = new Map<string, HeroStat & { games: number; wins: number; losses: number; minutes: number }>();

  for (const g of games) {
    const decidedWin = g.result === 'Win' ? 1 : 0;
    const decidedLoss = g.result === 'Loss' ? 1 : 0;
    const minutes = g.durationMinutes ?? 0;
    const rows: HeroStat[] = g.perHero?.length
      ? g.perHero
      : g.heroes.map((hero) => ({ hero, role: g.role, eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 }));

    const sharedMinutes = rows.length ? minutes / rows.length : 0;
    for (const r of rows) {
      const t = totals.get(r.hero) ?? {
        hero: r.hero, role: r.role, eliminations: 0, deaths: 0, assists: 0,
        damage: 0, healing: 0, mitigation: 0, games: 0, wins: 0, losses: 0, minutes: 0,
      };
      t.role = t.role ?? r.role;
      t.eliminations += r.eliminations;
      t.deaths += r.deaths;
      t.assists += r.assists;
      t.damage += r.damage;
      t.healing += r.healing;
      t.mitigation += r.mitigation;
      t.games += 1;
      t.wins += decidedWin;
      t.losses += decidedLoss;
      t.minutes += sharedMinutes;
      totals.set(r.hero, t);
    }
  }

  return [...totals.values()]
    .map((t) => {
      const decided = t.wins + t.losses;
      const per10 = t.minutes > 0 ? scale(t, 10 / t.minutes) : null;
      return {
        hero: t.hero,
        role: t.role,
        games: t.games,
        wins: t.wins,
        losses: t.losses,
        draws: t.games - decided,
        winrate: decided ? t.wins / decided : 0,
        totals: {
          eliminations: t.eliminations, deaths: t.deaths, assists: t.assists,
          damage: t.damage, healing: t.healing, mitigation: t.mitigation,
        },
        per10,
        kda: (t.eliminations + t.assists) / Math.max(t.deaths, 1),
      } as HeroSummary;
    })
    .sort((a, b) => b.games - a.games);
}

export const byMode = (g: GameRecord[]): Group[] => groupBy(g, (x) => x.gameType);

/** Current win/loss streak from the most recent decided games. */
export function streak(games: GameRecord[]): { type: 'W' | 'L' | 'none'; count: number } {
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

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// --- helpers ----------------------------------------------------------------

function scale(t: HeroStat, f: number) {
  return {
    eliminations: round1(t.eliminations * f),
    deaths: round1(t.deaths * f),
    assists: round1(t.assists * f),
    damage: Math.round(t.damage * f),
    healing: Math.round(t.healing * f),
    mitigation: Math.round(t.mitigation * f),
  };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

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

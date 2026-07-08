/**
 * Cross-dimension focus derivation — the "work on these" hub behind the Focus
 * screen. Merges net-losing maps, heroes and roles into one ranked list, adds
 * a per-entry trend verdict (is it getting better or worse?), and links entries
 * to authored improvement targets so the screen can show whether focusing is
 * actually working. Pure and I/O-free — consumed by dashboardData.
 */
import { byHero, focusBy, winLoss } from './grouping';
import type { FocusDimension, FocusEntry, FocusItem, FocusTrend, GameRecord } from './types';

/** Per-dimension minimum sample before a group can be flagged. Roles are only
 *  four broad buckets, so they get a higher floor than maps/heroes. */
const MIN_GAMES: Record<FocusDimension, number> = { map: 3, hero: 3, role: 5 };

/** Merged-list cap — enough to fill the screen, short enough to stay a priority list. */
const MAX_ENTRIES = 12;

/** A trend needs at least this many games to split into two meaningful halves. */
const TREND_MIN_GAMES = 6;

/** Winrate dead-band (0..1) within which a trend reads 'flat'. */
const TREND_DEADBAND = 0.05;

/** The games that count toward one focus entry (a game counts toward every hero played in it). */
export function focusGamesFor(games: GameRecord[], dimension: FocusDimension, key: string): GameRecord[] {
  if (dimension === 'map') return games.filter((g) => g.map === key);
  if (dimension === 'role') return games.filter((g) => g.role === key);
  return games.filter((g) => g.heroes.includes(key));
}

/**
 * The cross-dimension "work on these" ranking: net-losing (net > 0) maps,
 * heroes and roles merged into one list, tagged by dimension, worst deficit
 * first (ties: more games first), capped at {@link MAX_ENTRIES}. Entries with
 * enough games in range also carry a {@link FocusTrend} verdict.
 */
export function focusEntries(games: GameRecord[]): FocusEntry[] {
  const tagged: FocusEntry[] = [
    ...withDimension(focusBy(games, (g) => g.map, MIN_GAMES.map), 'map'),
    ...withDimension(focusByHero(games, MIN_GAMES.hero), 'hero'),
    ...withDimension(focusBy(games, (g) => g.role, MIN_GAMES.role), 'role'),
  ];
  return tagged
    .filter((e) => e.net > 0)
    .sort((a, b) => b.net - a.net || b.games - a.games)
    .slice(0, MAX_ENTRIES)
    .map((e) => {
      const trend = focusTrend(focusGamesFor(games, e.dimension, e.key));
      return trend ? { ...e, trend } : e;
    });
}

/**
 * Recent-half vs earlier-half winrate verdict over one entry's games. Needs
 * ≥{@link TREND_MIN_GAMES} games; a winrate move within ±{@link TREND_DEADBAND}
 * reads 'flat'. Draws are excluded by the winrate itself (see {@link winLoss}).
 */
export function focusTrend(entryGames: GameRecord[]): FocusTrend | undefined {
  if (entryGames.length < TREND_MIN_GAMES) return undefined;
  const sorted = [...entryGames].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const delta = winLoss(sorted.slice(mid)).winrate - winLoss(sorted.slice(0, mid)).winrate;
  if (Math.abs(delta) <= TREND_DEADBAND) return 'flat';
  return delta > 0 ? 'improving' : 'declining';
}

// --- helpers ----------------------------------------------------------------

/**
 * Hero variant of {@link focusBy}: a game counts toward every hero played in it
 * (same convention as {@link byHero}). The 'Unknown' placeholder bucket (games
 * logged without heroes) is dropped — a placeholder can't be practiced.
 */
function focusByHero(games: GameRecord[], minGames: number): FocusItem[] {
  return byHero(games)
    .filter((g) => g.key !== 'Unknown' && g.games >= minGames)
    .map((g) => ({ ...g, net: g.losses - g.wins }))
    .sort((a, b) => b.net - a.net);
}

function withDimension(items: FocusItem[], dimension: FocusDimension): FocusEntry[] {
  return items.map((i) => ({ ...i, dimension }));
}

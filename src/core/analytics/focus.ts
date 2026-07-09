/**
 * Cross-dimension focus derivation — the "work on these" hub behind the Focus
 * screen. Merges net-losing maps, heroes and roles into one ranked list, adds
 * a per-entry trend verdict (is it getting better or worse?), and links entries
 * to authored improvement targets so the screen can show whether focusing is
 * actually working. Pure and I/O-free — consumed by dashboardData.
 */
import { byHero, focusBy, winLoss } from './grouping';
import type { FocusDimension, FocusEntry, FocusItem, FocusTrend, GameRecord, WinLoss } from './types';
import type { AuthoredTarget } from '../targets/types';
// Leaf import (not the '../targets' barrel) — the barrel's scoring path imports
// analytics back, and this keeps the module graph cycle-free at runtime.
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';

/** Per-dimension minimum sample before a group can be flagged. Roles are only
 *  four broad buckets, so they get a higher floor than maps/heroes. */
const MIN_GAMES: Record<FocusDimension, number> = { map: 3, hero: 3, role: 5 };

/** Merged-list cap — enough to fill the screen, short enough to stay a priority list. */
const MAX_ENTRIES = 12;

/** A trend needs at least this many games to split into two meaningful halves. */
const TREND_MIN_GAMES = 6;

/** Winrate dead-band (0..1) within which a trend reads 'flat'. */
const TREND_DEADBAND = 0.05;

/** Decided games needed on each side of the flag instant before a delta is shown. */
const PROGRESS_MIN_DECIDED = 3;

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
 * reads 'flat'. Both halves need at least one decided game — {@link winLoss}
 * falls back to a 0% winrate for an all-draw half, which would otherwise
 * fabricate a verdict from a baseline that was never actually measured.
 */
export function focusTrend(entryGames: GameRecord[]): FocusTrend | undefined {
  if (entryGames.length < TREND_MIN_GAMES) return undefined;
  const sorted = [...entryGames].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const earlier = winLoss(sorted.slice(0, mid));
  const recent = winLoss(sorted.slice(mid));
  if (decided(earlier) === 0 || decided(recent) === 0) return undefined;
  // Compare in whole points to dodge IEEE-754 wobble (e.g. 0.55 - 0.5 landing
  // a hair above 0.05) right at the dead-band boundary.
  const pts = Math.round((recent.winrate - earlier.winrate) * 1000) / 10;
  if (Math.abs(pts) <= TREND_DEADBAND * 100) return 'flat';
  return pts > 0 ? 'improving' : 'declining';
}

/**
 * Attach since-flagged progress to every entry that has a linked improvement
 * target: an active, non-archived authored target whose name mentions the entry
 * key (case-insensitive; the Notion bookkeeping pseudo-target never links).
 * `allGames` should be the UNFILTERED competitive history — progress is about
 * the target's lifetime, not the current filter (same stance as staleness).
 */
export function linkFocusTargets(
  entries: FocusEntry[],
  targets: AuthoredTarget[],
  allGames: GameRecord[],
): FocusEntry[] {
  const candidates = targets.filter(
    (t) => t.isActive && !t.archivedAt && t.id !== NOTION_IMPROVEMENT_TARGET_ID,
  );
  if (!candidates.length) return entries;
  return entries.map((e) => {
    const target = linkedTarget(e, candidates);
    if (!target) return e;
    const since = target.activatedAt ?? target.createdAt;
    const entryGames = focusGamesFor(allGames, e.dimension, e.key);
    const before = winLoss(entryGames.filter((g) => g.timestamp < since));
    const after = winLoss(entryGames.filter((g) => g.timestamp >= since));
    const withDelta = decided(before) >= PROGRESS_MIN_DECIDED && decided(after) >= PROGRESS_MIN_DECIDED;
    return {
      ...e,
      progress: {
        targetId: target.id,
        targetName: target.name,
        since,
        gamesSince: after.games,
        ...(withDelta ? { deltaPts: Math.round((after.winrate - before.winrate) * 1000) / 10 } : {}),
      },
    };
  });
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

/**
 * Most recently flagged candidate whose name mentions the entry key as a whole
 * token run. Both sides tokenize to lowercase alphanumeric words (apostrophes
 * elided so "King’s"/"King's"/"Kings" match alike; every other separator splits
 * a token), and the key's tokens must appear *contiguously* in the name — so
 * casing, apostrophe style and spacing never break a real link, while a short
 * key can no longer match across unrelated words (e.g. hero "Ana" against
 * "Plan a warmup routine"). A role prefill written with the display label
 * ("Open Q") still links the `openQ` role key via its camelCase-split variant.
 */
function linkedTarget(entry: FocusEntry, candidates: AuthoredTarget[]): AuthoredTarget | undefined {
  const needles = keyNeedles(entry.key, entry.dimension);
  if (!needles.length) return undefined;
  return candidates
    .filter((t) => {
      const name = tokenize(t.name);
      return needles.some((needle) => includesTokenRun(name, needle));
    })
    .sort((a, b) => (b.activatedAt ?? b.createdAt) - (a.activatedAt ?? a.createdAt))[0];
}

/**
 * The token runs that count as a link for an entry key. Maps/heroes match on
 * their own tokens only; a role also matches its camelCase-split display form
 * ("openQ" → ["open", "q"]), because a quick-created role target is named with
 * the display label ("Practice Open Q …").
 */
function keyNeedles(key: string, dimension: FocusDimension): string[][] {
  const base = tokenize(key);
  if (!base.length) return [];
  if (dimension !== 'role') return [base];
  const split = tokenize(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  return split.join(' ') === base.join(' ') ? [base] : [base, split];
}

/** Lowercase alphanumeric tokens; apostrophes are elided rather than split on. */
const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** Does `needle` appear as a contiguous run of tokens inside `haystack`? */
function includesTokenRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((tok, j) => haystack[i + j] === tok)) return true;
  }
  return false;
}

const decided = (wl: WinLoss): number => wl.wins + wl.losses;

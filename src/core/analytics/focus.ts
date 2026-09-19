/**
 * Cross-dimension focus derivation — the "work on these" hub behind the Focus
 * screen. Ranks net-losing maps, heroes and roles (net = losses − wins) by a
 * sample-aware deficit score (H1), adds a per-entry trend verdict (is it
 * getting better or worse?), and links entries to authored improvement
 * targets so the screen can show whether focusing is actually working. Pure
 * and I/O-free — consumed by dashboardData.
 */
import { focusBy, srSum, winLoss } from './grouping';
import { wilson } from '../targets/wilson';
import { heroMatchKey } from '../heroes';
import type { FocusDimension, FocusEntry, FocusItem, FocusTrend, GameRecord, HeroForm, WinLoss } from './types';
import type { AuthoredTarget } from '../targets/types';
// Leaf import (not the '../targets' barrel) — the barrel's scoring path imports
// analytics back, and this keeps the module graph cycle-free at runtime.
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';

/** Minimum sample before a map can be flagged. Exported for the F2 first-week unlock ladder, which states this floor rather than hardcoding a copy of it. */
export const MAP_MIN_GAMES = 3;

/**
 * Minimum sample before a hero or role can be flagged (H1) — higher than the
 * map floor because a hero/role bucket pools far more games than any one map,
 * so a low floor here would surface noise faster than it surfaces signal.
 */
const HERO_MIN_GAMES = 8;
const ROLE_MIN_GAMES = 8;

/** Per-dimension list cap — three short sections beat one long undifferentiated list. */
const MAX_PER_DIMENSION = 6;

/** Top-N heroes attached to a map entry's per-hero record (H2). */
const MAP_TOP_HEROES = 3;

/** A trend needs at least this many games to split into two meaningful halves. */
const TREND_MIN_GAMES = 6;

/** Winrate dead-band (0..1) within which a trend reads 'flat'. */
const TREND_DEADBAND = 0.05;

/** Decided games needed on each side of the flag instant before a delta is shown. */
const PROGRESS_MIN_DECIDED = 3;

/** Last-N-games window for {@link heroForm} (H6). */
const FORM_WINDOW = 10;

/** The games that count toward one focus entry (a game counts toward every hero played in it). */
export function focusGamesFor(games: GameRecord[], dimension: FocusDimension, key: string): GameRecord[] {
  if (dimension === 'map') return games.filter((g) => g.map === key);
  if (dimension === 'role') return games.filter((g) => g.role === key);
  return games.filter((g) => g.heroes.includes(key));
}

export interface FocusEntriesOptions {
  /**
   * In-pool lookup for map entries (H1), same injection convention as
   * `mapModeOf` elsewhere — a map the lookup marks inactive still gets a row
   * (history stays visible) but sorts behind every in-pool row. Absent (or
   * the lookup itself returning nothing) reads as in-pool, matching master
   * data's own "missing isActive ⇒ active" convention.
   */
  isMapActive?: (map: string) => boolean;
  /** Placement-run match ids to exclude from every dimension's net-SR sum (C2) — passed through to `groupBy`/`focusBy`. */
  suppressed?: ReadonlySet<string>;
}

/**
 * The "work on these" ranking (H1): net-losing (net > 0) maps, heroes AND
 * roles, each dimension ranked separately by a sample-aware deficit —
 * `net × (0.5 − Wilson-lower-bound(winrate))`, so a real deficit backed by a
 * big sample outranks a same-sized deficit that's really just a small,
 * unreliable sample — and capped at {@link MAX_PER_DIMENSION} per dimension
 * (three short sections, not one list one dimension can crowd out). Map
 * entries additionally carry {@link FocusEntry.heroes} (H2) and
 * {@link FocusEntry.inPool} (H1, in-pool rows sort first within the maps
 * section). Entries with enough games in range also carry a
 * {@link FocusTrend} verdict and its point delta.
 */
export function focusEntries(games: GameRecord[], opts: FocusEntriesOptions = {}): FocusEntry[] {
  const withTrend = (e: FocusEntry): FocusEntry => {
    const detail = focusTrendDetail(focusGamesFor(games, e.dimension, e.key));
    return detail ? { ...e, trend: detail.trend, trendPts: detail.pts } : e;
  };

  const rank = (entries: FocusEntry[]): FocusEntry[] =>
    entries
      .filter((e) => e.net > 0)
      .sort((a, b) => {
        const aPool = a.inPool !== false;
        const bPool = b.inPool !== false;
        if (aPool !== bPool) return aPool ? -1 : 1;
        return sampleAwareDeficit(b) - sampleAwareDeficit(a);
      })
      .slice(0, MAX_PER_DIMENSION)
      .map(withTrend);

  const mapEntries = rank(
    withDimension(focusByMap(games, opts.suppressed), 'map').map((e) => ({
      ...e,
      heroes: topHeroesFor(focusGamesFor(games, 'map', e.key)),
      inPool: opts.isMapActive ? opts.isMapActive(e.key) : true,
    })),
  );
  const heroEntries = rank(withDimension(focusByHero(games, opts.suppressed), 'hero'));
  const roleEntries = rank(withDimension(focusBy(games, (g) => g.role, ROLE_MIN_GAMES, { suppressed: opts.suppressed }), 'role'));

  return [...roleEntries, ...heroEntries, ...mapEntries];
}

/**
 * Sample-aware deficit score (H1): `net × (0.5 − Wilson-lower-bound(winrate))`.
 * A losing record backed by a big sample has a Wilson lower bound close to its
 * true (low) winrate, so `0.5 − low` stays large; the same observed winrate on
 * a tiny sample has a wide interval that pulls the lower bound down toward 0
 * regardless of `n`, so the factor caps near the same ceiling either way —
 * `net` (which DOES scale with sample size) is what keeps a real, well-evidenced
 * deficit ranked above a same-net entry that's really just a coin-flip sample.
 */
function sampleAwareDeficit(e: FocusItem): number {
  const decidedGames = e.wins + e.losses;
  if (decidedGames === 0) return 0;
  return e.net * (0.5 - wilson(e.wins, decidedGames).low);
}

/** Recent-half vs earlier-half winrate verdict plus the raw point delta behind it. */
interface FocusTrendDetail {
  trend: FocusTrend;
  pts: number;
}

/**
 * Recent-half vs earlier-half winrate verdict over one entry's games. Needs
 * ≥{@link TREND_MIN_GAMES} games; a winrate move within ±{@link TREND_DEADBAND}
 * reads 'flat'. Both halves need at least one decided game — {@link winLoss}
 * falls back to a 0% winrate for an all-draw half, which would otherwise
 * fabricate a verdict from a baseline that was never actually measured.
 */
function focusTrendDetail(entryGames: GameRecord[]): FocusTrendDetail | undefined {
  if (entryGames.length < TREND_MIN_GAMES) return undefined;
  const sorted = [...entryGames].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const earlier = winLoss(sorted.slice(0, mid));
  const recent = winLoss(sorted.slice(mid));
  if (decided(earlier) === 0 || decided(recent) === 0) return undefined;
  // Compare in whole points to dodge IEEE-754 wobble (e.g. 0.55 - 0.5 landing
  // a hair above 0.05) right at the dead-band boundary.
  const pts = Math.round((recent.winrate - earlier.winrate) * 1000) / 10;
  const trend = Math.abs(pts) <= TREND_DEADBAND * 100 ? 'flat' : pts > 0 ? 'improving' : 'declining';
  return { trend, pts };
}

/** Public trend-only read — the {@link FocusTrendDetail} wrapper used everywhere that only needs the verdict (Heroes table/drawer, H6). */
export function focusTrend(entryGames: GameRecord[]): FocusTrend | undefined {
  return focusTrendDetail(entryGames)?.trend;
}

/**
 * How many distinct maps have reached {@link MAP_MIN_GAMES} (F4) — the honest
 * gate behind Focus's and Overview's empty states, so "no net-losing maps"
 * only ever means what it says rather than also standing in for "no map has
 * enough games to judge yet". Same 'Unknown'-excluding, floor-filtered
 * definition of a qualified map the Focus ranking itself uses.
 */
export function qualifiedMapCount(games: GameRecord[]): number {
  return focusByMap(games).length;
}

/**
 * Recent-form window for one dimension entry's games (H6): the last
 * {@link FORM_WINDOW} DECIDED whole games, oldest → newest, plus how that
 * window's winrate compares to the full (filtered) range behind it. Draws are
 * excluded from both the strip and the winrate math — same "decided" meaning
 * {@link focusTrend} and the Focus progress line already use.
 */
export function heroForm(entryGames: GameRecord[]): HeroForm | undefined {
  const decidedGames = entryGames
    .filter((g) => g.result === 'Win' || g.result === 'Loss')
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!decidedGames.length) return undefined;
  const window = decidedGames.slice(-FORM_WINDOW);
  const rangeWinrate = winLoss(decidedGames).winrate;
  const windowWinrate = winLoss(window).winrate;
  return {
    results: window.map((g) => g.result),
    // The window covering the WHOLE range has no distinct "earlier" games to
    // read a delta against.
    ...(window.length < decidedGames.length
      ? { deltaPp: Math.round((windowWinrate - rangeWinrate) * 1000) / 10 }
      : {}),
  };
}

/**
 * Attach since-flagged progress to every entry that has a linked improvement
 * target: an active, non-archived target scoped (R9) to the entry's own
 * map/role/hero, or — for targets authored before scoped linking existed —
 * one whose name mentions the entry key (case-insensitive; see
 * {@link linkedTarget}). The Notion bookkeeping pseudo-target never links.
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
 * Map variant of {@link focusBy} that drops the 'Unknown' placeholder bucket
 * (games logged without a map id) — a placeholder can't be practiced.
 */
function focusByMap(games: GameRecord[], suppressed?: ReadonlySet<string>): FocusItem[] {
  return focusBy(games, (g) => g.map, MAP_MIN_GAMES, { suppressed }).filter((g) => g.key !== 'Unknown');
}

/**
 * Hero variant of {@link focusBy} (H1): unlike a map or a role, a game can
 * belong to SEVERAL heroes at once (a swap), so this can't reuse `groupBy`'s
 * one-key-per-game bucketing — every hero in `g.heroes` gets the whole game's
 * result, the same "which games count toward this entry" rule
 * {@link focusGamesFor} already applies to hero rows elsewhere.
 */
function focusByHero(games: GameRecord[], suppressed?: ReadonlySet<string>): FocusItem[] {
  const buckets = new Map<string, GameRecord[]>();
  for (const g of games) {
    for (const hero of g.heroes) {
      (buckets.get(hero) ?? buckets.set(hero, []).get(hero)!).push(g);
    }
  }
  return [...buckets.entries()]
    .map(([key, gs]) => {
      const wl = winLoss(gs);
      return { key, ...wl, net: wl.losses - wl.wins, ...srSum(gs.map((game) => ({ game, weight: 1 })), suppressed) };
    })
    .filter((e) => e.games >= HERO_MIN_GAMES)
    .sort((a, b) => b.net - a.net);
}

/**
 * The top {@link MAP_TOP_HEROES} heroes played in a map entry's games, by
 * game count, each with its own PER-GAME win/loss record (H2) — deliberately
 * per-game credit (every hero in a game earns the whole result), not the
 * Heroes screen's time-share credit, since a swap segment isn't "most of the
 * game" on either hero the way time-share reasons about it.
 */
function topHeroesFor(entryGames: GameRecord[]): Array<{ hero: string; wins: number; losses: number }> {
  const tally = new Map<string, { games: number; wins: number; losses: number }>();
  for (const g of entryGames) {
    for (const h of g.heroes) {
      const t = tally.get(h) ?? { games: 0, wins: 0, losses: 0 };
      t.games += 1;
      if (g.result === 'Win') t.wins += 1;
      else if (g.result === 'Loss') t.losses += 1;
      tally.set(h, t);
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, MAP_TOP_HEROES)
    .map(([hero, t]) => ({ hero, wins: t.wins, losses: t.losses }));
}

function withDimension(items: FocusItem[], dimension: FocusDimension): FocusEntry[] {
  return items.map((i) => ({ ...i, dimension }));
}

/**
 * Most recently flagged candidate linked to this entry. Prefers a target
 * SCOPED (R9) to the entry's own map/role/hero — exact, and immune to a
 * later rename breaking the link. Falls back to the legacy name-token match
 * only among targets that carry NO scope for this dimension at all, so a
 * target authored before scoped linking existed keeps working off its name
 * while a target deliberately scoped AWAY from this entry (e.g. re-scoped
 * from Busan to Ilios) never links back in just because its old name still
 * says "Busan".
 */
function linkedTarget(entry: FocusEntry, candidates: AuthoredTarget[]): AuthoredTarget | undefined {
  const scoped = candidates.filter((t) => scopeLinksEntry(t, entry));
  const pool = scoped.length
    ? scoped
    : candidates.filter((t) => !hasDimensionScope(t, entry.dimension) && nameLinksEntry(t, entry));
  return pool.sort((a, b) => (b.activatedAt ?? b.createdAt) - (a.activatedAt ?? a.createdAt))[0];
}

/** Does `target`'s own scope (R9) name this entry's dimension key directly? */
function scopeLinksEntry(t: AuthoredTarget, entry: FocusEntry): boolean {
  if (entry.dimension === 'map') return t.mapScope?.includes(entry.key) ?? false;
  if (entry.dimension === 'role') return t.roleScope === entry.key;
  const key = heroMatchKey(entry.key);
  return t.heroScope?.some((h) => heroMatchKey(h) === key) ?? false;
}

/** Does `target` carry an explicit scope for this dimension at all (matching or not)? Gates the name-token fallback — a target that opted into scoping a dimension must link by scope or not at all. */
function hasDimensionScope(t: AuthoredTarget, dimension: FocusDimension): boolean {
  if (dimension === 'map') return !!t.mapScope && t.mapScope.length > 0;
  if (dimension === 'role') return t.roleScope != null;
  return !!t.heroScope && t.heroScope.length > 0;
}

/**
 * Legacy fallback: does `target`'s NAME mention the entry key as a whole token
 * run? Both sides tokenize to lowercase alphanumeric words (apostrophes
 * elided so "King’s"/"King's"/"Kings" match alike; every other separator splits
 * a token), and the key's tokens must appear *contiguously* in the name — so
 * casing, apostrophe style and spacing never break a real link, while a short
 * key can no longer match across unrelated words (e.g. hero "Ana" against
 * "Plan a warmup routine"). A role prefill written with the display label
 * ("Open Q") still links the `openQ` role key via its camelCase-split variant.
 */
function nameLinksEntry(t: AuthoredTarget, entry: FocusEntry): boolean {
  const needles = keyNeedles(entry.key, entry.dimension);
  if (!needles.length) return false;
  const name = tokenize(t.name);
  return needles.some((needle) => includesTokenRun(name, needle));
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

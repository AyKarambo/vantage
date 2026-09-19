/**
 * The one typed facade over localStorage for UI preferences, so storage keys
 * and shapes never scatter across modules. Same hardening as the filter
 * persistence: storage failures degrade to defaults, never throw.
 */
import type { DashboardFilters, PlayerRelation } from '../../src/shared/contract';
import { migrateLegacySeasonDays } from '../../src/core/season';
import type { WinrateScheme } from './winrateScheme';

export interface HeroSortPref {
  key: string;
  dir: 1 | -1;
}

export interface LogPrefillPref {
  role: string;
  /** Last account logged against (carries over like role). */
  account?: string;
}

export interface FilterPresetPref {
  name: string;
  /** Migrated `DashboardFilters` — no `mode`/`account` participation (spec D4). */
  filters: Required<DashboardFilters>;
}

/** How a Matches-list field is displayed: not at all, inline in the meta line, or its own column. */
export type MatchFieldMode = 'hidden' | 'inline' | 'column';

/** The subset of `MatchRow` fields the "Customize view" control can toggle. */
export type MatchColumnKey =
  | 'role' | 'heroes' | 'account' | 'srDelta' | 'rankAtStart' | 'duration' | 'finalScore'
  | 'performance' | 'measuredGrades' | 'flags' | 'party';

export type MatchColumnsPref = Record<MatchColumnKey, MatchFieldMode>;

/**
 * Default Matches-list field layout — matches the pre-customization look. The
 * grades-oriented fields (performance, target grades, flags — issue #68) default
 * to `hidden`, so rows are unchanged until the user opts in; a stored pref from
 * before they existed merges over this default and reads them as `hidden` too.
 */
export const MATCH_COLUMNS_DEFAULT: MatchColumnsPref = {
  heroes: 'inline', account: 'inline', srDelta: 'inline',
  role: 'hidden', rankAtStart: 'hidden', duration: 'hidden', finalScore: 'hidden',
  performance: 'hidden', measuredGrades: 'hidden', flags: 'hidden', party: 'hidden',
};

/** Every persisted UI preference; add fields here, not new storage keys. */
interface PrefsShape {
  /** Last active top-level view — restored on launch. */
  view: string;
  /** Heroes table sort choice. */
  heroSort: HeroSortPref;
  /** Heroes table minimum-games filter. */
  minGames: number;
  /** Players table sort choice — its own key; the Heroes table's is unrelated. */
  playerSort: HeroSortPref;
  /** Players table minimum-shared-games filter. */
  minPlayerGames: number;
  /** Players table team-relation filter (M6). */
  playerRelation: PlayerRelation;
  /** Maps ranking minimum-games filter (H4). */
  minMapGames: number;
  /** Maps ranking mode filter (H4) — a `byMapType` key, or absent for "All". */
  mapModeFilter: string;
  /** Last quick-log inputs (role only — map, hero, result stay fresh). */
  logPrefill: LogPrefillPref;
  /** Saved filter combinations. */
  filterPresets: FilterPresetPref[];
  /** `endedAt` of the last-session debrief the player collapsed (S3) — re-expands once a newer sitting closes. */
  recapShown: string;
  /** Active winrate colour scheme (Appearance). Applied at bundle load in `theme.ts`. */
  winrateScheme: WinrateScheme;
  /**
   * @deprecated Superseded by {@link winrateScheme}. Retained read-only so the
   * one-time migration in `theme.ts` (`resolveWinrateScheme`) can map a legacy
   * `true` to the `colorblind` scheme; never written anymore.
   */
  colorblind?: boolean;
  /** Matches-list per-field display mode, merged over `MATCH_COLUMNS_DEFAULT`. */
  matchColumns: MatchColumnsPref;
  /** Matches-list grouping (S4) — calendar day (default) or gap-based sitting. */
  matchGrouping: 'day' | 'sitting';
  /** How many "most played" heroes the Log Match hero picker shortlists (default 6, clamped 3-15). */
  suggestedHeroCount: number;
  /**
   * Sidebar collapse state (W7): `'auto'` (default, fresh install) follows
   * the window width — collapsed to an icon-only rail below ~1180px, expanded
   * above it; `'open'`/`'collapsed'` is an explicit pin the user set via the
   * toggle or `Ctrl+B`, which opts out of the width-driven behavior entirely
   * (today's toggle already sticks until clicked again — this only adds the
   * width-responsive default for someone who has never touched it). A legacy
   * boolean value is migrated once: `true` → `'collapsed'`, `false` → `'auto'`
   * (see `prefs.get`'s migration branch).
   */
  sidebarCollapsed: 'auto' | 'open' | 'collapsed';
  /**
   * Dismissed the Overview "first-week unlock ladder" card (F2). Reset to
   * `false` every time the demo season actually retires (`shell.ts`'s
   * `demoTransition` check), so it reappears if that genuinely happens again
   * — deleting your only real game brings the demo season back, and a later
   * first real game deserves the same announcement, not permanent silence
   * from one earlier dismissal.
   */
  firstRealGameBannerDismissed: boolean;
  /**
   * List density (W7) — `comfortable` (default) or `compact`, tightening
   * table-row and card padding for more on screen at once. Applied via the
   * `data-density` attribute at bundle load, same idiom as `winrateScheme`.
   */
  density: 'comfortable' | 'compact';
}

const PREFIX = 'vantagePref.';

/**
 * One-time-migration marker for the `heroSort` direction-inversion fix (K1):
 * `dataTable`'s comparator used to sort `dir: -1` ASCENDING although the
 * header drew a descending arrow for it, so a value persisted before the fix
 * means the opposite of what `dir` says today. A dedicated flag, checked
 * before the "was a value stored" branch, so a brand-new user who sets
 * `heroSort` for the first time AFTER the fix is never later flipped by a
 * read that mistakes "no flag yet" for "needs migrating".
 */
const HERO_SORT_MIGRATED_KEY = PREFIX + 'heroSortMigratedV2';

/** Default suggested-hero-count when the user hasn't set one. */
export const DEFAULT_SUGGESTED_HEROES = 6;
const SUGGESTED_HEROES_MIN = 3;
const SUGGESTED_HEROES_MAX = 15;

/** Clamp a suggested-hero-count input to the supported range. */
export function clampSuggestedHeroCount(n: number): number {
  return Math.min(SUGGESTED_HEROES_MAX, Math.max(SUGGESTED_HEROES_MIN, Math.round(n)));
}

/**
 * Strip legacy `mode`/`account` keys a preset may still carry from before
 * D1/D3, and translate a legacy `days: 'season'` sentinel the same way
 * `store.ts`'s `vantageFilters` load does (spec D2) — otherwise applying such
 * a preset feeds the untranslated string into `applyFilters`, which computes
 * a NaN cutoff and empties every view for the session.
 */
function migratePresetFilters(filters: Required<DashboardFilters>): Required<DashboardFilters> {
  const { role, days } = filters as DashboardFilters;
  const migratedDays = (days as unknown) === 'season' ? migrateLegacySeasonDays(Date.now()) : (days ?? 30);
  return { role: role ?? 'all', days: migratedDays } as Required<DashboardFilters>;
}

export const prefs = {
  get<K extends keyof PrefsShape>(key: K): PrefsShape[K] | undefined {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (key === 'heroSort' && localStorage.getItem(HERO_SORT_MIGRATED_KEY) !== '1') {
        try { localStorage.setItem(HERO_SORT_MIGRATED_KEY, '1'); } catch { /* ignore — retried next read */ }
        if (raw != null) {
          try {
            const old = JSON.parse(raw) as HeroSortPref;
            const migrated: HeroSortPref = { key: old.key, dir: old.dir === 1 ? -1 : 1 };
            localStorage.setItem(PREFIX + key, JSON.stringify(migrated));
            return migrated as PrefsShape[K];
          } catch {
            /* unparseable — fall through to the normal parse below, which will also fail safely */
          }
        }
      }
      if (raw == null) return undefined;
      const value = JSON.parse(raw) as PrefsShape[K];
      if (key === 'filterPresets') {
        const presets = value as FilterPresetPref[];
        const migrated = presets.map((p) => ({ ...p, filters: migratePresetFilters(p.filters) }));
        // Rewrite immediately so an old preset's `mode`/`account` don't linger in
        // storage past the first read (spec D4: "rewritten to the new shape").
        if (JSON.stringify(migrated) !== JSON.stringify(presets)) {
          try {
            localStorage.setItem(PREFIX + key, JSON.stringify(migrated));
          } catch {
            /* storage unavailable — migration just won't stick this run */
          }
        }
        return migrated as PrefsShape[K];
      }
      if (key === 'matchColumns') {
        return { ...MATCH_COLUMNS_DEFAULT, ...(value as MatchColumnsPref) } as PrefsShape[K];
      }
      // A legacy boolean sticks around until this read rewrites it (W7):
      // `true` (collapsed) migrates to the explicit pin `'collapsed'`,
      // `false` to `'auto'` — the new width-responsive default, since a plain
      // "not collapsed" carried no opinion about staying that way at any width.
      if (key === 'sidebarCollapsed' && typeof value === 'boolean') {
        const migrated = value ? 'collapsed' : 'auto';
        try { localStorage.setItem(PREFIX + key, JSON.stringify(migrated)); } catch { /* migration just won't stick this run */ }
        return migrated as PrefsShape[K];
      }
      return value;
    } catch {
      return undefined;
    }
  },
  set<K extends keyof PrefsShape>(key: K, value: PrefsShape[K]): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable — the preference just won't stick */
    }
  },
  remove(key: keyof PrefsShape): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

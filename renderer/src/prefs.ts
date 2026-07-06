/**
 * The one typed facade over localStorage for UI preferences, so storage keys
 * and shapes never scatter across modules. Same hardening as the filter
 * persistence: storage failures degrade to defaults, never throw.
 */
import type { DashboardFilters } from '../../src/shared/contract';
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
export type MatchColumnKey = 'role' | 'heroes' | 'account' | 'srDelta' | 'duration' | 'finalScore';

export type MatchColumnsPref = Record<MatchColumnKey, MatchFieldMode>;

/** Default Matches-list field layout — matches the pre-customization look. */
export const MATCH_COLUMNS_DEFAULT: MatchColumnsPref = {
  heroes: 'inline', account: 'inline', srDelta: 'inline',
  role: 'hidden', duration: 'hidden', finalScore: 'hidden',
};

/** Every persisted UI preference; add fields here, not new storage keys. */
interface PrefsShape {
  /** Last active top-level view — restored on launch. */
  view: string;
  /** Heroes table sort choice. */
  heroSort: HeroSortPref;
  /** Heroes table minimum-games filter. */
  minGames: number;
  /** Last quick-log inputs (role only — map, hero, result stay fresh). */
  logPrefill: LogPrefillPref;
  /** Saved filter combinations. */
  filterPresets: FilterPresetPref[];
  /** Day-key of the last session recap shown (one per day). */
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
}

const PREFIX = 'vantagePref.';

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

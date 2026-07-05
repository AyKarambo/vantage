/**
 * The one typed facade over localStorage for UI preferences, so storage keys
 * and shapes never scatter across modules. Same hardening as the filter
 * persistence: storage failures degrade to defaults, never throw.
 */
import type { DashboardFilters } from '../../src/shared/contract';

export interface HeroSortPref {
  key: string;
  dir: 1 | -1;
}

export interface LogPrefillPref {
  role: string;
  mode: string;
  /** Last account logged against (carries over like role/mode). */
  account?: string;
}

export interface FilterPresetPref {
  name: string;
  filters: Required<DashboardFilters>;
}

/** Every persisted UI preference; add fields here, not new storage keys. */
interface PrefsShape {
  /** Last active top-level view — restored on launch. */
  view: string;
  /** Heroes table sort choice. */
  heroSort: HeroSortPref;
  /** Heroes table minimum-games filter. */
  minGames: number;
  /** Last quick-log inputs (role/mode only — map, hero, result stay fresh). */
  logPrefill: LogPrefillPref;
  /** Saved filter combinations. */
  filterPresets: FilterPresetPref[];
  /** Day-key of the last session recap shown (one per day). */
  recapShown: string;
  /** Colorblind-safe palette toggle. */
  colorblind: boolean;
}

const PREFIX = 'vantagePref.';

export const prefs = {
  get<K extends keyof PrefsShape>(key: K): PrefsShape[K] | undefined {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? undefined : (JSON.parse(raw) as PrefsShape[K]);
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

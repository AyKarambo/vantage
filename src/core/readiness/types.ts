/**
 * Public types for the readiness / training-load model. All are plain data
 * (no `any`) so they cross the typed IPC contract unchanged.
 */

/** Traffic-light verdict. `insufficient-data` = not enough history to judge. */
export type ReadinessBand =
  | 'fresh'
  | 'steady'
  | 'loaded'
  | 'in-the-hole'
  | 'recovering'
  | 'insufficient-data';

/** What the coach suggests. `rest-1-2-days` is the only strong ask. */
export type ReadinessRecommendation = 'none' | 'ease-up' | 'rest-1-2-days';

/** How much the model trusts its own read (driven by history density + mental coverage). */
export type ReadinessConfidence = 'low' | 'medium' | 'high';

/** A single human-readable contributing reason. Severity drives colour, capped for outcome signals. */
export interface ReadinessSignal {
  key: string;
  label: string;
  severity: 'ok' | 'watch' | 'high';
}

/** The behavioural-load numbers surfaced to the UI. */
export interface ReadinessLoad {
  /** Mean games/day over the acute window (absolute volume). */
  acutePerDay: number;
  /** Smoothed games/day baseline (EWMA over the chronic window). */
  chronicPerDay: number;
  /** acute:chronic ratio (1.0 = on baseline). Neutralised to 1 when the baseline is too thin to trust. */
  ratio: number;
  /** Consecutive active days ending at the last active day, no rest day between. */
  consecutiveDays: number;
  /** Whole rest days since the last game (0 = played today). */
  restDays: number;
  /** Games in the most recent session. */
  lastSessionGames: number;
  /** Length of the most recent session in minutes (null when unknown). */
  lastSessionMinutes: number | null;
}

/** One point on the readiness trend chart. `score` is null on days with no prior history. */
export interface ReadinessTrendPoint {
  date: string;
  score: number | null;
  games: number;
}

/** The full readiness read for one player, computed from their whole history. */
export interface ReadinessSummary {
  band: ReadinessBand;
  /** 0..100 (higher = fresher). Null when the band is insufficient-data or stale. */
  score: number | null;
  confidence: ReadinessConfidence;
  /** One-line verdict, e.g. "You're grinding into the hole". */
  headline: string;
  recommendation: ReadinessRecommendation;
  /** Plain-language recommendation, empty when recommendation is `none`. */
  recommendationText: string;
  /** Top contributors, most-severe first. */
  signals: ReadinessSignal[];
  load: ReadinessLoad;
  trend: ReadinessTrendPoint[];
}

/** Persisted feature settings. */
export interface ReadinessSettings {
  enabled: boolean;
  /** Fire a one-time tray toast at app launch when the verdict is red. */
  launchToast: boolean;
}

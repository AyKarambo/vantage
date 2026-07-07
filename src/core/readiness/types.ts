/**
 * Public types for the readiness / training-load model. All are plain data
 * (no `any`) so they cross the typed IPC contract unchanged.
 */

/** Traffic-light verdict. `rusty` = undertrained (long layoff), `insufficient-data` = not enough history to judge. */
export type ReadinessBand =
  | 'fresh'
  | 'steady'
  | 'loaded'
  | 'in-the-hole'
  | 'recovering'
  | 'rusty'
  | 'insufficient-data';

/** What the coach suggests. `rest-1-2-days` is the only strong ask; `ramp-back-up` is the undertraining nudge. */
export type ReadinessRecommendation = 'none' | 'ease-up' | 'rest-1-2-days' | 'ramp-back-up';

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
  /** Active days per week over the chronic window — the play-frequency read. */
  activeDaysPerWeek: number;
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

/** What dominates a sub-100 score: grinding (overload) or a layoff (rust). Bands read differently per driver. */
export type ReadinessDriver = 'overload' | 'rust' | 'neutral';

/** One signal family's pull on the composite score. */
export interface ReadinessSubscore {
  /** Signed contribution to the score (0 = neutral). Bounds double as the family's weight. */
  delta: number;
  /** False when the family had no usable data (nothing was fabricated). */
  available: boolean;
  /** 0..1 data coverage behind the read, where meaningful (stats/mental). */
  coverage?: number;
}

/** The three signal families behind the composite (exposed so the UI can show WHY). */
export interface ReadinessSubscores {
  load: ReadinessSubscore;
  performance: ReadinessSubscore;
  subjective: ReadinessSubscore;
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
  /** The three families' pulls on the score (subscore breakdown UI). */
  subscores: ReadinessSubscores;
  /** Dominant driver behind a sub-neutral score (overload vs rust). */
  driver: ReadinessDriver;
  trend: ReadinessTrendPoint[];
}

/** Persisted feature settings. */
export interface ReadinessSettings {
  enabled: boolean;
  /** Fire a one-time tray toast at app launch when the verdict is red. */
  launchToast: boolean;
}

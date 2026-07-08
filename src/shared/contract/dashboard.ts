/**
 * Dashboard DTOs of the IPC contract: the filter set plus everything the
 * dashboard renderer draws for it. Electron-free so main, preload and the
 * renderer bundle can all share it.
 */
import type { Role, Result } from '../../core/model';
import type { WinLoss, Group, FocusItem, FocusEntry, HeroSummary, PerformanceStats, SessionRecap, Streak, TargetGrade } from '../../core/analytics';
import type { MentalSummary, MatchFlagKey } from '../../core/mental';
import type { Progression } from '../../core/progression';
import type { TargetSummary } from '../../core/targets';
import type { StalenessSettings } from '../../core/staleness';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { ReadinessSummary, ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import type { DemoPreference } from '../../core/demoPreference';
import type { MasterData } from './masterData';

/** The filters every view is scoped by, chosen in the app shell. */
export interface DashboardFilters {
  account?: string; // 'all' or account name
  role?: string; // 'all' | tank | damage | support | openQ
  /** N-day window | all time | a specific season (addressed by its stable id). */
  days?: number | 'all' | { season: string };
}

/**
 * Recap of the current (gap-based) sitting for the sidebar "Current session"
 * card — the trailing run of games with no gap longer than the configured
 * threshold, ending at the most recent one. `date` is the calendar day of the
 * most recent game in the sitting.
 */
export interface Session extends WinLoss {
  date: string;
  streak: Streak;
  topMaps: Group[];
}

/** One cell of the activity heatmap. */
export interface CalendarDay {
  date: string;
  games: number;
  winrate: number | null;
}

// Re-exported so renderer/main keep importing match-row vocabulary from the contract.
export type { MatchFlagKey };

/** A single match for the Matches list. */
export interface MatchRow {
  matchId: string;
  timestamp: number;
  account: string;
  role: Role;
  map: string;
  mapType: string;
  result: Result;
  gameType: string;
  heroes: string[];
  durationMinutes?: number;
  /** Signed SR change for this match, when known. */
  srDelta?: number;
  /** Final score as recorded (e.g. '3–1'), when known. */
  finalScore?: string;
  /**
   * Self-rated performance for this match, 0-100, when the player (or an import)
   * set one. Carried so the Review card's "How you played" slider seeds from an
   * already-rated match instead of reading "Not rated" — a rating can exist
   * without a target-grade review (file/Notion imports set only this).
   */
  performance?: number;
  /** Merged mental flags (quick-log OR review source) — only true keys are present. */
  flags?: Partial<Record<MatchFlagKey, true>>;
  /**
   * Auto-graded measured (⚡) targets for this match, shown read-only on the
   * Review screen: target id → the derived grade + underlying per-10/ratio value,
   * or `'no-stat'` when the match can't measure it. Only populated for the
   * currently-active measured targets on the review inbox rows.
   */
  measuredGrades?: Record<string, { grade: TargetGrade; value: number } | 'no-stat'>;
}

/** Everything the dashboard needs for the current filter set. */
export interface DashboardData {
  /** Effective demo display: the sample season is shown (demo opted-in AND no real history). */
  isSample: boolean;
  /** The user's first-run demo choice; 'unset' drives the first-run prompt. */
  demoPreference: DemoPreference;
  /** Whether the user has any real tracked matches (independent of the demo season). */
  hasRealHistory: boolean;
  generatedAt: number;
  filters: { account: string; role: string; days: number | 'all' | { season: string } };
  options: {
    accounts: string[];
    roles: Role[];
    /** Season filter options, newest first; the current season is always included. */
    seasons: Array<{ id: string; label: string }>;
  };
  greetingName: string;
  overall: WinLoss;
  streak: Streak;
  /** Winrate-derived heuristic estimate (the fallback rank). */
  progression: Progression;
  /**
   * The user's actual calculated rank for the greeting account's most-played
   * anchored role — the "real" rank the sidebar/KPI show. Absent when no rank
   * anchor is set for that account, in which case {@link progression} (the
   * winrate heuristic) is the fallback.
   */
  primaryRank?: {
    account: string;
    role: Role;
    tier: string;
    division: number;
    progressPct: number;
    protected: boolean;
    needsReanchor: boolean;
  };
  session: Session | null;
  byRole: Group[];
  byAccount: Group[];
  byMap: Group[];
  byMapType: Group[];
  byHero: Group[];
  trend: Group[];
  /** Winrate per local day-part (Morning/Afternoon/Evening/Night). */
  timeOfDay: Group[];
  /** Winrate by game number within a session ('1'..'5', '6+'). */
  sessionPosition: Group[];
  calendar: CalendarDay[];
  /** Map-only ranking that annotates the Overview scatter ("Top priority" callout). */
  focusMaps: FocusItem[];
  /**
   * The Focus screen's cross-dimension "work on these" list: net-losing maps,
   * heroes and roles merged, ranked and capped, with trend + linked-target
   * progress attached. Already net>0-filtered.
   */
  focusItems: FocusEntry[];
  heroStats: HeroSummary[];
  matches: MatchRow[];
  mental: MentalSummary;
  /** Self-rated performance rollups over the FILTERED range (issue #44 analytics). */
  performance: PerformanceStats;
  targets: TargetSummary[];
  /** Ungraded tracked games, newest first — ALWAYS unfiltered (the inbox source). */
  reviewInbox: MatchRow[];
  /** Total ungraded count (the badge) — unfiltered and uncapped. */
  pendingReviews: number;
  /**
   * The effective editable master data (heroes/maps/seasons) — bundled defaults
   * ⊕ the user's overrides. Rides on the dashboard payload so renderer views
   * (log-match typeahead, match-detail dropdown, overview scatter) read the
   * live catalog from `ctx.data.masterData` instead of static imports.
   */
  masterData: MasterData;
  /** The effective break-reminder settings, so views render synchronously. */
  breakReminder: BreakReminderSettings;
  /** Effective staleness thresholds for the active-target rotation cue, so the Targets view renders synchronously. */
  staleness: StalenessSettings;
  /** Readiness / training-load verdict — computed over the UNFILTERED history (fatigue is per-person). */
  readiness: ReadinessSummary;
  /** The effective readiness feature settings, so views render synchronously. */
  readinessSettings: ReadinessSettings;
  /** The effective "Current session" gap threshold, so the Settings editor renders synchronously. */
  sessionSettings: SessionSettings;
  /** Unfiltered history size — lets empty states offer "Show all time". */
  totalGamesAllTime: number;
  /** Yesterday's recap (unfiltered); absent when yesterday had no games. */
  recap?: SessionRecap;
}

/** Hero drill-down payload. */
export interface HeroDetail {
  hero: string;
  overall: WinLoss;
  byMap: Group[];
  recent: Array<{ map: string; role: Role; result: Result; account: string; timestamp: number }>;
  stats: HeroSummary | null;
}

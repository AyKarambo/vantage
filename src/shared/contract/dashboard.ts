/**
 * Dashboard DTOs of the IPC contract: the filter set plus everything the
 * dashboard renderer draws for it. Electron-free so main, preload and the
 * renderer bundle can all share it.
 */
import type { Role, Result } from '../../core/model';
import type { WinLoss, Group, FocusItem, HeroSummary, SessionRecap, Streak } from '../../core/analytics';
import type { MentalSummary, MatchFlagKey } from '../../core/mental';
import type { Progression } from '../../core/progression';
import type { TargetSummary } from '../../core/targets';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { ReadinessSummary, ReadinessSettings } from '../../core/readiness';
import type { DemoPreference } from '../../core/demoPreference';

/** The filters every view is scoped by, chosen in the app shell. */
export interface DashboardFilters {
  account?: string; // 'all' or account name
  role?: string; // 'all' | tank | damage | support | openQ
  /** N-day window | all time | a specific season (addressed by its stable id). */
  days?: number | 'all' | { season: string };
}

/** One day's recap (the sidebar "today" card + Overview session). */
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
  /** Merged mental flags (quick-log OR review source) — only true keys are present. */
  flags?: Partial<Record<MatchFlagKey, true>>;
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
  focusMaps: FocusItem[];
  heroStats: HeroSummary[];
  matches: MatchRow[];
  mental: MentalSummary;
  targets: TargetSummary[];
  /** Ungraded tracked games, newest first — ALWAYS unfiltered (the inbox source). */
  reviewInbox: MatchRow[];
  /** Total ungraded count (the badge) — unfiltered and uncapped. */
  pendingReviews: number;
  /** The effective break-reminder settings, so views render synchronously. */
  breakReminder: BreakReminderSettings;
  /** Readiness / training-load verdict — computed over the UNFILTERED history (fatigue is per-person). */
  readiness: ReadinessSummary;
  /** The effective readiness feature settings, so views render synchronously. */
  readinessSettings: ReadinessSettings;
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

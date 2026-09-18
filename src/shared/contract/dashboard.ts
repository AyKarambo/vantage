/**
 * Dashboard DTOs of the IPC contract: the filter set plus everything the
 * dashboard renderer draws for it. Electron-free so main, preload and the
 * renderer bundle can all share it.
 */
import type { Role, Result } from '../../core/model';
import type { RankPosition } from '../../core/rank/types';
import type { RankSeriesPoint } from '../../core/rank/series';
import type { WinLoss, Group, FocusItem, FocusEntry, HeroSummary, PerformanceStats, SessionDebrief, SessionSummary, Streak, StreakStats, TargetGrade, TrendGroup, Momentum } from '../../core/analytics';
import type { MentalSummary, MatchFlagKey } from '../../core/mental';
import type { MentalCosts, RatedSide, TiltPositionBucket, TiltTrendPoint, WinrateSide } from '../../core/mentalAnalytics';
import type { Progression } from '../../core/progression';
import type { TargetSummary } from '../../core/targets';
import type { StalenessSettings } from '../../core/staleness';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { ReadinessSummary, ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import type { GradingSettings } from '../../core/gradingSettings';
import type { DemoPreference } from '../../core/demoPreference';
import type { MasterData } from './masterData';
import type { PlacementRunSummary } from './placements';

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
// Re-exported so the Mental view reads its analytics vocabulary from the contract too.
export type { MentalCosts, RatedSide, TiltPositionBucket, TiltTrendPoint, WinrateSide };

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
  /**
   * The rank held going INTO this match — a stored snapshot, present only when
   * the match records a ±%. See `GameRecord.rankAtStart` for why it is stored
   * rather than derived.
   */
  rankAtStart?: RankPosition;
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
   * Review screen and as an optional Matches-list field: target id → the
   * derived grade + underlying per-10/ratio value, or `'no-stat'` when the
   * match can't measure it. Only populated for the currently-active measured
   * targets, on both review-inbox and match-list rows.
   */
  measuredGrades?: Record<string, { grade: TargetGrade; value: number } | 'no-stat'>;
  /**
   * The player's own stored per-target grades for this match (the self-graded
   * review layer): target id → grade. Unlike {@link measuredGrades}, these are
   * stored on the match, so they stay put regardless of later target changes —
   * this is what the Matches-list "Target grades" field renders.
   */
  targetGrades?: Record<string, TargetGrade>;
  /**
   * Whether this match has a saved `MatchReview` record at all — true even
   * for an empty one ("Mark as no-read" deliberately saves `{ grades: {},
   * flags: {} }`), since that's still a review the player has dealt with.
   * `targetGrades`/`flags` being absent doesn't mean the same thing: an
   * ignored/no-read match has neither, but so does a genuinely never-reviewed
   * one — this is what tells the two apart (R4).
   */
  reviewed: boolean;
}

/**
 * A competitive match that played but arrived without a GEP outcome (win/loss),
 * held for manual completion on the Review screen. Deliberately a lean summary
 * of the raw capture — never a {@link MatchRow}/`GameRecord` — because a pending
 * match is NOT in history or analytics until the user sets its result.
 */
export interface PendingMatch {
  matchId: string;
  map: string;
  heroes: string[];
  role: Role;
  account: string;
  /** When the match ended (from the capture's `endedAt`), for relative-time display + ordering. */
  timestamp: number;
  /** How many roster players the capture carried — a "we did record this game" signal. */
  rosterCount: number;
  /**
   * The win/loss/draw GEP actually reported for this match, when it had one — a
   * held match can still carry a result (it's held because the game_type was
   * unknown, not because the outcome was). Lets Review hint the reported result
   * and make confirming it one click. Absent when GEP reported no outcome.
   */
  reportedResult?: Result;
}

/**
 * The comparison window immediately before the active filter's (C3): the
 * previous season for a season filter, the `[now−2N, now−N)` block for an
 * N-day filter — same account/role scoping as the active window's `games`.
 */
export interface PreviousWindow {
  /** The prior season's name, or "the previous N days" for a day-count filter. */
  label: string;
  overall: WinLoss;
  byRole: Group[];
  byMapType: Group[];
  heroStats: HeroSummary[];
}

/** One season's win/loss (C5) — a row of `DashboardData.bySeason`. */
export interface SeasonBreakdown {
  /** Addressable season id, e.g. `S:2026-06-16` — pass to `setFilter({ days: { season: id } })`. */
  id: string;
  label: string;
  games: number;
  wins: number;
  losses: number;
  winrate: number;
  /** Net SR change (C2) summed over the season's games that logged one — same convention as `WinLoss.srNet`. */
  srNet?: number;
  srLogged?: number;
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
  /** Longest win/loss runs + best/worst single day in the FILTERED range (C7). */
  extremes: StreakStats;
  /** Winrate-derived heuristic estimate (the fallback rank). */
  progression: Progression;
  /**
   * The user's actual calculated rank for the most-recently-played account's
   * most-recently-played anchored role — the "real" rank the sidebar/KPI show.
   * Absent when no rank anchor is set for that account, in which case
   * {@link progression} (the winrate heuristic) is the fallback.
   */
  primaryRank?: {
    account: string;
    role: Role;
    tier: string;
    division: number;
    progressPct: number;
    protected: boolean;
    /**
     * Net anchor→now movement in ladder %-points (positive = climbed, negative =
     * dropped, 0 = no matches since the anchor). Measured over the FULL history
     * for this (account, role), so it is independent of the active date filter.
     * Drives the Overview Rank KPI's ▴/▾/neutral arrow (that surface only).
     */
    movement: number;
  };
  /**
   * Per-account calculated rank for surfaces that show one line per account:
   * account name → its most-recently-played anchored role's rank + protection.
   * Only accounts with a rank anchor appear; carries no movement (the arrow is
   * Overview-KPI-only).
   */
  accountRanks: Record<string, { tier: string; division: number; progressPct: number; protected: boolean }>;
  /**
   * EVERY anchored (account, role)'s calculated rank, for the account-switcher's
   * expanded per-role listing — account name → role → rank + protection. A role
   * absent here has no rank anchor on that account (never started, or still
   * mid-placement — see {@link placements} for that state instead).
   */
  accountRoleRanks: Record<string, Partial<Record<Role, { tier: string; division: number; progressPct: number; protected: boolean }>>>;
  /**
   * Rank over time (C1): one {@link RankSeriesPoint} series per anchored
   * (account, role) that has a competitive match in the active FILTERED
   * range, keyed like {@link accountRoleRanks} — `rankKey(account, role)`.
   * A track with an anchor but nothing played in range is simply absent.
   * Oldest first within a series; gaps (placements, pre-reset, no-anchor)
   * are omitted rather than interpolated, exactly as the Matches "Rank at
   * start" column blanks them.
   */
  rankTrend: Record<string, RankSeriesPoint[]>;
  /**
   * Open and completed placement runs across every track, so rank surfaces
   * can render `Placements N/10` instead of a rank the player does not have.
   */
  placements: PlacementRunSummary[];
  session: Session | null;
  /** Every past sitting, newest first (S4) — same account scope + gap as `session`, capped like every other list. */
  sessions: SessionSummary[];
  byRole: Group[];
  byAccount: Group[];
  byMap: Group[];
  byMapType: Group[];
  byHero: Group[];
  /** Winrate over time, each bucket carrying its own trailing rolling winrate (C6). */
  trend: TrendGroup[];
  /** The winrate-chart momentum strip (C6): trailing window vs. the one before it, over the same filtered games as `trend`. Null below the sample floor. */
  momentum: Momentum | null;
  /** The comparison window immediately before this one (C3); absent for "All time" or when there's nothing addressable before it. */
  previous?: PreviousWindow;
  /** Win/loss per season (C5), newest first, account/role-scoped but not date-scoped — "how did each season go". */
  bySeason: SeasonBreakdown[];
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
  /** "What it costs you" splits (tilt/comms/toxic/leaver/performance) over the FILTERED range. */
  mentalCosts: MentalCosts;
  /** Per-day tilt rate over the FILTERED range, ascending (the Trends sparkline). */
  tiltTrend: TiltTrendPoint[];
  /** Tilt rate by game number within a sitting — numbered over the UNFILTERED history, aggregating only filtered games (same convention as {@link sessionPosition}). */
  tiltBySession: TiltPositionBucket[];
  /** Self-rated performance rollups over the FILTERED range (issue #44 analytics). */
  performance: PerformanceStats;
  targets: TargetSummary[];
  /** Ungraded tracked games, newest first — ALWAYS unfiltered (the inbox source). */
  reviewInbox: MatchRow[];
  /** Total ungraded count (the Review subtitle) — unfiltered and uncapped. */
  pendingReviews: number;
  /** Of `pendingReviews`, how many landed in the last 7 days — the sidebar
   *  badge (R1). The lifetime total only ever grows for an active player, so
   *  it stopped meaning "things to do tonight"; this is the number that does. */
  pendingReviewsRecent: number;
  /**
   * Played competitive matches GEP delivered without a win/loss, waiting for the
   * user to set a result in Review (the "Needs result" section). Held in a
   * separate store, so these never touch history/analytics/rank/Notion until
   * resolved. Always unfiltered; empty when none are pending.
   */
  pendingMatches: PendingMatch[];
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
  /** Effective measured-grade settings (partial-credit margin), so the Settings editor renders synchronously. */
  gradingSettings: GradingSettings;
  /** Unfiltered history size — lets empty states offer "Show all time". */
  totalGamesAllTime: number;
  /**
   * The trailing gap-based sitting's debrief (S3, unfiltered — same account
   * scope as {@link session}); absent when there are no games at all. The
   * Overview only renders it once `closed` is true — a still-open sitting is
   * already covered by the sidebar's live "Current session" card.
   */
  recap?: SessionDebrief;
}

/** Hero drill-down payload. */
export interface HeroDetail {
  hero: string;
  overall: WinLoss;
  byMap: Group[];
  recent: Array<{ matchId: string; map: string; role: Role; result: Result; account: string; timestamp: number }>;
  stats: HeroSummary | null;
}

/**
 * Dashboard DTOs of the IPC contract: the filter set plus everything the
 * dashboard renderer draws for it. Electron-free so main, preload and the
 * renderer bundle can all share it.
 */
import type { Role, Result } from '../../core/model';
import type { WinLoss, Group, FocusItem, HeroSummary, SessionRecap, Streak } from '../../core/analytics';
import type { MentalSummary } from '../../core/mental';
import type { Progression } from '../../core/progression';
import type { TargetSummary } from '../../core/targets';
import type { BreakReminderSettings } from '../../core/breakReminder';

/** The filters every view is scoped by, chosen in the app shell. */
export interface DashboardFilters {
  account?: string; // 'all' or account name
  role?: string; // 'all' | tank | damage | support | openQ
  mode?: string; // 'all' or game type (Competitive, Quick Play, …)
  days?: number | 'all';
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
}

/** Everything the dashboard needs for the current filter set. */
export interface DashboardData {
  isSample: boolean;
  generatedAt: number;
  filters: Required<DashboardFilters>;
  options: {
    accounts: string[];
    roles: Role[];
    modes: string[];
  };
  greetingName: string;
  overall: WinLoss;
  streak: Streak;
  progression: Progression;
  session: Session | null;
  byRole: Group[];
  byAccount: Group[];
  byMode: Group[];
  byMap: Group[];
  byMapType: Group[];
  byHero: Group[];
  trend: Group[];
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

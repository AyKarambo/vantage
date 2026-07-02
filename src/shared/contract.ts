/**
 * The IPC contract between the main process and the dashboard renderer.
 *
 * This is the single source of truth for the shape of everything that crosses
 * the preload bridge. It is pure (types only, no runtime, no Electron) so both
 * sides — and the renderer's esbuild bundle — can share it without pulling any
 * main-process code into the renderer.
 */
import type { Role, Result } from '../core/model';
import type { WinLoss, Group, FocusItem, HeroSummary, MatchMental } from '../core/analytics';
import type { MentalSummary } from '../core/mental';
import type { Progression } from '../core/progression';
import type { TargetSummary, TargetMode } from '../core/targets';

export type {
  Role, Result, WinLoss, Group, FocusItem, HeroSummary, MatchMental,
  MentalSummary, Progression, TargetSummary, TargetMode,
};

/** The filters every view is scoped by, chosen in the app shell. */
export interface DashboardFilters {
  account?: string; // 'all' or account name
  role?: string; // 'all' | tank | damage | support | openQ
  mode?: string; // 'all' or game type (Competitive, Quick Play, …)
  days?: number | 'all';
}

/** Streak of the most recent decided games. */
export interface Streak {
  type: 'W' | 'L' | 'none';
  count: number;
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
}

/** Hero drill-down payload. */
export interface HeroDetail {
  hero: string;
  overall: WinLoss;
  byMap: Group[];
  recent: Array<{ map: string; role: Role; result: Result; account: string; timestamp: number }>;
  stats: HeroSummary | null;
}

/** Result of a Notion export attempt. */
export interface ExportResult {
  ok: number;
  failed: number;
  skipped?: number;
  unavailable?: boolean;
}

/** Notion connection state, for the Notion sync screen. */
export interface NotionStatus {
  /** An integration token is saved (encrypted at rest). */
  tokenSet: boolean;
  /** A target Gametracker database id is configured. */
  databaseConfigured: boolean;
  /** Ready to sync: token + database + a live client. */
  connected: boolean;
  /** Deep link to the Notion database, if known. */
  gametrackerUrl?: string;
  /** How many tracked games are available to push. */
  trackedGames: number;
}

/** A manually-logged match, captured in the Log Match card. */
export interface ManualMatchInput {
  result: Result;
  role: Role;
  map: string;
  hero?: string;
  gameType: string;
  /** Manual after-game flags (tilt / comms / etc.), if the player added any. */
  mental?: MatchMental;
}

/** A new improvement target authored in the Targets builder. */
export interface AuthoredTargetInput {
  name: string;
  mode: TargetMode;
  scope: 'match' | 'season';
  rule: string;
}

/** The API surface exposed on `window.owstats` by the preload bridge. */
export interface OwStatsApi {
  getDashboard(filters: DashboardFilters): Promise<DashboardData>;
  heroDetail(hero: string, filters: DashboardFilters): Promise<HeroDetail>;
  exportNotion(filters: DashboardFilters): Promise<ExportResult>;
  notionStatus(): Promise<NotionStatus>;
  setNotionToken(token: string): Promise<NotionStatus>;
  clearNotionToken(): Promise<NotionStatus>;
  /** Persist a manually-logged match (appended to history). */
  logMatch(input: ManualMatchInput): Promise<{ matchId: string }>;
  /** Persist a new authored improvement target. */
  saveTarget(input: AuthoredTargetInput): Promise<void>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}

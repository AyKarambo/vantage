/**
 * The IPC contract between the main process and the dashboard renderer.
 *
 * This is the single source of truth for the shape of everything that crosses
 * the preload bridge — the types plus the channel map. It stays Electron-free
 * so both sides — and the renderer's esbuild bundle — can share it without
 * pulling any main-process code into the renderer.
 */
import type { Role, Result, HeroStat } from '../core/model';
import type {
  WinLoss, Group, FocusItem, HeroSummary, MatchMental, MatchReview, TargetGrade,
} from '../core/analytics';
import type { MentalSummary } from '../core/mental';
import type { Progression } from '../core/progression';
import type { TargetSummary, TargetMode } from '../core/targets';
import type { BreakReminderSettings } from '../core/breakReminder';

export type {
  Role, Result, HeroStat, WinLoss, Group, FocusItem, HeroSummary, MatchMental, MatchReview,
  MentalSummary, Progression, TargetGrade, TargetSummary, TargetMode, BreakReminderSettings,
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
  /** Ungraded tracked games, newest first — ALWAYS unfiltered (the inbox source). */
  reviewInbox: MatchRow[];
  /** Total ungraded count (the badge) — unfiltered and uncapped. */
  pendingReviews: number;
  /** The effective break-reminder settings, so views render synchronously. */
  breakReminder: BreakReminderSettings;
}

/** Hero drill-down payload. */
export interface HeroDetail {
  hero: string;
  overall: WinLoss;
  byMap: Group[];
  recent: Array<{ map: string; role: Role; result: Result; account: string; timestamp: number }>;
  stats: HeroSummary | null;
}

/**
 * One scoreboard row of the match detail page. Only end-of-match-screen data
 * the GEP roster actually reported — every stat is optional because feed
 * coverage varies (guardrail #1: never fabricate hidden info).
 */
export interface ScoreboardEntry {
  /** BattleTag or display name, exactly as GEP reported it. */
  name: string;
  hero?: string;
  role?: Role;
  /** GEP-reported team index; absent when the feed doesn't report teams. */
  team?: number;
  /** The tracked player's row(s) — tinted in the scoreboard. */
  isLocal: boolean;
  eliminations?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  healing?: number;
  mitigation?: number;
  /** Not exposed by GEP today — the column is hidden when absent everywhere. */
  perks?: string[];
}

/** A player from this match the user has encountered before (local index). */
export interface PlayerEncounter {
  name: string;
  /** Prior shared matches, excluding this one. */
  encounters: number;
  /** ms epoch of the most recent prior encounter. */
  lastSeen: number;
  /** The tracked player's results across those shared matches. */
  results?: { wins: number; losses: number };
}

/** Full match drill-down payload. Optional sections degrade per data tier. */
export interface MatchDetail {
  matchId: string;
  timestamp: number;
  account: string;
  role: Role;
  map: string;
  mapType: string;
  result: Result;
  gameType: string;
  durationMinutes?: number;
  /** Round score, e.g. "2–1" (v2 capture); absent on older records. */
  finalScore?: string;
  heroes: string[];
  /** Local player's per-hero lines; [] when GEP gave no per-hero data. */
  perHero: HeroStat[];
  mental?: MatchMental;
  /** Grouped by `team` in the renderer; absent → local-row-only fallback. */
  scoreboard?: ScoreboardEntry[];
  /**
   * Competitive progress. 'estimate' = the winrate heuristic (the feed does
   * not report rank today); 'reported' is reserved for a future GEP upgrade.
   */
  competitive?: { note: 'estimate' | 'reported'; sr?: number; tier?: string; division?: number; delta?: number };
  /** Players seen in prior matches; [] when no roster data exists. */
  playerHistory: PlayerEncounter[];
  /** vantage-media:// URLs of end-of-match captures; [] when none. */
  screenshots: string[];
}

/** Result of a Notion export attempt. */
export interface ExportResult {
  ok: number;
  failed: number;
  skipped?: number;
  unavailable?: boolean;
  /** Set when the export short-circuited, e.g. a database shape mismatch. */
  error?: string;
}

/** A database the Notion integration can see, from the picker's list. */
export interface NotionDatabaseSummary {
  id: string;
  title: string;
  url?: string;
}

/** A page the Notion integration can see — a candidate parent for auto-create. */
export interface NotionPageSummary {
  id: string;
  title: string;
  url?: string;
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
  /** Where the configured database id came from. */
  databaseSource: 'selected' | 'appsettings' | 'none';
  /** The configured database id, for exact matching in the picker. */
  databaseId?: string;
  /** The database's title in Notion, resolved once validated. */
  databaseTitle?: string;
  /** Whether the configured database's shape matches the Gametracker schema; undefined = not yet checked. */
  shapeValid?: boolean;
  /** Missing/mismatched property names, when `shapeValid` is false. */
  shapeIssues?: string[];
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
  rule: string;
}

/** An edit to an existing target — lifecycle state and accrued grades are kept. */
export interface TargetEditInput {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
}

/** A Review-screen read (target grades + feel flags) for one tracked match. */
export interface ReviewInput {
  matchId: string;
  grades: Record<string, TargetGrade>;
  flags: MatchMental;
}

/** The API surface exposed on `window.owstats` by the preload bridge. */
export interface OwStatsApi {
  getDashboard(filters: DashboardFilters): Promise<DashboardData>;
  heroDetail(hero: string, filters: DashboardFilters): Promise<HeroDetail>;
  /** Full drill-down for one match; null when the id is unknown. */
  matchDetail(matchId: string, filters: DashboardFilters): Promise<MatchDetail | null>;
  exportNotion(filters: DashboardFilters): Promise<ExportResult>;
  notionStatus(): Promise<NotionStatus>;
  setNotionToken(token: string): Promise<NotionStatus>;
  clearNotionToken(): Promise<NotionStatus>;
  /** Persist a manually-logged match (appended to history). */
  logMatch(input: ManualMatchInput): Promise<{ matchId: string }>;
  /** Persist a new authored improvement target. */
  saveTarget(input: AuthoredTargetInput): Promise<void>;
  /** Persist the manual review (grades + flags) onto a tracked match. */
  saveReview(input: ReviewInput): Promise<void>;
  /** One-time legacy localStorage migration; skips unknown matchIds and existing reviews. */
  importReviews(inputs: ReviewInput[]): Promise<{ imported: number; skipped: number }>;
  /** Edit a target's name/mode/rule; stats keep accruing across edits. */
  updateTarget(input: TargetEditInput): Promise<void>;
  /** Toggle whether the target is graded on the Review screen. */
  setTargetActive(id: string, active: boolean): Promise<void>;
  /** Archive (soft-remove, restorable) or restore a target. */
  setTargetArchived(id: string, archived: boolean): Promise<void>;
  /** Permanently remove a target; grades stored in saved reviews stay inert. */
  deleteTarget(id: string): Promise<void>;
  /** The currently persisted break-reminder settings. */
  getBreakReminder(): Promise<BreakReminderSettings>;
  /** Persist new break-reminder settings; returns the persisted (clamped) value. */
  setBreakReminder(input: BreakReminderSettings): Promise<BreakReminderSettings>;
  /** Databases the Notion integration can see, for the picker. */
  listNotionDatabases(): Promise<{ databases: NotionDatabaseSummary[]; error?: string }>;
  /** Pages the Notion integration can see — candidate parents for auto-create. */
  listNotionPages(): Promise<{ pages: NotionPageSummary[]; error?: string }>;
  /** Select an existing database as the Gametracker target. */
  selectNotionDatabase(databaseId: string): Promise<NotionStatus>;
  /** Create a correctly-shaped Maps + Gametracker database pair under a parent page, then select it. */
  createNotionDatabase(parentPageId: string): Promise<NotionStatus>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}

/**
 * The IPC channel behind each `OwStatsApi` method. Preload and the renderer
 * bridge are generated from this map and the main process registers its
 * handlers by these constants, so a new API method fails to compile anywhere
 * until it has a channel here — the edges can never drift from the contract.
 */
export const IPC_CHANNELS = {
  getDashboard: 'dashboard:data',
  heroDetail: 'dashboard:hero-detail',
  matchDetail: 'dashboard:match-detail',
  exportNotion: 'dashboard:export-notion',
  notionStatus: 'notion:status',
  setNotionToken: 'notion:set-token',
  clearNotionToken: 'notion:clear-token',
  logMatch: 'manual:log-match',
  saveTarget: 'manual:save-target',
  saveReview: 'manual:save-review',
  importReviews: 'manual:import-reviews',
  updateTarget: 'manual:update-target',
  setTargetActive: 'manual:set-target-active',
  setTargetArchived: 'manual:set-target-archived',
  deleteTarget: 'manual:delete-target',
  getBreakReminder: 'settings:get-break-reminder',
  setBreakReminder: 'settings:set-break-reminder',
  listNotionDatabases: 'notion:list-databases',
  listNotionPages: 'notion:list-pages',
  selectNotionDatabase: 'notion:select-database',
  createNotionDatabase: 'notion:create-database',
} as const satisfies Record<Exclude<keyof OwStatsApi, 'window'>, string>;

/** The fire-and-forget channels behind the frameless window controls. */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
} as const satisfies Record<keyof OwStatsApi['window'], string>;

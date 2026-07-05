/**
 * The `window.owstats` API surface and its channel maps, kept in one file so
 * the `satisfies` invariant below stays visually adjacent to the interface it
 * enforces. Electron-free so main, preload and the renderer bundle can all
 * share it.
 */
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { DashboardFilters, DashboardData, HeroDetail } from './dashboard';
import type { MatchDetail } from './matchDetail';
import type { ExportResult, ImportResult, NotionStatus, NotionDatabaseSummary, NotionPageSummary, SyncProgress } from './notion';
import type { ManualMatchInput, MatchEditInput, AuthoredTargetInput, TargetEditInput, ReviewInput } from './inputs';
import type { AccountSummary, AccountInput, RankAnchorInput, RankSummary } from './accounts';
import type { LogEntry, LogLevel, RendererErrorInput } from './logging';
import type { GepStatusPayload } from './gepStatus';
import type { AppInfo, AppUiSettings } from './appSettings';

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
  /** Edit a stored match's manual layer (game facts stay locked on auto-tracked matches). */
  editMatch(input: MatchEditInput): Promise<void>;
  /** The tracked accounts (battleTag → label), for the picker and settings. */
  listAccounts(): Promise<AccountSummary[]>;
  /** Create or edit an account; returns the updated list. */
  saveAccount(input: AccountInput): Promise<AccountSummary[]>;
  /** Delete an account by battleTag; returns the updated list. */
  deleteAccount(battleTag: string): Promise<AccountSummary[]>;
  /** Computed current rank for each anchored (account, role). */
  getRanks(): Promise<RankSummary[]>;
  /** Set (or replace) the one-time rank anchor for an (account, role). */
  setRankAnchor(input: RankAnchorInput): Promise<RankSummary[]>;
  /** Pull matches from the configured Notion Gametracker database into history. */
  importNotion(): Promise<ImportResult>;
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
  /** Snapshot of the main process's recent log entries (the viewer's source). */
  getLogEntries(): Promise<LogEntry[]>;
  /** The current minimum log level. */
  getLogLevel(): Promise<LogLevel>;
  /** Set the minimum log level for this session; returns the applied value. */
  setLogLevel(level: LogLevel): Promise<LogLevel>;
  /** Forward an uncaught renderer error into the main-process log. */
  logRendererError(input: RendererErrorInput): Promise<void>;
  /** Current connection/data-flow status snapshot (see also onGepStatus). */
  getGepStatus(): Promise<GepStatusPayload>;
  /** App-behavior settings (Settings screen). */
  getAppSettings(): Promise<AppUiSettings>;
  /** Persist app-behavior settings; returns the applied values. */
  setAppSettings(patch: Partial<AppUiSettings>): Promise<AppUiSettings>;
  /** Version + support contact (Settings screen's About card). */
  getAppInfo(): Promise<AppInfo>;
  /** Remove a game's review — the undo of a first-time review save. */
  clearReview(matchId: string): Promise<void>;
  /** Subscribe to new log entries; returns an unsubscribe function. */
  onLogEntry(cb: (e: LogEntry) => void): () => void;
  /** Subscribe to connection/data-flow state changes; returns an unsubscribe function. */
  onGepStatus(cb: (s: GepStatusPayload) => void): () => void;
  /** Subscribe to live sync progress (fires per exported game); returns an unsubscribe function. */
  onSyncProgress(cb: (p: SyncProgress) => void): () => void;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}

/**
 * Main→renderer push events. Each key is an `OwStatsApi` subscription method
 * (`onX(cb) => unsubscribe`); preload and the renderer bridge generate the
 * subscription forwarders from this map exactly like `IPC_CHANNELS` generates
 * the invokers.
 */
export const EVENT_CHANNELS = {
  onLogEntry: 'push:log-entry',
  onGepStatus: 'push:gep-status',
  onSyncProgress: 'push:sync-progress',
} as const satisfies Partial<Record<keyof OwStatsApi, string>>;

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
  editMatch: 'manual:edit-match',
  listAccounts: 'accounts:list',
  saveAccount: 'accounts:save',
  deleteAccount: 'accounts:delete',
  getRanks: 'rank:list',
  setRankAnchor: 'rank:set-anchor',
  importNotion: 'notion:import',
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
  getLogEntries: 'log:entries',
  getLogLevel: 'log:get-level',
  setLogLevel: 'log:set-level',
  logRendererError: 'log:renderer-error',
  getGepStatus: 'status:gep',
  getAppSettings: 'settings:get-app',
  setAppSettings: 'settings:set-app',
  getAppInfo: 'app:info',
  clearReview: 'manual:clear-review',
} as const satisfies Record<Exclude<keyof OwStatsApi, 'window' | keyof typeof EVENT_CHANNELS>, string>;

/** The fire-and-forget channels behind the frameless window controls. */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
} as const satisfies Record<keyof OwStatsApi['window'], string>;

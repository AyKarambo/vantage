/**
 * The `window.owstats` API surface and its channel maps, kept in one file so
 * the `satisfies` invariant below stays visually adjacent to the interface it
 * enforces. Electron-free so main, preload and the renderer bundle can all
 * share it.
 */
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { StalenessSettings } from '../../core/staleness';
import type { ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import type { DashboardFilters, DashboardData, HeroDetail } from './dashboard';
import type { MatchDetail } from './matchDetail';
import type {
  ExportResult, ImportResult, NotionStatus, NotionDatabaseSummary, NotionPageSummary, SyncProgress,
  CleanupDuplicatesResult,
} from './notion';
import type {
  ManualMatchInput, MatchEditInput, AuthoredTargetInput, TargetEditInput, ReviewInput,
  IgnorePendingReviewsInput,
} from './inputs';
import type { AccountSummary, AccountInput, RankAnchorInput, RankSummary } from './accounts';
import type { ImportFileResult } from './importFile';
import type { Role } from '../../core/model';
import type { LogEntry, LogLevel, RendererErrorInput } from './logging';
import type { GepStatusPayload } from './gepStatus';
import type { AppInfo, AppUiSettings, DataLocation, DataLocationResult } from './appSettings';
import type { MasterData, HeroEntry, MapEntry, SeasonEntry, UpdatePreview, AcceptedUpdate } from './masterData';

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
  /** Per-account, per-role most-played hero names (desc by play count) — the Log Match shortlist. */
  mostPlayedHeroes(): Promise<Record<string, Partial<Record<Role, string[]>>>>;
  /** Set (or replace) the one-time rank anchor for an (account, role). */
  setRankAnchor(input: RankAnchorInput): Promise<RankSummary[]>;
  /** Pull matches from the configured Notion Gametracker database into history. */
  importNotion(): Promise<ImportResult>;
  /** Delete every match that came from a Notion import (for a clean re-import); returns how many were removed. */
  deleteImportedMatches(): Promise<{ deleted: number }>;
  /** Pick a Vantage import file and ingest it into history (marked as file-imported); returns a summary. */
  importFromFile(): Promise<ImportFileResult>;
  /** Delete every file-imported match (independently of Notion imports); returns how many were removed. */
  deleteFileImports(): Promise<{ deleted: number }>;
  /** How many file-imported matches are currently stored (for the Settings → Data status line). */
  fileImportedCount(): Promise<number>;
  /**
   * Explicit action: archives redundant duplicate rows (Notion trash,
   * restorable) in the configured Gametracker database, keeping one canonical
   * row per match. Never run implicitly by import or export.
   */
  cleanupNotionDuplicates(): Promise<CleanupDuplicatesResult>;
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
  /** Deactivate every active target at once — the "start a fresh focus" rotation reset. */
  deactivateAllTargets(): Promise<void>;
  /** The currently persisted target-staleness thresholds. */
  getStaleness(): Promise<StalenessSettings>;
  /** Persist new target-staleness thresholds; returns the persisted (clamped) value. */
  setStaleness(input: StalenessSettings): Promise<StalenessSettings>;
  /** The currently persisted break-reminder settings. */
  getBreakReminder(): Promise<BreakReminderSettings>;
  /** Persist new break-reminder settings; returns the persisted (clamped) value. */
  setBreakReminder(input: BreakReminderSettings): Promise<BreakReminderSettings>;
  /** The currently persisted readiness feature settings. */
  getReadiness(): Promise<ReadinessSettings>;
  /** Persist new readiness feature settings; returns the persisted value. */
  setReadiness(input: ReadinessSettings): Promise<ReadinessSettings>;
  /** The currently persisted "Current session" gap threshold. */
  getSessionSettings(): Promise<SessionSettings>;
  /** Persist a new session-gap threshold; returns the persisted (clamped) value. */
  setSessionSettings(input: SessionSettings): Promise<SessionSettings>;
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
  /**
   * Store the Overwolf dev key at ~/.ow-cli/dev-key (where the launcher reads it)
   * — a secret, never persisted into app config. Returns whether a key is now
   * present. Takes effect on the next launch (Dev Mode auth is start-time).
   */
  setDevKey(key: string): Promise<{ hasKey: boolean }>;
  /** Version + build/runtime facts + support contact (the About screen). */
  getAppInfo(): Promise<AppInfo>;
  /** Open a maintainer-provided external URL (mailto:/https:) via the sanctioned
   *  main-process shell.openExternal — the renderer window blocks navigation. */
  openExternal(url: string): Promise<void>;
  /** Where Vantage's data folder currently lives (Settings screen + first run). */
  getDataLocation(): Promise<DataLocation>;
  /** Open a folder picker (Settings "Change…") and, if chosen, migrate/adopt the data folder. */
  chooseDataFolder(): Promise<DataLocationResult>;
  /** Commit a chosen data folder — migrates (default) or adopts in place (existing Vantage data). */
  setDataFolder(input: { folder: string; adopt?: boolean }): Promise<DataLocationResult>;
  /** First-run folder picker; validates + adopts existing Vantage data automatically. */
  chooseFirstRunDataFolder(): Promise<DataLocationResult>;
  /** Remove a game's review — the undo of a first-time review save. */
  clearReview(matchId: string): Promise<void>;
  /** Read-only: how many pending matches "Ignore all" would affect right now (beyond the capped inbox rows). */
  previewPendingReviewIgnore(input: IgnorePendingReviewsInput): Promise<{ count: number }>;
  /** Bulk-saves an empty review for every matching pending match; returns their ids for Undo. */
  ignorePendingReviews(input: IgnorePendingReviewsInput): Promise<{ matchIds: string[] }>;
  /** Undo of ignorePendingReviews: clears reviews on exactly these matchIds. */
  clearReviews(matchIds: string[]): Promise<void>;
  /** The effective master data (defaults ⊕ overrides), for the Master Data editor. */
  masterDataGet(): Promise<MasterData>;
  /** Add or edit a hero; returns the new effective master data. */
  masterDataUpsertHero(entry: HeroEntry): Promise<MasterData>;
  /** Remove a hero (tombstone a built-in, or drop a user addition). */
  masterDataRemoveHero(name: string): Promise<MasterData>;
  /** Add or edit a map (name/mode/isActive); returns the new effective master data. */
  masterDataUpsertMap(entry: MapEntry): Promise<MasterData>;
  /** Remove a map (history on it is unaffected; suggestions/generator exclude it). */
  masterDataRemoveMap(name: string): Promise<MasterData>;
  /** Add or edit a season (start + label). */
  masterDataUpsertSeason(entry: SeasonEntry): Promise<MasterData>;
  /** Remove a season by its `S:<iso>` id. */
  masterDataRemoveSeason(id: string): Promise<MasterData>;
  /** Fetch heroes+maps from the online source and diff vs current — the Update preview (no persist). */
  masterDataFetchUpdate(): Promise<UpdatePreview>;
  /** Persist the accepted subset of an Update preview; returns the new effective master data. */
  masterDataApplyUpdate(accepted: AcceptedUpdate): Promise<MasterData>;
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
  mostPlayedHeroes: 'hero:most-played',
  setRankAnchor: 'rank:set-anchor',
  importNotion: 'notion:import',
  deleteImportedMatches: 'notion:delete-imported',
  cleanupNotionDuplicates: 'notion:cleanup-duplicates',
  importFromFile: 'import:from-file',
  deleteFileImports: 'import:delete-file',
  fileImportedCount: 'import:file-count',
  saveTarget: 'manual:save-target',
  saveReview: 'manual:save-review',
  importReviews: 'manual:import-reviews',
  updateTarget: 'manual:update-target',
  setTargetActive: 'manual:set-target-active',
  setTargetArchived: 'manual:set-target-archived',
  deleteTarget: 'manual:delete-target',
  deactivateAllTargets: 'manual:deactivate-all-targets',
  getStaleness: 'settings:get-staleness',
  setStaleness: 'settings:set-staleness',
  getBreakReminder: 'settings:get-break-reminder',
  setBreakReminder: 'settings:set-break-reminder',
  getReadiness: 'settings:get-readiness',
  setReadiness: 'settings:set-readiness',
  getSessionSettings: 'settings:get-session',
  setSessionSettings: 'settings:set-session',
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
  setDevKey: 'settings:set-dev-key',
  getAppInfo: 'app:info',
  openExternal: 'app:open-external',
  getDataLocation: 'settings:get-data-location',
  chooseDataFolder: 'settings:choose-data-folder',
  setDataFolder: 'settings:set-data-folder',
  chooseFirstRunDataFolder: 'settings:choose-first-run-data-folder',
  clearReview: 'manual:clear-review',
  previewPendingReviewIgnore: 'manual:preview-ignore-pending-reviews',
  ignorePendingReviews: 'manual:ignore-pending-reviews',
  clearReviews: 'manual:clear-reviews',
  masterDataGet: 'master:get',
  masterDataUpsertHero: 'master:upsert-hero',
  masterDataRemoveHero: 'master:remove-hero',
  masterDataUpsertMap: 'master:upsert-map',
  masterDataRemoveMap: 'master:remove-map',
  masterDataUpsertSeason: 'master:upsert-season',
  masterDataRemoveSeason: 'master:remove-season',
  masterDataFetchUpdate: 'master:fetch-update',
  masterDataApplyUpdate: 'master:apply-update',
} as const satisfies Record<Exclude<keyof OwStatsApi, 'window' | keyof typeof EVENT_CHANNELS>, string>;

/** The fire-and-forget channels behind the frameless window controls. */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
} as const satisfies Record<keyof OwStatsApi['window'], string>;

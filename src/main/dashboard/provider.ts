import type { GameRecord } from '../../core/analytics';
import type { AuthoredTarget } from '../../core/targets';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { ReadinessSettings } from '../../core/readiness';
import type { DemoContext } from '../../core/demoPreference';
import type { RankAnchorMap } from '../../core/rank';
import type {
  AccountSummary, AccountInput, AppInfo, AppUiSettings, AuthoredTargetInput, CleanupDuplicatesResult,
  DataLocation, DataLocationResult, GepStatusPayload, ImportResult, LogEntry, LogLevel,
  ManualMatchInput, MatchEditInput, NotionStatus, NotionDatabaseSummary, NotionPageSummary,
  RankAnchorInput, RankSummary, RendererErrorInput, ReviewInput, TargetEditInput,
} from '../../shared/contract';

/**
 * The data contract between the dashboard window and the composition root:
 * everything the renderer can ask of the main process, gathered in one
 * interface so the IPC layer stays thin and mechanical.
 */
export interface DataProvider {
  games(): GameRecord[];
  isSample(): boolean;
  /** Demo facts (effective display, raw choice, real-history presence) for the dashboard payload. */
  demoContext(): DemoContext;
  exportToNotion?(
    games: GameRecord[],
  ): Promise<{ ok: number; failed: number; skipped?: number; unavailable?: boolean }>;
  /** Current Notion connection state (for the Notion sync screen). */
  notionStatus(): NotionStatus;
  /** Save an integration token, (re)build the client, return the new state. */
  setNotionToken(token: string): NotionStatus;
  /** Remove the saved token and return the new state. */
  clearNotionToken(): NotionStatus;
  /** The player's authored improvement targets (◎ manual). */
  manualTargets(): AuthoredTarget[];
  /** Persist a new authored target. */
  saveTarget(input: AuthoredTargetInput): void;
  /** Persist a manually-logged match; returns its new id. */
  logMatch(input: ManualMatchInput): { matchId: string };
  /** Edit a stored match's manual layer (game facts stay locked on auto-tracked matches). */
  editMatch(input: MatchEditInput): void;
  /** The tracked accounts (battleTag → label). */
  listAccounts(): AccountSummary[];
  /** Create or edit an account; returns the updated list. */
  saveAccount(input: AccountInput): AccountSummary[];
  /** Delete an account by battleTag; returns the updated list. */
  deleteAccount(battleTag: string): AccountSummary[];
  /** Computed current rank for each anchored (account, role). */
  getRanks(): RankSummary[];
  /** Set (or replace) the one-time rank anchor for an (account, role); returns the ranks. */
  setRankAnchor(input: RankAnchorInput): RankSummary[];
  /** Anchors keyed for the rank engine, passed into the match-detail read. */
  rankAnchorMap(): RankAnchorMap;
  /** Pull matches from the configured Notion Gametracker database into history. */
  importNotion(): Promise<ImportResult>;
  /** Delete every Notion-imported match from history (for a clean re-import); returns how many were removed. */
  deleteImportedMatches(): { deleted: number };
  /** Explicit action: archive redundant duplicate rows (Notion trash) in the configured Gametracker database. */
  cleanupNotionDuplicates(): Promise<CleanupDuplicatesResult>;
  /** Attach a Review-screen read (grades + flags) to a tracked match. */
  saveReview(input: ReviewInput): void;
  /** Bulk legacy-review import; skips unknown ids and already-reviewed games. */
  importReviews(inputs: ReviewInput[]): { imported: number; skipped: number };
  /** Edit a target's name/mode/rule, preserving lifecycle state + accrued grades. */
  updateTarget(input: TargetEditInput): void;
  /** Toggle whether the target is graded on the Review screen. */
  setTargetActive(id: string, active: boolean): void;
  /** Archive (restorable) or restore a target. */
  setTargetArchived(id: string, archived: boolean): void;
  /** Permanently remove a target. */
  deleteTarget(id: string): void;
  /** Current break-reminder settings. */
  getBreakReminder(): BreakReminderSettings;
  /** Persist new break-reminder settings; returns the persisted (clamped) value. */
  setBreakReminder(input: BreakReminderSettings): BreakReminderSettings;
  /** Current readiness feature settings. */
  getReadiness(): ReadinessSettings;
  /** Persist new readiness feature settings; returns the persisted value. */
  setReadiness(input: ReadinessSettings): ReadinessSettings;
  /** Databases the Notion integration can see, for the picker. */
  listNotionDatabases(): Promise<{ databases: NotionDatabaseSummary[]; error?: string }>;
  /** Pages the Notion integration can see — candidate parents for auto-create. */
  listNotionPages(): Promise<{ pages: NotionPageSummary[]; error?: string }>;
  /** Select an existing database as the Gametracker target. */
  selectNotionDatabase(databaseId: string): Promise<NotionStatus>;
  /** Create a correctly-shaped Maps + Gametracker database pair under a parent page, then select it. */
  createNotionDatabase(parentPageId: string): Promise<NotionStatus>;
  /** Snapshot of the recent log-entry ring (the in-app viewer's source). */
  getLogEntries(): LogEntry[];
  /** Current minimum log level. */
  getLogLevel(): LogLevel;
  /** Set the session log level; returns the applied value. */
  setLogLevel(level: LogLevel): LogLevel;
  /** Record an uncaught renderer error in the main-process log. */
  logRendererError(input: RendererErrorInput): void;
  /** Current connection/data-flow status snapshot. */
  getGepStatus(): GepStatusPayload;
  /** App-behavior settings (Settings screen). */
  getAppSettings(): AppUiSettings;
  /** Apply + persist app-behavior settings; returns the applied values. */
  setAppSettings(patch: Partial<AppUiSettings>): AppUiSettings;
  /** Version + support contact. */
  getAppInfo(): AppInfo;
  /** Where Vantage's data folder currently lives (DB + manual data + screenshots). */
  getDataLocation(): DataLocation;
  /** Open a folder picker (Settings "Change…") and, if chosen, migrate/adopt the data folder; async (shows a dialog). */
  chooseDataFolder(): Promise<DataLocationResult>;
  /** Commit a chosen data folder — migrates by default, or adopts in place when the caller confirms. */
  setDataFolder(input: { folder: string; adopt?: boolean }): Promise<DataLocationResult>;
  /** First-run folder picker; validates the choice and adopts existing Vantage data automatically. */
  chooseFirstRunDataFolder(): Promise<DataLocationResult>;
  /** Remove a game's review (undo of a first-time save). */
  clearReview(matchId: string): void;
}

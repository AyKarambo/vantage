import type { GameRecord } from '../../core/analytics';
import type { AuthoredTarget } from '../../core/targets';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type {
  AppInfo, AppUiSettings, AuthoredTargetInput, GepStatusPayload, LogEntry, LogLevel,
  ManualMatchInput, NotionStatus, NotionDatabaseSummary, NotionPageSummary,
  RendererErrorInput, ReviewInput, TargetEditInput,
} from '../../shared/contract';

/**
 * The data contract between the dashboard window and the composition root:
 * everything the renderer can ask of the main process, gathered in one
 * interface so the IPC layer stays thin and mechanical.
 */
export interface DataProvider {
  games(): GameRecord[];
  isSample(): boolean;
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
  /** Remove a game's review (undo of a first-time save). */
  clearReview(matchId: string): void;
}

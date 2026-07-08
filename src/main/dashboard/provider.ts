import type { GameRecord } from '../../core/analytics';
import type { Role } from '../../core/model';
import type { AuthoredTarget } from '../../core/targets';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { StalenessSettings } from '../../core/staleness';
import type { ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import type { DemoContext } from '../../core/demoPreference';
import type { RankAnchorMap } from '../../core/rank';
import type {
  AccountSummary, AccountInput, AppInfo, AppUiSettings, AuthoredTargetInput, CleanupDuplicatesResult,
  DataLocation, DataLocationResult, GepStatusPayload, ImportResult, ImportFileResult, LogEntry, LogLevel,
  ManualMatchInput, MatchEditInput, NotionStatus, NotionDatabaseSummary, NotionPageSummary,
  RankAnchorInput, RankSummary, RendererErrorInput, ReviewInput, TargetEditInput,
  MasterData, HeroEntry, MapEntry, SeasonEntry, UpdatePreview, AcceptedUpdate,
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
  /** Per-account, per-role most-played hero names (desc by play count), over the full unfiltered history. */
  mostPlayedHeroes(): Record<string, Partial<Record<Role, string[]>>>;
  /** Set (or replace) the one-time rank anchor for an (account, role); returns the ranks. */
  setRankAnchor(input: RankAnchorInput): RankSummary[];
  /** Anchors keyed for the rank engine, passed into the match-detail read. */
  rankAnchorMap(): RankAnchorMap;
  /** Pull matches from the configured Notion Gametracker database into history. */
  importNotion(): Promise<ImportResult>;
  /** Delete every Notion-imported match from history (for a clean re-import); returns how many were removed. */
  deleteImportedMatches(): { deleted: number };
  /** Pick a Vantage import file and ingest it into history (marked file-imported); async (shows a dialog). */
  importFromFile(): Promise<ImportFileResult>;
  /** Delete every file-imported match (independently of Notion imports); returns how many were removed. */
  deleteFileImports(): { deleted: number };
  /** How many file-imported matches are stored (Settings → Data status line). */
  fileImportedCount(): number;
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
  /** Deactivate every active target at once (the "start a fresh focus" rotation reset). */
  deactivateAllTargets(): void;
  /** Current target-staleness thresholds. */
  getStaleness(): StalenessSettings;
  /** Persist new target-staleness thresholds; returns the persisted (clamped) value. */
  setStaleness(input: StalenessSettings): StalenessSettings;
  /** Current break-reminder settings. */
  getBreakReminder(): BreakReminderSettings;
  /** Persist new break-reminder settings; returns the persisted (clamped) value. */
  setBreakReminder(input: BreakReminderSettings): BreakReminderSettings;
  /** Current readiness feature settings. */
  getReadiness(): ReadinessSettings;
  /** Persist new readiness feature settings; returns the persisted value. */
  setReadiness(input: ReadinessSettings): ReadinessSettings;
  /** Current "Current session" gap threshold. */
  getSessionSettings(): SessionSettings;
  /** Persist a new session-gap threshold; returns the persisted (clamped) value. */
  setSessionSettings(input: SessionSettings): SessionSettings;
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
  /** Version + build/runtime facts + support contact (the About screen). */
  getAppInfo(): AppInfo;
  /** Open a maintainer URL via shell.openExternal, guarded by a scheme allowlist. */
  openExternal(url: string): Promise<void>;
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
  /** The effective master data (defaults ⊕ overrides) — feeds the dashboard read + the editor. */
  effectiveMasterData(): MasterData;
  /** Add/edit a hero; persists the delta and returns the new effective master data. */
  masterDataUpsertHero(entry: HeroEntry): MasterData;
  /** Remove a hero (tombstone a built-in, or drop a user addition). */
  masterDataRemoveHero(name: string): MasterData;
  /** Add/edit a map (name/mode/isActive). */
  masterDataUpsertMap(entry: MapEntry): MasterData;
  /** Remove a map (history unaffected; suggestions/generator exclude it). */
  masterDataRemoveMap(name: string): MasterData;
  /** Add/edit a season (start + label). */
  masterDataUpsertSeason(entry: SeasonEntry): MasterData;
  /** Remove a season by its `S:<iso>` id. */
  masterDataRemoveSeason(id: string): MasterData;
  /** Fetch the online catalog and diff vs current — the Update preview (no persist). */
  masterDataFetchUpdate(): Promise<UpdatePreview>;
  /** Persist the accepted subset of an Update preview; returns the new effective master data. */
  masterDataApplyUpdate(accepted: AcceptedUpdate): MasterData;
}

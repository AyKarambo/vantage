/**
 * The IPC contract between the main process and the dashboard renderer.
 *
 * This is the single source of truth for the shape of everything that crosses
 * the preload bridge — the types plus the channel map. It stays Electron-free
 * so both sides — and the renderer's esbuild bundle — can share it without
 * pulling any main-process code into the renderer.
 *
 * Import from 'shared/contract'; not from its sibling files.
 */

// Core vocabulary re-exported so the renderer never imports core directly
export type { Role, Result, HeroStat } from '../../core/model';
export type {
  WinLoss, Group, FocusItem, HeroSummary, MatchMental, CommsTone, MatchReview, TargetGrade, Streak,
  DayGroup, SessionRecap, PerformanceStats, PerformanceBucket, PerformanceTrendPoint,
} from '../../core/analytics';
export type { MentalSummary } from '../../core/mental';
export type { Progression } from '../../core/progression';
export type { TargetSummary, TargetMode } from '../../core/targets';
export type { StalenessSettings } from '../../core/staleness';
export type { BreakReminderSettings } from '../../core/breakReminder';
export type {
  ReadinessSummary, ReadinessSettings, ReadinessBand, ReadinessRecommendation,
  ReadinessConfidence, ReadinessSignal, ReadinessLoad, ReadinessTrendPoint,
  ReadinessDriver, ReadinessRegime, ReadinessSubscore, ReadinessSubscores,
} from '../../core/readiness';
export type { DemoPreference } from '../../core/demoPreference';
export type { SessionSettings } from '../../core/sessionSettings';

// Dashboard payloads
export type {
  DashboardFilters, Session, CalendarDay, MatchRow, MatchFlagKey, DashboardData, HeroDetail,
} from './dashboard';

// Editable master data (heroes/maps/seasons)
export type {
  HeroRole, HeroEntry, MapEntry, SeasonEntry, MasterData, HeroChange, MapChange, UpdatePreview,
  AcceptedUpdate, MapMode,
} from './masterData';

// Match drill-down payloads
export type { ScoreboardEntry, PlayerEncounter, MatchDetail } from './matchDetail';

// Notion export/import payloads
export type {
  ExportResult, ImportResult, NotionDatabaseSummary, NotionPageSummary, NotionStatus, SyncProgress,
  SubjectiveColumnStatus, SubjectiveColumnDiag, CleanupDuplicatesResult, SchemaProvisionStatus,
} from './notion';

// Manual-entry inputs
export type { ManualMatchInput, MatchEditInput, AuthoredTargetInput, TargetEditInput, ReviewInput } from './inputs';

// Accounts + rank
export type { AccountSummary, AccountInput, RankAnchorInput, RankSummary } from './accounts';

// Local file import (Settings → Data)
export type { ImportFileResult } from './importFile';

// Logging payloads (release debug log + in-app viewer)
export type { LogEntry, LogLevel, RendererErrorInput } from './logging';

// Live connection/data-flow status
export type { GepHealthState, GepStatusPayload } from './gepStatus';

// App-behavior settings + metadata (Settings screen)
export type { AppInfo, AppUiSettings, DataLocation, DataLocationResult } from './appSettings';

// The API surface and its channel maps
export type { OwStatsApi } from './api';
export { IPC_CHANNELS, WINDOW_CHANNELS, EVENT_CHANNELS } from './api';

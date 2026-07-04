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
  WinLoss, Group, FocusItem, HeroSummary, MatchMental, MatchReview, TargetGrade, Streak,
} from '../../core/analytics';
export type { MentalSummary } from '../../core/mental';
export type { Progression } from '../../core/progression';
export type { TargetSummary, TargetMode } from '../../core/targets';
export type { BreakReminderSettings } from '../../core/breakReminder';

// Dashboard payloads
export type {
  DashboardFilters, Session, CalendarDay, MatchRow, DashboardData, HeroDetail,
} from './dashboard';

// Match drill-down payloads
export type { ScoreboardEntry, PlayerEncounter, MatchDetail } from './matchDetail';

// Notion export payloads
export type { ExportResult, NotionDatabaseSummary, NotionPageSummary, NotionStatus } from './notion';

// Manual-entry inputs
export type { ManualMatchInput, AuthoredTargetInput, TargetEditInput, ReviewInput } from './inputs';

// The API surface and its channel maps
export type { OwStatsApi } from './api';
export { IPC_CHANNELS, WINDOW_CHANNELS } from './api';

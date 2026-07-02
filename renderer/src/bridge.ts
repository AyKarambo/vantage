/**
 * The single point where the renderer touches the preload IPC bridge. Every
 * view goes through `bridge` rather than reaching for `window.owstats`, so the
 * main-process contract has exactly one consumer to keep in sync.
 */
import type {
  AuthoredTargetInput,
  DashboardData,
  DashboardFilters,
  ExportResult,
  HeroDetail,
  ManualMatchInput,
  NotionStatus,
  OwStatsApi,
} from '../../src/shared/contract';

declare global {
  interface Window {
    owstats: OwStatsApi;
  }
}

// Every property calls through at use-time rather than snapshotting
// `window.owstats`, so load order never matters (the preview harness can inject
// its mock after this module initialises).
export const bridge = {
  getDashboard: (filters: DashboardFilters): Promise<DashboardData> =>
    window.owstats.getDashboard(filters),
  heroDetail: (hero: string, filters: DashboardFilters): Promise<HeroDetail> =>
    window.owstats.heroDetail(hero, filters),
  exportNotion: (filters: DashboardFilters): Promise<ExportResult> =>
    window.owstats.exportNotion(filters),
  notionStatus: (): Promise<NotionStatus> => window.owstats.notionStatus(),
  setNotionToken: (token: string): Promise<NotionStatus> => window.owstats.setNotionToken(token),
  clearNotionToken: (): Promise<NotionStatus> => window.owstats.clearNotionToken(),
  logMatch: (input: ManualMatchInput): Promise<{ matchId: string }> => window.owstats.logMatch(input),
  saveTarget: (input: AuthoredTargetInput): Promise<void> => window.owstats.saveTarget(input),
  window: {
    minimize: () => window.owstats.window.minimize(),
    toggleMaximize: () => window.owstats.window.toggleMaximize(),
    close: () => window.owstats.window.close(),
  },
};

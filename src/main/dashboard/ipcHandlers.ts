import { ipcMain } from 'electron';
import { heroDetail } from '../../core/analytics';
import { matchDetail } from '../../core/matchDetail';
import { computeDashboard, applyFilters } from '../../core/dashboardData';
import type { BreakReminderSettings } from '../../core/breakReminder';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../../shared/contract';
import type {
  AuthoredTargetInput, DashboardFilters, LogLevel, ManualMatchInput,
  RendererErrorInput, ReviewInput, TargetEditInput,
} from '../../shared/contract';
import type { DataProvider } from './provider';

/**
 * IPC registration for the dashboard: each typed contract channel maps onto a
 * DataProvider call (data) or a window-control closure (frameless title bar).
 * Mechanical glue only — behavior lives behind the provider. Registration is
 * process-global (ipcMain), so each function must be called exactly once.
 */

/** Wire every dashboard data channel to the provider. Call once per process. */
export function registerDashboardIpc(provider: DataProvider): void {
  const ch = IPC_CHANNELS;
  ipcMain.handle(ch.getDashboard, (_e, filters: DashboardFilters) =>
    computeDashboard(provider.games(), filters ?? {}, provider.isSample(), {
      targets: provider.manualTargets(),
      breakReminder: provider.getBreakReminder(),
    }),
  );
  ipcMain.handle(ch.exportNotion, async (_e, filters: DashboardFilters) => {
    if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
    return provider.exportToNotion(applyFilters(provider.games(), filters ?? {}));
  });
  ipcMain.handle(ch.heroDetail, (_e, hero: string, filters: DashboardFilters) =>
    heroDetail(applyFilters(provider.games(), filters ?? {}), hero),
  );
  // Looked up in the full history (a row must open even after filters move
  // on); the competitive estimate is scoped to the current filter set.
  ipcMain.handle(ch.matchDetail, (_e, matchId: string, filters: DashboardFilters) => {
    const games = provider.games();
    return matchDetail(games, matchId, applyFilters(games, filters ?? {}));
  });

  // Notion sync screen.
  ipcMain.handle(ch.notionStatus, () => provider.notionStatus());
  ipcMain.handle(ch.setNotionToken, (_e, token: string) => provider.setNotionToken(token));
  ipcMain.handle(ch.clearNotionToken, () => provider.clearNotionToken());
  ipcMain.handle(ch.listNotionDatabases, () => provider.listNotionDatabases());
  ipcMain.handle(ch.listNotionPages, () => provider.listNotionPages());
  ipcMain.handle(ch.selectNotionDatabase, (_e, databaseId: string) =>
    provider.selectNotionDatabase(databaseId),
  );
  ipcMain.handle(ch.createNotionDatabase, (_e, parentPageId: string) =>
    provider.createNotionDatabase(parentPageId),
  );

  // Manual (◎) writes.
  ipcMain.handle(ch.logMatch, (_e, input: ManualMatchInput) => provider.logMatch(input));
  ipcMain.handle(ch.saveTarget, (_e, input: AuthoredTargetInput) => {
    provider.saveTarget(input);
  });
  ipcMain.handle(ch.saveReview, (_e, input: ReviewInput) => {
    provider.saveReview(input);
  });
  ipcMain.handle(ch.importReviews, (_e, inputs: ReviewInput[]) =>
    provider.importReviews(inputs),
  );
  ipcMain.handle(ch.updateTarget, (_e, input: TargetEditInput) => {
    provider.updateTarget(input);
  });
  ipcMain.handle(ch.setTargetActive, (_e, id: string, active: boolean) => {
    provider.setTargetActive(id, active);
  });
  ipcMain.handle(ch.setTargetArchived, (_e, id: string, archived: boolean) => {
    provider.setTargetArchived(id, archived);
  });
  ipcMain.handle(ch.deleteTarget, (_e, id: string) => {
    provider.deleteTarget(id);
  });

  // Break-reminder settings.
  ipcMain.handle(ch.getBreakReminder, () => provider.getBreakReminder());
  ipcMain.handle(ch.setBreakReminder, (_e, input: BreakReminderSettings) =>
    provider.setBreakReminder(input),
  );

  // Release debug log (viewer ring, session level, renderer error forwarding).
  ipcMain.handle(ch.getLogEntries, () => provider.getLogEntries());
  ipcMain.handle(ch.getLogLevel, () => provider.getLogLevel());
  ipcMain.handle(ch.setLogLevel, (_e, level: LogLevel) => provider.setLogLevel(level));
  ipcMain.handle(ch.logRendererError, (_e, input: RendererErrorInput) => {
    provider.logRendererError(input);
  });
}

/** Window actions the title-bar channels drive, provided as closures over the owning window. */
export interface WindowControls {
  /** Minimize the dashboard window. */
  minimize(): void;
  /** Maximize, or restore when already maximized. */
  toggleMaximize(): void;
  /** Close the dashboard window (the app keeps running in the tray). */
  close(): void;
}

/** Wire the title-bar window channels to the owning window's controls. Call once per process. */
export function registerWindowControls(controls: WindowControls): void {
  // Frameless window controls, driven by the custom title bar.
  ipcMain.on(WINDOW_CHANNELS.minimize, () => controls.minimize());
  ipcMain.on(WINDOW_CHANNELS.toggleMaximize, () => controls.toggleMaximize());
  ipcMain.on(WINDOW_CHANNELS.close, () => controls.close());
}

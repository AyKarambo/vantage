import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { heroDetail } from '../../core/analytics';
import { matchDetail } from '../../core/matchDetail';
import { computeDashboard, applyFilters } from '../../core/dashboardData';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { ReadinessSettings } from '../../core/readiness';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../../shared/contract';
import type {
  AccountInput, AppUiSettings, AuthoredTargetInput, DashboardFilters, LogLevel, ManualMatchInput,
  MatchEditInput, RankAnchorInput, RendererErrorInput, ReviewInput, TargetEditInput,
} from '../../shared/contract';
import type { DataProvider } from './provider';
import { isTrustedIpcEvent } from './webContentsSecurity';

/**
 * IPC registration for the dashboard: each typed contract channel maps onto a
 * DataProvider call (data) or a window-control closure (frameless title bar).
 * Mechanical glue only — behavior lives behind the provider. Registration is
 * process-global (ipcMain), so each function must be called exactly once.
 *
 * Every channel is registered through the `handle`/`on` wrappers below, which
 * reject any IPC that does not originate from the app's own renderer frame
 * (Electron security checklist #17 — defense-in-depth behind the narrow
 * preload). Signatures mirror Electron's own (`...args: any[]`) so the typed
 * call sites are unchanged.
 */
const rawHandle = ipcMain.handle.bind(ipcMain);
const rawOn = ipcMain.on.bind(ipcMain);

/** `ipcMain.handle` that rejects untrusted senders (the renderer's invoke rejects). */
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  rawHandle(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) throw new Error(`Untrusted IPC sender on ${channel}`);
    return listener(event, ...args);
  });
}

/** `ipcMain.on` that silently drops untrusted senders (fire-and-forget channels). */
function on(
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void,
): void {
  rawOn(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event)) return;
    listener(event, ...args);
  });
}

/** Wire every dashboard data channel to the provider. Call once per process. */
export function registerDashboardIpc(provider: DataProvider): void {
  const ch = IPC_CHANNELS;
  handle(ch.getDashboard, (_e, filters: DashboardFilters) =>
    computeDashboard(provider.games(), filters ?? {}, provider.demoContext(), {
      targets: provider.manualTargets(),
      breakReminder: provider.getBreakReminder(),
      readiness: provider.getReadiness(),
      rankAnchors: provider.rankAnchorMap(),
    }),
  );
  handle(ch.exportNotion, async (_e, filters: DashboardFilters) => {
    if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
    return provider.exportToNotion(applyFilters(provider.games(), filters ?? {}));
  });
  handle(ch.heroDetail, (_e, hero: string, filters: DashboardFilters) =>
    heroDetail(applyFilters(provider.games(), filters ?? {}), hero),
  );
  // Looked up in the full history (a row must open even after filters move
  // on); the competitive estimate is scoped to the current filter set.
  handle(ch.matchDetail, (_e, matchId: string, filters: DashboardFilters) => {
    const games = provider.games();
    return matchDetail(games, matchId, applyFilters(games, filters ?? {}), provider.rankAnchorMap());
  });

  // Notion sync screen.
  handle(ch.notionStatus, () => provider.notionStatus());
  handle(ch.setNotionToken, (_e, token: string) => provider.setNotionToken(token));
  handle(ch.clearNotionToken, () => provider.clearNotionToken());
  handle(ch.listNotionDatabases, () => provider.listNotionDatabases());
  handle(ch.listNotionPages, () => provider.listNotionPages());
  handle(ch.selectNotionDatabase, (_e, databaseId: string) =>
    provider.selectNotionDatabase(databaseId),
  );
  handle(ch.createNotionDatabase, (_e, parentPageId: string) =>
    provider.createNotionDatabase(parentPageId),
  );

  // Manual (◎) writes.
  handle(ch.logMatch, (_e, input: ManualMatchInput) => provider.logMatch(input));
  handle(ch.editMatch, (_e, input: MatchEditInput) => {
    provider.editMatch(input);
  });

  // Accounts + rank (per account × role).
  handle(ch.listAccounts, () => provider.listAccounts());
  handle(ch.saveAccount, (_e, input: AccountInput) => provider.saveAccount(input));
  handle(ch.deleteAccount, (_e, battleTag: string) => provider.deleteAccount(battleTag));
  handle(ch.getRanks, () => provider.getRanks());
  handle(ch.setRankAnchor, (_e, input: RankAnchorInput) => provider.setRankAnchor(input));

  // Notion import (pull) + wipe-for-re-import.
  handle(ch.importNotion, () => provider.importNotion());
  handle(ch.deleteImportedMatches, () => provider.deleteImportedMatches());
  handle(ch.saveTarget, (_e, input: AuthoredTargetInput) => {
    provider.saveTarget(input);
  });
  handle(ch.saveReview, (_e, input: ReviewInput) => {
    provider.saveReview(input);
  });
  handle(ch.importReviews, (_e, inputs: ReviewInput[]) =>
    provider.importReviews(inputs),
  );
  handle(ch.updateTarget, (_e, input: TargetEditInput) => {
    provider.updateTarget(input);
  });
  handle(ch.setTargetActive, (_e, id: string, active: boolean) => {
    provider.setTargetActive(id, active);
  });
  handle(ch.setTargetArchived, (_e, id: string, archived: boolean) => {
    provider.setTargetArchived(id, archived);
  });
  handle(ch.deleteTarget, (_e, id: string) => {
    provider.deleteTarget(id);
  });

  // Break-reminder settings.
  handle(ch.getBreakReminder, () => provider.getBreakReminder());
  handle(ch.setBreakReminder, (_e, input: BreakReminderSettings) =>
    provider.setBreakReminder(input),
  );

  // Readiness feature settings.
  handle(ch.getReadiness, () => provider.getReadiness());
  handle(ch.setReadiness, (_e, input: ReadinessSettings) => provider.setReadiness(input));

  // Release debug log (viewer ring, session level, renderer error forwarding).
  handle(ch.getLogEntries, () => provider.getLogEntries());
  handle(ch.getLogLevel, () => provider.getLogLevel());
  handle(ch.setLogLevel, (_e, level: LogLevel) => provider.setLogLevel(level));
  handle(ch.logRendererError, (_e, input: RendererErrorInput) => {
    provider.logRendererError(input);
  });

  // Live connection/data-flow status (snapshot; changes arrive via push).
  handle(ch.getGepStatus, () => provider.getGepStatus());

  // App-behavior settings + metadata (Settings screen).
  handle(ch.getAppSettings, () => provider.getAppSettings());
  handle(ch.setAppSettings, (_e, patch: Partial<AppUiSettings>) =>
    provider.setAppSettings(patch),
  );
  handle(ch.getAppInfo, () => provider.getAppInfo());
  handle(ch.clearReview, (_e, matchId: string) => {
    provider.clearReview(matchId);
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
  on(WINDOW_CHANNELS.minimize, () => controls.minimize());
  on(WINDOW_CHANNELS.toggleMaximize, () => controls.toggleMaximize());
  on(WINDOW_CHANNELS.close, () => controls.close());
}

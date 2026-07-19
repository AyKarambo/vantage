import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { StalenessSettings } from '../../core/staleness';
import type { ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import type { GradingSettings } from '../../core/gradingSettings';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../../shared/contract';
import type {
  AccountInput, AppUiSettings, AuthoredTargetInput, DashboardFilters, LogLevel, ManualMatchInput,
  MatchEditInput, RankAnchorInput, RendererErrorInput, Result, ReviewInput, TargetEditInput,
  HeroEntry, MapEntry, SeasonEntry, AcceptedUpdate,
} from '../../shared/contract';
import type { DataProvider } from './provider';
import { isTrustedIpcEvent } from './webContentsSecurity';
import {
  dashboardRead, heroDetailRead, matchDetailRead, playerHistoryRead, filteredCompetitiveGames,
} from './reads';

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
  // Every read below delegates to `reads.ts` — the competitive-only gate and
  // season-window resolution live there so this layer stays mechanical glue
  // and no second consumer can re-derive them differently.
  handle(ch.getDashboard, (_e, filters: DashboardFilters) => dashboardRead(provider, filters));
  handle(ch.exportNotion, async (_e, filters: DashboardFilters) => {
    if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
    return provider.exportToNotion(filteredCompetitiveGames(provider, filters));
  });
  handle(ch.heroDetail, (_e, hero: string, filters: DashboardFilters) =>
    heroDetailRead(provider, hero, filters),
  );
  handle(ch.matchDetail, (_e, matchId: string, filters: DashboardFilters) =>
    matchDetailRead(provider, matchId, filters),
  );
  handle(ch.playerHistory, (_e, name: string) => playerHistoryRead(provider, name));

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
  handle(ch.deleteDetectedAccount, (_e, account: string) => provider.deleteDetectedAccount(account));
  handle(ch.getRanks, () => provider.getRanks());
  handle(ch.setRankAnchor, (_e, input: RankAnchorInput) => provider.setRankAnchor(input));
  handle(ch.mostPlayedHeroes, () => provider.mostPlayedHeroes());

  // Notion import (pull) + wipe-for-re-import.
  handle(ch.importNotion, () => provider.importNotion());
  handle(ch.deleteImportedMatches, () => provider.deleteImportedMatches());
  handle(ch.cleanupNotionDuplicates, () => provider.cleanupNotionDuplicates());

  // Local file import (Settings → Data) + independent wipe/count.
  handle(ch.importFromFile, () => provider.importFromFile());
  handle(ch.deleteFileImports, () => provider.deleteFileImports());
  handle(ch.fileImportedCount, () => provider.fileImportedCount());
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
  handle(ch.deactivateAllTargets, () => {
    provider.deactivateAllTargets();
  });

  // Target-staleness thresholds (active-target rotation cue).
  handle(ch.getStaleness, () => provider.getStaleness());
  handle(ch.setStaleness, (_e, input: StalenessSettings) => provider.setStaleness(input));

  // Break-reminder settings.
  handle(ch.getBreakReminder, () => provider.getBreakReminder());
  handle(ch.setBreakReminder, (_e, input: BreakReminderSettings) =>
    provider.setBreakReminder(input),
  );

  // Readiness feature settings.
  handle(ch.getReadiness, () => provider.getReadiness());
  handle(ch.setReadiness, (_e, input: ReadinessSettings) => provider.setReadiness(input));

  // "Current session" gap threshold.
  handle(ch.getSessionSettings, () => provider.getSessionSettings());
  handle(ch.setSessionSettings, (_e, input: SessionSettings) => provider.setSessionSettings(input));

  // Measured-grade settings (partial-credit margin).
  handle(ch.getGrading, () => provider.getGrading());
  handle(ch.setGrading, (_e, input: GradingSettings) => provider.setGrading(input));

  // Release debug log (viewer ring, session level, renderer error forwarding).
  handle(ch.getLogEntries, () => provider.getLogEntries());
  handle(ch.getLogLevel, () => provider.getLogLevel());
  handle(ch.setLogLevel, (_e, level: LogLevel) => provider.setLogLevel(level));
  handle(ch.logRendererError, (_e, input: RendererErrorInput) => {
    provider.logRendererError(input);
  });
  handle(ch.exportLogBundle, () => provider.exportLogBundle());

  // Live connection/data-flow status (snapshot; changes arrive via push).
  handle(ch.getGepStatus, () => provider.getGepStatus());
  handle(ch.getDevModeAuthStatus, () => provider.getDevModeAuthStatus());

  // App-behavior settings + metadata (Settings screen).
  handle(ch.getAppSettings, () => provider.getAppSettings());
  handle(ch.setAppSettings, (_e, patch: Partial<AppUiSettings>) =>
    provider.setAppSettings(patch),
  );
  handle(ch.setDevKey, (_e, key: string) => provider.setDevKey(key));
  handle(ch.getAppInfo, () => provider.getAppInfo());
  handle(ch.openExternal, (_e, url: string) => provider.openExternal(url));
  handle(ch.applyGepUpdate, () => provider.applyGepUpdate());

  // Data-location (Settings "Data storage" card + first-run folder prompt).
  handle(ch.getDataLocation, () => provider.getDataLocation());
  handle(ch.chooseDataFolder, () => provider.chooseDataFolder());
  handle(ch.setDataFolder, (_e, input: { folder: string; adopt?: boolean }) =>
    provider.setDataFolder(input),
  );
  handle(ch.chooseFirstRunDataFolder, () => provider.chooseFirstRunDataFolder());

  handle(ch.clearReview, (_e, matchId: string) => {
    provider.clearReview(matchId);
  });

  // "Needs result" resolve: complete a held no-outcome match with a win/loss/draw.
  handle(ch.resolvePendingMatch, (_e, matchId: string, result: Result) => {
    provider.resolvePendingMatch(matchId, result);
  });

  // "Needs result" dismiss: drop a held match the user says wasn't a real game.
  handle(ch.dismissPendingMatch, (_e, matchId: string) => {
    provider.dismissPendingMatch(matchId);
  });

  // Editable master data (heroes/maps/seasons) + the Update fetch.
  handle(ch.masterDataGet, () => provider.effectiveMasterData());
  handle(ch.masterDataUpsertHero, (_e, entry: HeroEntry) => provider.masterDataUpsertHero(entry));
  handle(ch.masterDataRemoveHero, (_e, name: string) => provider.masterDataRemoveHero(name));
  handle(ch.masterDataUpsertMap, (_e, entry: MapEntry) => provider.masterDataUpsertMap(entry));
  handle(ch.masterDataRemoveMap, (_e, name: string) => provider.masterDataRemoveMap(name));
  handle(ch.masterDataUpsertSeason, (_e, entry: SeasonEntry) => provider.masterDataUpsertSeason(entry));
  handle(ch.masterDataRemoveSeason, (_e, id: string) => provider.masterDataRemoveSeason(id));
  handle(ch.masterDataFetchUpdate, () => provider.masterDataFetchUpdate());
  handle(ch.masterDataApplyUpdate, (_e, accepted: AcceptedUpdate) => provider.masterDataApplyUpdate(accepted));
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

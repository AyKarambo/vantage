import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import { heroDetail, type GameRecord } from '../../core/analytics';
import { matchDetail } from '../../core/matchDetail';
import { computeDashboard, applyFilters } from '../../core/dashboardData';
import { makeMapMode } from '../../core/masterData';
import { isCompetitive } from '../../core/matchFilter';
import type { BreakReminderSettings } from '../../core/breakReminder';
import type { StalenessSettings } from '../../core/staleness';
import type { ReadinessSettings } from '../../core/readiness';
import type { SessionSettings } from '../../core/sessionSettings';
import { IPC_CHANNELS, WINDOW_CHANNELS } from '../../shared/contract';
import type {
  AccountInput, AppUiSettings, AuthoredTargetInput, DashboardFilters, LogLevel, ManualMatchInput,
  MatchEditInput, RankAnchorInput, RendererErrorInput, ReviewInput, TargetEditInput,
  HeroEntry, MapEntry, SeasonEntry, AcceptedUpdate,
} from '../../shared/contract';
import type { DataProvider } from './provider';
import { isTrustedIpcEvent } from './webContentsSecurity';

/**
 * Vantage is competitive-only (spec D1): scope a games list down to
 * competitive rows. `computeDashboard` already does this internally for the
 * main dashboard payload; every *other* feed that reads `provider.games()`
 * directly (export, hero drilldown, match detail) must apply the same gate
 * so a non-competitive row already in the DB never surfaces there either.
 */
function competitiveOnly(games: GameRecord[]): GameRecord[] {
  return games.filter((g) => isCompetitive(g.gameType));
}

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
    computeDashboard(
      provider.games(),
      filters ?? {},
      provider.demoContext(),
      {
        targets: provider.manualTargets(),
        breakReminder: provider.getBreakReminder(),
        staleness: provider.getStaleness(),
        readiness: provider.getReadiness(),
        sessionSettings: provider.getSessionSettings(),
        rankAnchors: provider.rankAnchorMap(),
      },
      provider.effectiveMasterData(),
    ),
  );
  // Every filter-scoped read must resolve a `{ season: id }` filter against the
  // SAME effective season starts computeDashboard uses (so a user-added,
  // off-cadence season resolves to its window instead of silently falling back
  // to the 30-day default). `seasonStarts()` pulls them from the effective
  // master data, exactly as the dashboard payload does.
  const seasonStarts = (): number[] => provider.effectiveMasterData().seasons.map((s) => s.start);
  handle(ch.exportNotion, async (_e, filters: DashboardFilters) => {
    if (!provider.exportToNotion) return { ok: 0, failed: 0, unavailable: true };
    return provider.exportToNotion(applyFilters(competitiveOnly(provider.games()), filters ?? {}, seasonStarts()));
  });
  handle(ch.heroDetail, (_e, hero: string, filters: DashboardFilters) =>
    heroDetail(applyFilters(competitiveOnly(provider.games()), filters ?? {}, seasonStarts()), hero),
  );
  // Looked up in the full (competitive-only) history (a row must open even
  // after filters move on); the competitive-estimate CONTEXT is scoped to
  // the current filter set, on top of the same competitive-only gate.
  handle(ch.matchDetail, (_e, matchId: string, filters: DashboardFilters) => {
    const games = competitiveOnly(provider.games());
    const master = provider.effectiveMasterData();
    const mapModeOf = makeMapMode(master.maps);
    const filtered = applyFilters(games, filters ?? {}, master.seasons.map((s) => s.start));
    return matchDetail(games, matchId, filtered, provider.rankAnchorMap(), mapModeOf);
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
  handle(ch.setDevKey, (_e, key: string) => provider.setDevKey(key));
  handle(ch.getAppInfo, () => provider.getAppInfo());
  handle(ch.openExternal, (_e, url: string) => provider.openExternal(url));

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

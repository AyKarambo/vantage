import type { DataProvider } from './dashboard';
import type { HistoryStore } from '../store/history';
import type { ManualStore } from '../store/manualLog';
import type { NotionRuntime } from './notionRuntime';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { normalizeBreakReminder, type BreakReminderSettings } from '../core/breakReminder';
import { normalizeReadiness, type ReadinessSettings } from '../core/readiness';
import { effectiveDemo } from '../core/demoPreference';
import { LOG_LEVELS, type LogLevel } from '../core/logging';
import { currentRank, type RankAnchorMap } from '../core/rank';
import { sourceOf } from '../core/source';
import {
  DEFAULT_MASTER_DATA, mergeMasterData, applyAccepted, diffMasterData,
  upsertHeroOverride, removeHeroOverride, upsertMapOverride, removeMapOverride,
  upsertSeasonOverride, removeSeasonOverride, type FetchedCatalog, type MasterData,
} from '../core/masterData';
import type { RankAnchorStore } from '../store/rankAnchors';
import type { MasterDataStore } from '../store/masterData';
import type {
  AccountSummary, AppInfo, AppUiSettings, DataLocation, DataLocationResult,
  GepStatusPayload, MatchEditInput, RankSummary,
} from '../shared/contract';
import type { GameRecord } from '../core/analytics';

/**
 * Builds the {@link DataProvider} the dashboard consumes: every renderer-facing
 * read/write, mapped onto injected stores and edges. No Electron imports (deps
 * are type-only slices) — the composition root in ./index supplies the real
 * services.
 */

/** Backing services for the dashboard's DataProvider, as narrow structural slices so tests can inject plain objects. */
export interface DataProviderDeps {
  /** Durable game history: dataset reads plus review + manual-layer writes. */
  history: Pick<HistoryStore, 'count' | 'all' | 'setReview' | 'setReviews' | 'clearReview' | 'editManual' | 'addMany' | 'mergeImported' | 'relabelAccount' | 'removeImported'>;
  /** Authored-target (◎ manual) persistence. */
  manual: Pick<ManualStore, 'targets' | 'addTarget' | 'updateTarget' | 'setActive' | 'setArchived' | 'removeTarget'>;
  /** Per-(account, role) rank anchors for the calculated-rank engine. */
  rankAnchors: Pick<RankAnchorStore, 'all' | 'get' | 'map' | 'set' | 'relabel'>;
  /** Persisted master-data override deltas (heroes/maps/seasons add/edit/remove). */
  masterDataStore: Pick<MasterDataStore, 'all' | 'replace'>;
  /** The online-catalog fetch edge (main-process `net.fetch` of OverFast); injected so this stays Electron-free. */
  fetchMasterDataUpdate(): Promise<FetchedCatalog>;
  /** The Notion edge: export/import, status, token lifecycle, the database picker, and the
   *  export-ledger clear (so a deleted imported match starts fresh on re-import/re-export). */
  notion: Pick<
    NotionRuntime,
    | 'export' | 'import' | 'status' | 'setToken' | 'clearToken'
    | 'listDatabases' | 'listPages' | 'selectDatabase' | 'createDatabase' | 'clearExports'
    | 'cleanupDuplicates'
  >;
  /** Live app config — re-read on every use (accounts, breakReminder), never cached. */
  getConfig(): AppConfig;
  /** Persist the full accounts map (battleTag → label) into the user's local config. */
  persistAccounts(accounts: Record<string, string>): void;
  /** Persist new break-reminder settings into the user's local config file. */
  persistBreakReminder(s: BreakReminderSettings): void;
  /** Persist new readiness feature settings into the user's local config file. */
  persistReadiness(s: ReadinessSettings): void;
  /** Match-pipeline entry for manually logged games (same dedupe + reminder path as live ones). */
  recordGame(g: GameRecord): boolean;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /** Demo dataset shown until the first real game is tracked. */
  sampleGames(): GameRecord[];
  /** The release log: viewer ring, session level, renderer error sink. */
  logger: Pick<Logger, 'entries' | 'getLevel' | 'setLevel' | 'error'>;
  /** Live connection/data-flow status snapshot (from the GEP status monitor). */
  gepStatus(): GepStatusPayload;
  /** App-behavior settings: current values + apply/persist (owned by the composition root). */
  appSettings: {
    get(): AppUiSettings;
    apply(patch: Partial<AppUiSettings>): AppUiSettings;
  };
  /** Version + support contact for the About card. */
  appInfo(): AppInfo;
  /** Data-folder location: current value, Settings folder-picker/migrate, and the
   *  first-run picker (owned by the composition root — it holds the mutable data
   *  dir and the live store handles the migration executor repoints). */
  dataLocation: {
    get(): DataLocation;
    choose(): Promise<DataLocationResult>;
    set(input: { folder: string; adopt?: boolean }): Promise<DataLocationResult>;
    chooseFirstRun(): Promise<DataLocationResult>;
  };
}

/** Assemble the dashboard's DataProvider over the injected deps. */
export function createDataProvider(deps: DataProviderDeps): DataProvider {
  const demoPref = () => deps.getConfig().ui.demoPreference;
  const effectiveMasterData = (): MasterData => mergeMasterData(DEFAULT_MASTER_DATA, deps.masterDataStore.all());
  return {
    // Sample games fill an empty history ONLY when the user opted into demo mode;
    // a fresh-start user sees nothing until they track real matches.
    games: () => (deps.history.count() ? deps.history.all() : demoPref() === 'on' ? deps.sampleGames() : []),
    isSample: () => effectiveDemo(demoPref(), deps.history.count()),
    demoContext: () => ({
      active: effectiveDemo(demoPref(), deps.history.count()),
      preference: demoPref(),
      hasRealHistory: deps.history.count() > 0,
    }),
    exportToNotion: (games) => deps.notion.export(games),
    notionStatus: () => deps.notion.status(),
    setNotionToken: (token) => deps.notion.setToken(token),
    clearNotionToken: () => deps.notion.clearToken(),
    manualTargets: () => deps.manual.targets(),
    saveTarget: (input) => {
      deps.manual.addTarget({
        id: `t-${Date.now()}`, createdAt: Date.now(), isActive: true, scope: 'season', ...input,
      });
    },
    saveReview: (input) => {
      deps.history.setReview(input.matchId, { at: Date.now(), grades: input.grades, flags: input.flags });
    },
    importReviews: (inputs) =>
      deps.history.setReviews(inputs.map((i) => ({
        matchId: i.matchId,
        review: { at: Date.now(), grades: i.grades, flags: i.flags },
      }))),
    updateTarget: (input) => {
      deps.manual.updateTarget(input.id, { name: input.name, mode: input.mode, rule: input.rule });
    },
    setTargetActive: (id, active) => deps.manual.setActive(id, active),
    setTargetArchived: (id, archived) => deps.manual.setArchived(id, archived),
    deleteTarget: (id) => deps.manual.removeTarget(id),
    logMatch: (input) => {
      const matchId = `manual-${Date.now()}`;
      const grades = input.grades && Object.keys(input.grades).length ? input.grades : undefined;
      deps.recordGame({
        matchId,
        timestamp: input.playedAt != null ? Math.min(input.playedAt, Date.now()) : Date.now(),
        account: input.account || Object.values(deps.getConfig().accounts)[0] || 'You',
        role: input.role,
        map: input.map,
        result: input.result,
        gameType: input.gameType,
        source: 'manual',
        heroes: input.hero ? [input.hero] : [],
        mental: input.mental,
        ...(input.srDelta != null ? { srDelta: input.srDelta } : {}),
        // Inline target grades captured while logging are stored as a review, the
        // same shape the Review screen writes — so they score identically.
        ...(grades ? { review: { at: Date.now(), grades, flags: input.mental ?? {} } } : {}),
      });
      deps.notify('Match logged', `${input.result} · ${input.map}`);
      return { matchId };
    },
    editMatch: (input: MatchEditInput) => {
      const game = deps.history.all().find((g) => g.matchId === input.matchId);
      if (!game) return;
      const isManual = sourceOf(game) === 'manual';
      const patch: Parameters<HistoryStore['editManual']>[1] = {};
      // Game-derived facts are editable only for hand-logged matches; auto-tracked
      // (GEP) matches keep them locked.
      if (isManual) {
        if (input.result !== undefined) patch.result = input.result;
        if (input.role !== undefined) patch.role = input.role;
        if (input.map !== undefined) patch.map = input.map;
        if (input.gameType !== undefined) patch.gameType = input.gameType;
        if (input.hero !== undefined) patch.heroes = input.hero ? [input.hero] : [];
      }
      // The manual layer applies to any match. srDelta: number sets it, null
      // clears it (editManual deletes on null), undefined leaves it unchanged.
      if (input.mental !== undefined) patch.mental = input.mental;
      if (input.srDelta !== undefined) patch.srDelta = input.srDelta;
      // Only stamp a review when there are grades — an edit with no targets
      // shouldn't mark an otherwise-ungraded match as reviewed.
      if (input.grades && Object.keys(input.grades).length) {
        patch.review = { at: Date.now(), grades: input.grades, flags: input.mental ?? game.mental ?? {} };
      }
      deps.history.editManual(input.matchId, patch);
    },
    listAccounts: () => accountList(deps.getConfig().accounts),
    saveAccount: (input) => {
      const accounts = { ...deps.getConfig().accounts };
      const newLabel = input.label || input.battleTag;
      // Renaming the label: cascade onto stored games + rank anchors (both key by
      // label) so existing history and rank tracks stay attached, not orphaned.
      const oldLabel = input.previousBattleTag ? accounts[input.previousBattleTag] : undefined;
      if (input.previousBattleTag && input.previousBattleTag !== input.battleTag) {
        delete accounts[input.previousBattleTag];
      }
      if (oldLabel && oldLabel !== newLabel) {
        deps.history.relabelAccount(oldLabel, newLabel);
        deps.rankAnchors.relabel(oldLabel, newLabel);
      }
      accounts[input.battleTag] = newLabel;
      deps.persistAccounts(accounts);
      return accountList(accounts);
    },
    deleteAccount: (battleTag) => {
      const accounts = { ...deps.getConfig().accounts };
      delete accounts[battleTag];
      deps.persistAccounts(accounts);
      return accountList(accounts);
    },
    getRanks: () => rankSummaries(deps),
    setRankAnchor: (input) => {
      deps.rankAnchors.set({
        account: input.account,
        role: input.role,
        tier: input.tier,
        division: input.division,
        progressPct: input.progressPct,
        setAt: Date.now(),
      });
      return rankSummaries(deps);
    },
    rankAnchorMap: (): RankAnchorMap => deps.rankAnchors.map(),
    importNotion: async () => {
      const res = await deps.notion.import();
      if (res.unavailable) return { imported: 0, skipped: 0, failed: 0, unavailable: true };
      if (res.error) return { imported: 0, skipped: 0, failed: res.failed, error: res.error };
      // Split the imported rows: brand-new matchIds go through `addMany` (they
      // arrive already reviewed when Notion carried a grade — that's fine, a
      // fresh row has no local state to protect); matchIds already tracked
      // locally go through `mergeImported`, which never overwrites an existing
      // review or mental record (local always wins) but fills in a bookkeeping
      // grade / adopts mental flags when the local match has none at all. No
      // `AuthoredTarget` is ever seeded for the imported grade — B2 keeps it a
      // hidden bookkeeping value on the match review only.
      const known = new Set(deps.history.all().map((g) => g.matchId));
      const fresh = res.games.filter((g) => !known.has(g.matchId));
      const existing = res.games.filter((g) => known.has(g.matchId));
      // Stamp every brand-new imported game so it can be wiped for a clean
      // re-import (removeImported) without touching live-tracked or
      // hand-logged matches. A merged row keeps its existing provenance.
      const importedAt = Date.now();
      const { imported } = deps.history.addMany(fresh.map((g) => ({ ...g, importedAt })));
      const { merged, skipped } = deps.history.mergeImported(existing);
      // Surface the imported accounts so they appear in the account manager, the
      // filters and the rank UI — Notion only stores the account *label*, not the
      // battleTag, so each becomes a name-only entry that live play reconnects to.
      const accountsAdded = seedImportedAccounts(deps, res.games);
      return {
        imported, skipped, failed: res.failed,
        ...(merged ? { merged } : {}),
        ...(accountsAdded ? { accountsAdded } : {}),
        ...(res.duplicates ? { duplicates: res.duplicates } : {}),
      };
    },
    deleteImportedMatches: () => {
      const removed = deps.history.removeImported();
      deps.notion.clearExports(removed.map((g) => g.matchId));
      return { deleted: removed.length };
    },
    cleanupNotionDuplicates: () => deps.notion.cleanupDuplicates(),
    getBreakReminder: () => deps.getConfig().breakReminder,
    setBreakReminder: (input) => {
      const config = deps.getConfig();
      config.breakReminder = normalizeBreakReminder(input);
      deps.persistBreakReminder(config.breakReminder);
      return config.breakReminder;
    },
    getReadiness: () => deps.getConfig().readiness,
    setReadiness: (input) => {
      const config = deps.getConfig();
      config.readiness = normalizeReadiness(input);
      deps.persistReadiness(config.readiness);
      return config.readiness;
    },
    listNotionDatabases: () => deps.notion.listDatabases(),
    listNotionPages: () => deps.notion.listPages(),
    selectNotionDatabase: (databaseId) => deps.notion.selectDatabase(databaseId),
    createNotionDatabase: (parentPageId) => deps.notion.createDatabase(parentPageId),
    getLogEntries: () => deps.logger.entries(),
    getLogLevel: () => deps.logger.getLevel(),
    setLogLevel: (level) => {
      // Untrusted over IPC — an unknown level would silence the log entirely.
      if (LOG_LEVELS.includes(level as LogLevel)) deps.logger.setLevel(level);
      return deps.logger.getLevel();
    },
    logRendererError: (input) => {
      deps.logger.error('renderer', input.message, {
        ...(input.source ? { source: input.source } : {}),
        ...(input.stack ? { stack: input.stack } : {}),
      });
    },
    getGepStatus: () => deps.gepStatus(),
    getAppSettings: () => deps.appSettings.get(),
    setAppSettings: (patch) => deps.appSettings.apply(patch),
    getAppInfo: () => deps.appInfo(),
    getDataLocation: () => deps.dataLocation.get(),
    chooseDataFolder: () => deps.dataLocation.choose(),
    setDataFolder: (input) => deps.dataLocation.set(input),
    chooseFirstRunDataFolder: () => deps.dataLocation.chooseFirstRun(),
    clearReview: (matchId) => {
      deps.history.clearReview(matchId);
    },
    effectiveMasterData,
    masterDataUpsertHero: (entry) => {
      deps.masterDataStore.replace(upsertHeroOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveHero: (name) => {
      deps.masterDataStore.replace(removeHeroOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, name));
      return effectiveMasterData();
    },
    masterDataUpsertMap: (entry) => {
      deps.masterDataStore.replace(upsertMapOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveMap: (name) => {
      deps.masterDataStore.replace(removeMapOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, name));
      return effectiveMasterData();
    },
    masterDataUpsertSeason: (entry) => {
      deps.masterDataStore.replace(upsertSeasonOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, entry));
      return effectiveMasterData();
    },
    masterDataRemoveSeason: (id) => {
      deps.masterDataStore.replace(removeSeasonOverride(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, id));
      return effectiveMasterData();
    },
    masterDataFetchUpdate: async () => {
      const fetched = await deps.fetchMasterDataUpdate();
      return diffMasterData(effectiveMasterData(), fetched);
    },
    masterDataApplyUpdate: (accepted) => {
      deps.masterDataStore.replace(applyAccepted(deps.masterDataStore.all(), DEFAULT_MASTER_DATA, accepted));
      return effectiveMasterData();
    },
  };
}

/**
 * Register a name-only account (`label → label`) for every distinct account
 * label in the imported games that isn't already represented in the config
 * (compared case-insensitively, since {@link resolveAccount} matches that way).
 * Notion's `Account` column carries only the label, never the battleTag, so a
 * name-only entry is the faithful seed: it lists/rank-anchors the account and,
 * via `resolveAccount`'s name-only fallback, reconnects to live GEP play from
 * the real battleTag later. Returns how many were added.
 */
function seedImportedAccounts(deps: DataProviderDeps, games: GameRecord[]): number {
  const accounts = { ...deps.getConfig().accounts };
  const known = new Set(Object.values(accounts).map((label) => label.toLowerCase()));
  let added = 0;
  for (const label of new Set(games.map((g) => g.account))) {
    if (!label || known.has(label.toLowerCase())) continue;
    accounts[label] = label; // name-only entry: battleTag key == label
    known.add(label.toLowerCase());
    added++;
  }
  if (added) deps.persistAccounts(accounts);
  return added;
}

/** Shape the accounts map (battleTag → label) into the contract's summary list. */
function accountList(accounts: Record<string, string>): AccountSummary[] {
  return Object.entries(accounts).map(([battleTag, label]) => ({ battleTag, label: label || battleTag }));
}

/** Compute the live rank for every anchored (account, role). */
function rankSummaries(deps: DataProviderDeps): RankSummary[] {
  const games = deps.history.all();
  const map = deps.rankAnchors.map();
  return deps.rankAnchors.all().map((a) => {
    const s = currentRank(games, map, a.account, a.role);
    return {
      account: a.account,
      role: a.role,
      tier: s?.tier ?? a.tier,
      division: s?.division ?? a.division,
      progressPct: s?.progressPct ?? a.progressPct,
      protected: s?.protected ?? false,
      needsReanchor: s?.needsReanchor ?? false,
    };
  });
}

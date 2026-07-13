import type { DataProvider } from './dashboard';
import type { HistoryStore } from '../store/history';
import type { ManualStore } from '../store/manualLog';
import type { NotionRuntime } from './notionRuntime';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { normalizeBreakReminder, type BreakReminderSettings } from '../core/breakReminder';
import { normalizeStaleness, type StalenessSettings } from '../core/staleness';
import { normalizeReadiness, type ReadinessSettings } from '../core/readiness';
import { normalizeSessionSettings, type SessionSettings } from '../core/sessionSettings';
import { effectiveDemo } from '../core/demoPreference';
import { openIfAllowed } from '../core/externalLink';
import { LOG_LEVELS, type LogLevel } from '../core/logging';
import { currentRank, srDeltaForSetRank, type RankAnchorMap } from '../core/rank';
import { classifyGameType } from '../core/matchFilter';
import { sourceOf } from '../core/source';
import { parseVantageImport } from '../core/importEnvelope';
import { mostPlayedHeroes as rankHeroesByPlays } from '../core/analytics';
import { mergeAccountList } from '../core/accountsManage';
import { resolveRole } from '../core/resolvers/role';
import { resolveAccount } from '../core/resolvers/account';
import { resolveMapId } from '../core/resolvers/mapId';
import { resolveResult } from '../core/resolvers/result';
import type { Role, Result, MatchRecord } from '../core/model';
import {
  DEFAULT_MASTER_DATA, mergeMasterData, applyAccepted, diffMasterData,
  upsertHeroOverride, removeHeroOverride, upsertMapOverride, removeMapOverride,
  upsertSeasonOverride, removeSeasonOverride, type FetchedCatalog, type MasterData,
} from '../core/masterData';
import type { RankAnchorStore } from '../store/rankAnchors';
import type { MasterDataStore } from '../store/masterData';
import type {
  AccountSummary, AppInfo, AppUiSettings, DataLocation, DataLocationResult,
  GepStatusPayload, ImportFileResult, MatchEditInput, PendingMatch, RankSummary,
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
  /** Durable game history: dataset reads plus review + manual-layer writes, account
   *  management (relabel/delete), and the pending-store read. */
  history: Pick<HistoryStore, 'count' | 'all' | 'setReview' | 'setReviews' | 'clearReview' | 'editManual' | 'addMany' | 'mergeImported' | 'relabelAccount' | 'deleteByAccount' | 'removeImported' | 'importedCount' | 'allPending'>;
  /** Authored-target (◎ manual) persistence. */
  manual: Pick<ManualStore, 'targets' | 'addTarget' | 'updateTarget' | 'setActive' | 'deactivateAll' | 'setArchived' | 'removeTarget'>;
  /** Per-(account, role) rank anchors for the calculated-rank engine. */
  rankAnchors: Pick<RankAnchorStore, 'all' | 'get' | 'map' | 'set' | 'relabel' | 'removeAccount'>;
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
  /**
   * The file-import edge: show a picker, read the chosen file, and JSON.parse it.
   * Injected so this provider stays Electron/fs-free (mirrors {@link dataLocation}).
   * Resolves `undefined` when the user cancels; throws when the file can't be read
   * or isn't JSON (the caller turns that into an error result).
   */
  importFile: { pick(): Promise<unknown | undefined> };
  /** Persist new break-reminder settings into the user's local config file. */
  persistBreakReminder(s: BreakReminderSettings): void;
  /** Persist new target-staleness thresholds into the user's local config file. */
  persistStaleness(s: StalenessSettings): void;
  /** Persist new readiness feature settings into the user's local config file. */
  persistReadiness(s: ReadinessSettings): void;
  /** Persist a new session-gap threshold into the user's local config file. */
  persistSessionSettings(s: SessionSettings): void;
  /** Match-pipeline entry for manually logged games (same dedupe + reminder path as live ones). */
  recordGame(g: GameRecord): boolean;
  /** Match-pipeline entry to complete a held pending match (takes it out of the pending store into history). */
  resolvePending(matchId: string, result: Result): boolean;
  /** Match-pipeline entry to dismiss a held pending match (removes it from the pending store; never logged). */
  dismissPending(matchId: string): boolean;
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
  /** Persist the Overwolf dev key to ~/.ow-cli/dev-key; returns whether one is now present. */
  setDevKey(key: string): { hasKey: boolean };
  /** Version + build/runtime facts + support contact for the About screen. */
  appInfo(): AppInfo;
  /** Open an external URL — the composition root's `shell.openExternal`. */
  openExternal(url: string): Promise<void>;
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
  // The manageable account list: configured accounts unioned with the accounts
  // only detected in history (Unknown bucket + unlabelled raw BattleTags),
  // de-duped by resolveAccount matching. Read live from config + history so it
  // reflects every account mutation immediately.
  const accountList = (): AccountSummary[] =>
    mergeAccountList(deps.getConfig().accounts, deps.history.all().map((g) => g.account));
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
      const now = Date.now();
      deps.manual.addTarget({
        id: `t-${now}`, createdAt: now, isActive: true, activatedAt: now, scope: 'season', ...input,
      });
    },
    saveReview: (input) => {
      deps.history.setReview(input.matchId, { at: Date.now(), grades: input.grades, flags: input.flags });
      if (input.performance !== undefined) deps.history.editManual(input.matchId, { performance: input.performance });
      // GEP can't report SR, so the player may set it here (competitive only);
      // `null` clears, `undefined` leaves it unchanged (editManual deletes on null).
      if (input.srDelta !== undefined) deps.history.editManual(input.matchId, { srDelta: input.srDelta });
    },
    importReviews: (inputs) =>
      deps.history.setReviews(inputs.map((i) => ({
        matchId: i.matchId,
        review: { at: Date.now(), grades: i.grades, flags: i.flags },
      }))),
    updateTarget: (input) => {
      deps.manual.updateTarget(input.id, {
        name: input.name, mode: input.mode, rule: input.rule,
        roleScope: input.roleScope, heroScope: input.heroScope,
      });
    },
    setTargetActive: (id, active) => deps.manual.setActive(id, active),
    deactivateAllTargets: () => deps.manual.deactivateAll(),
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
        heroes: input.heroes ?? (input.hero ? [input.hero] : []),
        mental: input.mental,
        ...(input.srDelta != null ? { srDelta: input.srDelta } : {}),
        ...(input.performance != null ? { performance: input.performance } : {}),
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
        // `heroes` (the multi-hero list) wins when provided; fall back to the
        // legacy single-hero coercion. Both honour `[]`/'' as "clear the list".
        if (input.heroes !== undefined) patch.heroes = input.heroes;
        else if (input.hero !== undefined) patch.heroes = input.hero ? [input.hero] : [];
      }
      // The manual layer applies to any match. srDelta: number sets it, null
      // clears it (editManual deletes on null), undefined leaves it unchanged.
      if (input.mental !== undefined) patch.mental = input.mental;
      // Competitive rank input: either a direct srDelta (Change mode) or an
      // absolute "rank after this match" (Set-current mode) we back-compute a
      // srDelta from. setRank wins over srDelta when both are present.
      if (classifyGameType(game.gameType) === 'competitive' && input.setRank) {
        // Rank is tracked per (account, role) — key the back-compute/anchor on the
        // role the match will actually LAND on (a manual edit can change role in the
        // same save), not the pre-edit role, so the derived srDelta/anchor go onto
        // the correct ladder.
        const rankRole = patch.role ?? game.role;
        const anchor = deps.rankAnchors.get(game.account, rankRole);
        if (anchor) {
          // Derive the SR % from the entered rank and the reconstructed rank
          // before this match; the live anchor is left untouched.
          patch.srDelta = srDeltaForSetRank(
            deps.history.all(), deps.rankAnchors.map(), game.account, rankRole, game.timestamp, input.setRank,
          );
        } else {
          // No anchor yet → bootstrap one at this match (nothing before it to diff
          // against, so no srDelta is derived) — mirrors log-match's "no anchor →
          // Set current rank establishes the anchor".
          deps.rankAnchors.set({
            account: game.account,
            role: rankRole,
            tier: input.setRank.tier,
            division: input.setRank.division,
            progressPct: input.setRank.progressPct,
            setAt: game.timestamp,
          });
        }
      } else if (input.srDelta !== undefined) {
        patch.srDelta = input.srDelta;
      }
      if (input.performance !== undefined) patch.performance = input.performance;
      // Stamp a review when there are grades to save, OR when the match is
      // already reviewed — an edit with no targets shouldn't mark an otherwise-
      // ungraded match as reviewed, but if it's already reviewed we must
      // re-stamp review.flags alongside patch.mental so the two layers can't
      // drift (an editor flag-only edit would otherwise leave review.flags
      // stale while mental moves on, resurrecting the old flag on read).
      const hasGrades = !!(input.grades && Object.keys(input.grades).length);
      if (hasGrades || game.review) {
        patch.review = {
          at: Date.now(),
          grades: hasGrades ? input.grades! : game.review?.grades ?? {},
          flags: input.mental ?? game.mental ?? {},
        };
      }
      deps.history.editManual(input.matchId, patch);
    },
    listAccounts: () => accountList(),
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
      } else if (!oldLabel && input.battleTag !== newLabel) {
        // Labelling a detected raw-tag account: its history rows + anchors are
        // keyed by the raw BattleTag, so adopt the new label — the raw-tag entry
        // then de-dupes into this configured one instead of lingering. (A no-op
        // for a brand-new account with no matching history.)
        deps.history.relabelAccount(input.battleTag, newLabel);
        deps.rankAnchors.relabel(input.battleTag, newLabel);
      }
      accounts[input.battleTag] = newLabel;
      deps.persistAccounts(accounts);
      return accountList();
    },
    deleteAccount: (battleTag) => {
      // Non-destructive: drops the configured label only. History rows keep their
      // account value (they'll resurface as a detected-unlabelled entry if any
      // exist) — deleting match data is the separate deleteDetectedAccount path.
      const accounts = { ...deps.getConfig().accounts };
      delete accounts[battleTag];
      deps.persistAccounts(accounts);
      return accountList();
    },
    deleteDetectedAccount: (account) => {
      // IRREVERSIBLE (gated behind a renderer confirm): wipe every history row
      // stored under this exact account value plus its per-role rank anchors.
      // Touches no config — a detected account was never a configured label.
      deps.history.deleteByAccount(account);
      deps.rankAnchors.removeAccount(account);
      return accountList();
    },
    getRanks: () => rankSummaries(deps),
    mostPlayedHeroes: () => mostPlayedHeroesByAccount(deps),
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
      // hand-logged matches. `importSource:'notion'` keeps this clear scoped to
      // Notion imports (file imports are a separate bucket). A merged row keeps
      // its existing provenance.
      const importedAt = Date.now();
      const { imported } = deps.history.addMany(
        fresh.map((g) => ({ ...g, importedAt, importSource: 'notion' as const })),
      );
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
      const removed = deps.history.removeImported('notion');
      deps.notion.clearExports(removed.map((g) => g.matchId));
      return { deleted: removed.length };
    },
    importFromFile: async (): Promise<ImportFileResult> => {
      const empty = { imported: 0, skipped: 0, invalid: 0, accountsAdded: 0, anchorSet: false };
      let raw: unknown;
      try {
        const picked = await deps.importFile.pick();
        if (picked === undefined) return { ...empty, cancelled: true };
        raw = picked;
      } catch (err) {
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
      }
      const parsed = parseVantageImport(raw);
      // `invalid` counts only rejected match ROWS (index !== null); envelope- and
      // anchor-level problems (index === null) are surfaced via `error`/`anchorSet`.
      const invalid = parsed.errors.filter((e) => e.index !== null).length;
      // Nothing importable AND an envelope-level problem → reject cleanly, write nothing.
      if (!parsed.games.length) {
        const envelopeErr = parsed.errors.find((e) => e.index === null);
        if (envelopeErr) return { ...empty, invalid, error: envelopeErr.reason };
      }
      // Mark every added game as file-imported so it can be wiped for a clean
      // re-sync without touching live, hand-logged, or Notion-imported matches.
      const importedAt = Date.now();
      const { imported, skipped } = deps.history.addMany(
        parsed.games.map((g) => ({ ...g, importedAt, importSource: 'file' as const })),
      );
      const accountsAdded = seedImportedAccounts(deps, parsed.games);
      let anchorSet = false;
      if (parsed.anchor && parsed.account) {
        // Anchor at the latest imported competitive match for this (account, role):
        // the rank engine reconstructs older matches backward from the supplied
        // current rank. `rankAnchors.set` directly (NOT setRankAnchor, which would
        // stamp setAt=now and exclude every match from the ladder).
        const { anchor, account } = parsed;
        const latest = parsed.games
          .filter((g) => g.account === account && g.role === anchor.role && classifyGameType(g.gameType) === 'competitive')
          .reduce((max, g) => Math.max(max, g.timestamp), 0);
        // Don't backdate over a newer anchor the player set by hand (or via a later
        // import): only (re)set when there's no anchor yet, or this file's latest
        // match is at least as recent as the existing anchor. A plain re-import of
        // the same file re-sets the identical value (harmless).
        const existing = deps.rankAnchors.get(account, anchor.role);
        if (latest > 0 && (!existing || latest >= existing.setAt)) {
          deps.rankAnchors.set({
            account,
            role: anchor.role,
            tier: anchor.tier,
            division: anchor.division,
            progressPct: anchor.progressPct,
            setAt: Math.min(latest, importedAt),
          });
          anchorSet = true;
        }
      }
      return { imported, skipped, invalid, accountsAdded, anchorSet };
    },
    deleteFileImports: () => {
      const removed = deps.history.removeImported('file');
      deps.notion.clearExports(removed.map((g) => g.matchId));
      return { deleted: removed.length };
    },
    fileImportedCount: () => deps.history.importedCount('file'),
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
    getSessionSettings: () => deps.getConfig().sessionSettings,
    setSessionSettings: (input) => {
      const config = deps.getConfig();
      config.sessionSettings = normalizeSessionSettings(input);
      deps.persistSessionSettings(config.sessionSettings);
      return config.sessionSettings;
    },
    getStaleness: () => deps.getConfig().staleness,
    setStaleness: (input) => {
      const config = deps.getConfig();
      config.staleness = normalizeStaleness(input);
      deps.persistStaleness(config.staleness);
      return config.staleness;
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
    setDevKey: (key) => deps.setDevKey(key),
    getAppInfo: () => deps.appInfo(),
    // Scheme-guarded before it ever reaches the shell: a disallowed URL is a no-op.
    openExternal: async (url) => { await openIfAllowed(url, deps.openExternal); },
    getDataLocation: () => deps.dataLocation.get(),
    chooseDataFolder: () => deps.dataLocation.choose(),
    setDataFolder: (input) => deps.dataLocation.set(input),
    chooseFirstRunDataFolder: () => deps.dataLocation.chooseFirstRun(),
    clearReview: (matchId) => {
      deps.history.clearReview(matchId);
    },
    pendingMatches: () => {
      const accounts = deps.getConfig().accounts;
      return deps.history.allPending().map((rec) => toPendingMatch(rec, accounts));
    },
    resolvePendingMatch: (matchId, result) => {
      deps.resolvePending(matchId, result);
    },
    dismissPendingMatch: (matchId) => {
      deps.dismissPending(matchId);
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

/**
 * Summarize a held raw {@link MatchRecord} into the lean {@link PendingMatch} the
 * Review screen renders — resolving map/role/account with the SAME resolvers the
 * live capture path ({@link matchToGame}) uses, so a resolved result looks
 * identical to an auto-tracked one. Never produces a GameRecord: a pending match
 * stays out of history/analytics until the user sets its result.
 */
function toPendingMatch(rec: MatchRecord, accounts: Record<string, string>): PendingMatch {
  return {
    matchId: rec.matchId,
    map: resolveMapId(rec.mapName) ?? 'Unknown',
    heroes: rec.heroes,
    role: resolveRole(rec.queueType, rec.heroRole) ?? 'openQ',
    account: resolveAccount(rec.battleTag, accounts) ?? rec.battleTag ?? 'Unknown',
    timestamp: rec.endedAt ?? 0,
    rosterCount: rec.roster?.length ?? 0,
    // A held match can still carry a GEP-reported outcome (it was held for an
    // unknown game_type, not necessarily a missing result) — surface it so
    // Review can hint it and make confirming it one click.
    ...(resolveResult(rec.outcome) ? { reportedResult: resolveResult(rec.outcome) } : {}),
  };
}

/**
 * Per-account, per-role most-played hero names, over the FULL unfiltered
 * history (a durable "what do I usually play" signal, not scoped to whatever
 * the global dashboard filter currently shows) — the Log Match hero-picker
 * shortlist's source. Only accounts/roles with at least one game get an entry.
 */
function mostPlayedHeroesByAccount(deps: DataProviderDeps): Record<string, Partial<Record<Role, string[]>>> {
  const games = deps.history.all();
  const roles: Role[] = ['tank', 'damage', 'support', 'openQ'];
  const out: Record<string, Partial<Record<Role, string[]>>> = {};
  for (const account of new Set(games.map((g) => g.account))) {
    const perRole: Partial<Record<Role, string[]>> = {};
    for (const role of roles) {
      const names = rankHeroesByPlays(games, account, role);
      if (names.length) perRole[role] = names;
    }
    if (Object.keys(perRole).length) out[account] = perRole;
  }
  return out;
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
    };
  });
}

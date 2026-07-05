import type { DataProvider } from './dashboard';
import type { HistoryStore } from '../store/history';
import type { ManualStore } from '../store/manualLog';
import type { NotionRuntime } from './notionRuntime';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import { normalizeBreakReminder, type BreakReminderSettings } from '../core/breakReminder';
import { effectiveDemo } from '../core/demoPreference';
import { LOG_LEVELS, type LogLevel } from '../core/logging';
import { currentRank, type RankAnchorMap } from '../core/rank';
import { sourceOf } from '../core/source';
import type { RankAnchorStore } from '../store/rankAnchors';
import type {
  AccountSummary, AppInfo, AppUiSettings, GepStatusPayload, MatchEditInput, RankSummary,
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
  history: Pick<HistoryStore, 'count' | 'all' | 'setReview' | 'setReviews' | 'clearReview' | 'editManual' | 'addMany'>;
  /** Authored-target (◎ manual) persistence. */
  manual: Pick<ManualStore, 'targets' | 'addTarget' | 'updateTarget' | 'setActive' | 'setArchived' | 'removeTarget'>;
  /** Per-(account, role) rank anchors for the calculated-rank engine. */
  rankAnchors: Pick<RankAnchorStore, 'all' | 'get' | 'map' | 'set'>;
  /** The Notion edge: export/import, status, token lifecycle, and the database picker. */
  notion: Pick<
    NotionRuntime,
    'export' | 'import' | 'status' | 'setToken' | 'clearToken' | 'listDatabases' | 'listPages' | 'selectDatabase' | 'createDatabase'
  >;
  /** Live app config — re-read on every use (accounts, breakReminder), never cached. */
  getConfig(): AppConfig;
  /** Persist the full accounts map (battleTag → label) into the user's local config. */
  persistAccounts(accounts: Record<string, string>): void;
  /** Persist new break-reminder settings into the user's local config file. */
  persistBreakReminder(s: BreakReminderSettings): void;
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
}

/** Assemble the dashboard's DataProvider over the injected deps. */
export function createDataProvider(deps: DataProviderDeps): DataProvider {
  const demoPref = () => deps.getConfig().ui.demoPreference;
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
        timestamp: Date.now(),
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
      // The manual layer applies to any match.
      if (input.mental !== undefined) patch.mental = input.mental;
      if (input.srDelta !== undefined) patch.srDelta = input.srDelta;
      if (input.grades !== undefined) {
        patch.review = { at: Date.now(), grades: input.grades, flags: input.mental ?? game.mental ?? {} };
      }
      deps.history.editManual(input.matchId, patch);
    },
    listAccounts: () => accountList(deps.getConfig().accounts),
    saveAccount: (input) => {
      const accounts = { ...deps.getConfig().accounts };
      if (input.previousBattleTag && input.previousBattleTag !== input.battleTag) {
        delete accounts[input.previousBattleTag];
      }
      accounts[input.battleTag] = input.label || input.battleTag;
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
      const { imported, skipped } = deps.history.addMany(res.games);
      return { imported, skipped, failed: res.failed };
    },
    getBreakReminder: () => deps.getConfig().breakReminder,
    setBreakReminder: (input) => {
      const config = deps.getConfig();
      config.breakReminder = normalizeBreakReminder(input);
      deps.persistBreakReminder(config.breakReminder);
      return config.breakReminder;
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
    clearReview: (matchId) => {
      deps.history.clearReview(matchId);
    },
  };
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

import type { DataProvider } from './dashboard';
import type { HistoryStore } from '../store/history';
import type { ManualStore } from '../store/manualLog';
import type { NotionRuntime } from './notionRuntime';
import type { AppConfig } from './config';
import { normalizeBreakReminder, type BreakReminderSettings } from '../core/breakReminder';
import type { GameRecord } from '../core/analytics';

/**
 * Builds the {@link DataProvider} the dashboard consumes: every renderer-facing
 * read/write, mapped onto injected stores and edges. No Electron imports (deps
 * are type-only slices) — the composition root in ./index supplies the real
 * services.
 */

/** Backing services for the dashboard's DataProvider, as narrow structural slices so tests can inject plain objects. */
export interface DataProviderDeps {
  /** Durable game history: dataset reads plus review writes. */
  history: Pick<HistoryStore, 'count' | 'all' | 'setReview' | 'setReviews'>;
  /** Authored-target (◎ manual) persistence. */
  manual: Pick<ManualStore, 'targets' | 'addTarget' | 'updateTarget' | 'setActive' | 'setArchived' | 'removeTarget'>;
  /** The Notion edge: export, status, token lifecycle, and the database picker. */
  notion: Pick<
    NotionRuntime,
    'export' | 'status' | 'setToken' | 'clearToken' | 'listDatabases' | 'listPages' | 'selectDatabase' | 'createDatabase'
  >;
  /** Live app config — re-read on every use (accounts, breakReminder), never cached. */
  getConfig(): AppConfig;
  /** Persist new break-reminder settings into the user's local config file. */
  persistBreakReminder(s: BreakReminderSettings): void;
  /** Match-pipeline entry for manually logged games (same dedupe + reminder path as live ones). */
  recordGame(g: GameRecord): boolean;
  /** Surface a user-facing notification (the tray balloon in production). */
  notify(title: string, body: string): void;
  /** Demo dataset shown until the first real game is tracked. */
  sampleGames(): GameRecord[];
}

/** Assemble the dashboard's DataProvider over the injected deps. */
export function createDataProvider(deps: DataProviderDeps): DataProvider {
  return {
    games: () => (deps.history.count() ? deps.history.all() : deps.sampleGames()),
    isSample: () => deps.history.count() === 0,
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
      deps.recordGame({
        matchId,
        timestamp: Date.now(),
        account: Object.values(deps.getConfig().accounts)[0] ?? 'You',
        role: input.role,
        map: input.map,
        result: input.result,
        gameType: input.gameType,
        heroes: input.hero ? [input.hero] : [],
        mental: input.mental,
      });
      deps.notify('Match logged', `${input.result} · ${input.map}`);
      return { matchId };
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
  };
}

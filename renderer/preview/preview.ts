/**
 * Browser preview harness. Stands in for the Electron preload bridge by mocking
 * `window.owstats` with the pure core running against the sample season, so the
 * full UI can be viewed and iterated in a plain browser — no Overwolf runtime.
 *
 * Manual writes (logMatch / saveTarget / saveReview / target lifecycle) are
 * persisted to localStorage so they survive a reload here, mirroring how the
 * real app persists them to disk.
 */
import type {
  AppUiSettings, AuthoredTargetInput, BreakReminderSettings, DashboardFilters, GepHealthState,
  GepStatusPayload, LogEntry, LogLevel, ManualMatchInput, NotionDatabaseSummary,
  NotionPageSummary, NotionStatus, OwStatsApi, RendererErrorInput, ReviewInput, SyncProgress,
  TargetEditInput,
} from '../../src/shared/contract';
import type { GameRecord, MatchReview } from '../../src/core/analytics';
import type { AuthoredTarget } from '../../src/core/targets';
import { effectiveDemo, type DemoPreference } from '../../src/core/demoPreference';
import { generateSampleGames } from '../../src/core/sampleData';
import { computeDashboard, applyFilters } from '../../src/core/dashboardData';
import { heroDetail } from '../../src/core/analytics';
import { matchDetail } from '../../src/core/matchDetail';
import { DEFAULT_BREAK_REMINDER, normalizeBreakReminder } from '../../src/core/breakReminder';
import { App } from '../src/app/shell';
import { must } from '../src/dom';

const LOGGED_KEY = 'vantagePreviewLogged';
const TARGETS_KEY = 'vantagePreviewTargets';
const REVIEWS_KEY = 'vantagePreviewReviews';
const BREAK_REMINDER_KEY = 'vantagePreviewBreakReminder';
const NOTION_DB_KEY = 'vantagePreviewNotionDatabaseId';
const NOTION_TOKEN_KEY = 'vantagePreviewNotionTokenSet';
const APP_SETTINGS_KEY = 'vantagePreviewAppSettings';

const load = <T>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const loadMap = <T>(key: string): Record<string, T> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const save = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

const season = generateSampleGames(220, 42);
const logged: GameRecord[] = load<GameRecord>(LOGGED_KEY);
// Older preview targets predate the active flag — backfill like ManualStore does.
const targets: AuthoredTarget[] = load<AuthoredTarget>(TARGETS_KEY)
  .map((t) => ({ ...t, isActive: t.isActive ?? true }));
const previewReviews: Record<string, MatchReview> = loadMap<MatchReview>(REVIEWS_KEY);
const savedBreakReminder = loadMap<unknown>(BREAK_REMINDER_KEY) as Partial<BreakReminderSettings>;
let breakReminder: BreakReminderSettings = Object.keys(savedBreakReminder).length
  ? normalizeBreakReminder(savedBreakReminder)
  : { ...DEFAULT_BREAK_REMINDER };

// Saved reviews are overlaid onto the dataset so the pure core exercises the
// full pipeline (inbox, mental merge, target scoring) exactly as in the app.
// Mirrors src/main/dataProvider.ts's games(): real (logged) games win; the demo
// season shows only while opted in with no real games — so ?demo=off/unset
// previews the honest empty states end-to-end.
const dataset = (): GameRecord[] =>
  (logged.length ? logged : appSettings.demoPreference === 'on' ? season : []).map((g) =>
    previewReviews[g.matchId] ? { ...g, review: previewReviews[g.matchId] } : g,
  );

const findTarget = (id: string): AuthoredTarget | undefined => targets.find((t) => t.id === id);

// Canned Notion picker data — the preview has no real Notion runtime, but the
// database-picker card still needs something to list and select against.
const CANNED_DATABASES: NotionDatabaseSummary[] = [
  { id: 'db-gametracker', title: 'Gametracker', url: 'https://notion.so/db-gametracker' },
  { id: 'db-old-season', title: 'Gametracker (Season 1 — archived)', url: 'https://notion.so/db-old-season' },
];
const CANNED_PAGES: NotionPageSummary[] = [
  { id: 'page-overwatch', title: 'Overwatch', url: 'https://notion.so/page-overwatch' },
  { id: 'page-gaming', title: 'Gaming', url: 'https://notion.so/page-gaming' },
];
let selectedNotionDatabaseId: string | undefined = localStorage.getItem(NOTION_DB_KEY) ?? undefined;
let notionTokenSet = localStorage.getItem(NOTION_TOKEN_KEY) === '1';
let appSettings: AppUiSettings = {
  closeToTray: true,
  runAtLogin: false,
  demoPreference: 'on',
  ...(loadMap<unknown>(APP_SETTINGS_KEY) as Partial<AppUiSettings>),
};
// ?demo=on|off|unset overrides the persisted choice — lets design QA preview the
// first-run prompt (unset) and the honest empty states (off) without Electron.
const demoParam = new URLSearchParams(location.search).get('demo');
if (demoParam === 'on' || demoParam === 'off' || demoParam === 'unset') {
  appSettings.demoPreference = demoParam as DemoPreference;
}
const previewDemo = () => ({
  active: effectiveDemo(appSettings.demoPreference, logged.length),
  preference: appSettings.demoPreference,
  hasRealHistory: logged.length > 0,
});

// Fake log feed: a canned backlog plus a slow trickle of new entries, so the
// Logs screen's tail/filter/pause behaviors are all exercisable in a browser.
let previewLogLevel: LogLevel = 'info';
const logListeners = new Set<(e: LogEntry) => void>();
const previewLog: LogEntry[] = [
  { ts: Date.now() - 90_000, level: 'info', scope: 'main', message: 'Vantage started', fields: { version: 'preview', sensor: 'gep' } },
  { ts: Date.now() - 80_000, level: 'info', scope: 'gep', message: 'game detected', fields: { game: 10844 } },
  { ts: Date.now() - 75_000, level: 'debug', scope: 'gep', message: 'info update kill_feed' },
  { ts: Date.now() - 60_000, level: 'warn', scope: 'notion', message: 'shape validation skipped — no database selected' },
  { ts: Date.now() - 30_000, level: 'error', scope: 'renderer', message: 'example forwarded error', fields: { source: 'preview' } },
];
let previewLogTick = 0;
setInterval(() => {
  const e: LogEntry = {
    ts: Date.now(),
    level: previewLogLevel === 'debug' && previewLogTick % 2 === 0 ? 'debug' : 'info',
    scope: previewLogTick % 3 === 0 ? 'pipeline' : 'gep',
    message: `preview heartbeat #${++previewLogTick}`,
  };
  previewLog.push(e);
  for (const cb of logListeners) cb(e);
}, 4000);

// Simulated connection status: pick a state with ?gep=live|stale|connected|
// no-game, or ?gep=cycle to rotate through all four (default: connected).
const gepListeners = new Set<(s: GepStatusPayload) => void>();
const GEP_STATES: GepHealthState[] = ['no-game', 'connected', 'live', 'stale'];
const gepParam = new URLSearchParams(location.search).get('gep') ?? 'connected';
let gepState: GepHealthState = (GEP_STATES as string[]).includes(gepParam)
  ? (gepParam as GepHealthState)
  : 'connected';
const gepPayload = (): GepStatusPayload => ({
  state: gepState,
  sensor: 'gep',
  attachedAt: gepState === 'no-game' ? null : Date.now() - 300_000,
  lastEventAt: gepState === 'no-game' ? null : Date.now() - (gepState === 'stale' ? 90_000 : 4_000),
  eventsThisSession: gepState === 'no-game' ? 0 : 128,
  matchInProgress: gepState === 'live' || gepState === 'stale',
});
if (gepParam === 'cycle') {
  let i = 1;
  setInterval(() => {
    gepState = GEP_STATES[i++ % GEP_STATES.length];
    for (const cb of gepListeners) cb(gepPayload());
  }, 5000);
}

const syncListeners = new Set<(p: SyncProgress) => void>();

function notionStatusFor(databaseId: string | undefined): NotionStatus {
  const db = CANNED_DATABASES.find((d) => d.id === databaseId);
  return {
    tokenSet: notionTokenSet,
    databaseConfigured: Boolean(db),
    connected: notionTokenSet && Boolean(db),
    gametrackerUrl: db?.url,
    trackedGames: dataset().length,
    databaseSource: db ? 'selected' : 'none',
    databaseId: db?.id,
    databaseTitle: db?.title,
    shapeValid: db ? true : undefined,
    shapeIssues: undefined,
    lastSyncedAt: db ? Date.now() - 3_600_000 : undefined,
  };
}

const mock: OwStatsApi = {
  getDashboard: async (f: DashboardFilters) => computeDashboard(dataset(), f, previewDemo(), { targets, breakReminder }),
  heroDetail: async (hero: string, f: DashboardFilters) => heroDetail(applyFilters(dataset(), f), hero),
  matchDetail: async (matchId: string, f: DashboardFilters) => {
    const games = dataset();
    return matchDetail(games, matchId, applyFilters(games, f));
  },
  exportNotion: async () => {
    if (!selectedNotionDatabaseId) return { ok: 0, failed: 0, unavailable: true };
    // Simulate per-game progress so the sync card's live counter is testable.
    const total = Math.min(dataset().length, 40);
    for (let done = 1; done <= total; done += 8) {
      for (const cb of syncListeners) cb({ done: Math.min(done, total), total });
      await new Promise((r) => setTimeout(r, 60));
    }
    return { ok: dataset().length, failed: 0, skipped: 0 };
  },
  // The preview has no Notion runtime; token state is tracked locally, and the
  // database picker operates against a small canned list (see CANNED_DATABASES).
  notionStatus: async () => notionStatusFor(selectedNotionDatabaseId),
  setNotionToken: async () => {
    // A token alone doesn't select a database — the picker card is what shows next.
    notionTokenSet = true;
    localStorage.setItem(NOTION_TOKEN_KEY, '1');
    return notionStatusFor(selectedNotionDatabaseId);
  },
  clearNotionToken: async () => {
    notionTokenSet = false;
    selectedNotionDatabaseId = undefined;
    localStorage.removeItem(NOTION_TOKEN_KEY);
    localStorage.removeItem(NOTION_DB_KEY);
    return notionStatusFor(undefined);
  },
  listNotionDatabases: async () => ({ databases: CANNED_DATABASES }),
  listNotionPages: async () => ({ pages: CANNED_PAGES }),
  selectNotionDatabase: async (databaseId: string) => {
    selectedNotionDatabaseId = databaseId;
    localStorage.setItem(NOTION_DB_KEY, databaseId);
    return notionStatusFor(databaseId);
  },
  createNotionDatabase: async (_parentPageId: string) => {
    // Simulate the ~15s auto-create latency the real IPC call incurs.
    await new Promise((resolve) => setTimeout(resolve, 400));
    selectedNotionDatabaseId = 'db-gametracker';
    localStorage.setItem(NOTION_DB_KEY, selectedNotionDatabaseId);
    return notionStatusFor(selectedNotionDatabaseId);
  },
  logMatch: async (input: ManualMatchInput) => {
    const matchId = `manual-${Date.now()}`;
    logged.push({
      matchId,
      timestamp: Date.now(),
      account: 'You',
      role: input.role,
      map: input.map,
      result: input.result,
      gameType: input.gameType,
      heroes: input.hero ? [input.hero] : [],
      mental: input.mental,
    });
    save(LOGGED_KEY, logged);
    return { matchId };
  },
  saveTarget: async (input: AuthoredTargetInput) => {
    targets.push({ id: `t-${Date.now()}`, createdAt: Date.now(), isActive: true, scope: 'season', ...input });
    save(TARGETS_KEY, targets);
  },
  saveReview: async (input: ReviewInput) => {
    previewReviews[input.matchId] = { at: Date.now(), grades: input.grades, flags: input.flags };
    save(REVIEWS_KEY, previewReviews);
  },
  importReviews: async (inputs: ReviewInput[]) => {
    const known = new Set(dataset().map((g) => g.matchId));
    let imported = 0;
    let skipped = 0;
    for (const i of inputs) {
      if (!known.has(i.matchId) || previewReviews[i.matchId]) {
        skipped++;
        continue;
      }
      previewReviews[i.matchId] = { at: Date.now(), grades: i.grades, flags: i.flags };
      imported++;
    }
    if (imported) save(REVIEWS_KEY, previewReviews);
    return { imported, skipped };
  },
  updateTarget: async (input: TargetEditInput) => {
    const t = findTarget(input.id);
    if (!t) return;
    t.name = input.name;
    t.mode = input.mode;
    t.rule = input.rule;
    save(TARGETS_KEY, targets);
  },
  setTargetActive: async (id: string, active: boolean) => {
    const t = findTarget(id);
    if (!t) return;
    t.isActive = active;
    save(TARGETS_KEY, targets);
  },
  setTargetArchived: async (id: string, archived: boolean) => {
    const t = findTarget(id);
    if (!t) return;
    if (archived) t.archivedAt = Date.now();
    else delete t.archivedAt;
    save(TARGETS_KEY, targets);
  },
  deleteTarget: async (id: string) => {
    const idx = targets.findIndex((t) => t.id === id);
    if (idx < 0) return;
    targets.splice(idx, 1);
    save(TARGETS_KEY, targets);
  },
  getBreakReminder: async () => breakReminder,
  setBreakReminder: async (input: BreakReminderSettings) => {
    breakReminder = normalizeBreakReminder(input);
    save(BREAK_REMINDER_KEY, breakReminder);
    return breakReminder;
  },
  getLogEntries: async () => [...previewLog],
  getLogLevel: async () => previewLogLevel,
  setLogLevel: async (level: LogLevel) => {
    previewLogLevel = level;
    return previewLogLevel;
  },
  logRendererError: async (input: RendererErrorInput) => {
    const e: LogEntry = {
      ts: Date.now(), level: 'error', scope: 'renderer', message: input.message,
      fields: { ...(input.source ? { source: input.source } : {}) },
    };
    previewLog.push(e);
    for (const cb of logListeners) cb(e);
  },
  onLogEntry: (cb: (e: LogEntry) => void) => {
    logListeners.add(cb);
    return () => logListeners.delete(cb);
  },
  getGepStatus: async () => gepPayload(),
  onGepStatus: (cb: (s: GepStatusPayload) => void) => {
    gepListeners.add(cb);
    return () => gepListeners.delete(cb);
  },
  onSyncProgress: (cb: (p: SyncProgress) => void) => {
    syncListeners.add(cb);
    return () => syncListeners.delete(cb);
  },
  getAppSettings: async () => appSettings,
  setAppSettings: async (patch: Partial<AppUiSettings>) => {
    appSettings = { ...appSettings, ...patch };
    save(APP_SETTINGS_KEY, appSettings);
    return appSettings;
  },
  getAppInfo: async () => ({ version: 'preview', supportEmail: 'timo.seikel@gmail.com' }),
  clearReview: async (matchId: string) => {
    delete previewReviews[matchId];
    save(REVIEWS_KEY, previewReviews);
  },
  window: {
    minimize: () => console.info('[preview] minimize'),
    toggleMaximize: () => console.info('[preview] toggle-maximize'),
    close: () => console.info('[preview] close'),
  },
};

window.owstats = mock;
new App(must('#app'));

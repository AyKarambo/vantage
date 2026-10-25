/**
 * Browser preview harness. Stands in for the Electron preload bridge by running
 * the app's own Electron-free data layer — the DataProvider, the dashboard
 * handler table and the match pipeline — over in-browser stores: the sample
 * season, plus history and the JSON side-stores kept in localStorage. Every
 * read and write therefore goes through exactly the code the app runs; only
 * what has no browser equivalent is simulated here (the Notion workspace,
 * GEP / dev-mode status, the log feed, the data folder, file dialogs and the
 * live match).
 *
 * Query switches: ?demo=on|off|unset, ?gep=connected|live|stale|no-game|cycle|
 * down|degraded|staged|outdated, ?devmode=off|pending|ok|failed|cycle,
 * ?firstRunData=1, ?players=N. Drive a match from the console with `previewLive`.
 */
import type {
  AppUiSettings, DataLocationResult, DevModeAuthStatusPayload, GameLoggedPayload, GepHealthState, GepStatusPayload,
  LiveMatchPayload, LogEntry, LogLevel, NotionDatabaseSummary, NotionPageSummary, NotionStatus, OwStatsApi,
  PendingChangedPayload, PlayerList, SyncProgress,
} from '../../src/shared/contract';
import type { MatchRecord, Role } from '../../src/core/model';
import type { DemoPreference } from '../../src/core/demoPreference';
import type { FetchedCatalog } from '../../src/core/masterData';
import type { AppConfig } from '../../src/main/config';
import { DEFAULT_BREAK_REMINDER } from '../../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../../src/core/staleness';
import { DEFAULT_READINESS } from '../../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../../src/core/sessionSettings';
import { DEFAULT_COACHING, normalizeCoachingSettings } from '../../src/core/coachingSettings';
import { DEFAULT_GRADING_SETTINGS } from '../../src/core/gradingSettings';
import { generateSampleGames } from '../../src/core/sampleData';
import { buildImportEnvelope } from '../../src/core/importEnvelope';
import { isCompetitive } from '../../src/core/matchFilter';
import { clampZoom } from '../../src/core/zoom';
import { roleOfHero } from '../../src/core/heroes';
import { orderScoreboard } from '../../src/core/matchDetail';
import { createDataProvider, type DataProviderDeps } from '../../src/main/dataProvider';
import { dashboardHandlers, type DashboardInvokers } from '../../src/main/dashboard/handlers';
import { createMatchPipeline } from '../../src/main/matchPipeline';
import { MemoryHistoryStore } from '../../src/store/memoryHistory';
import { ManualStore } from '../../src/store/manualLog';
import { RankAnchorStore } from '../../src/store/rankAnchors';
import { PlacementStore } from '../../src/store/placements';
import { CheckInStore } from '../../src/store/checkIns';
import { FriendStore } from '../../src/store/friends';
import { MasterDataStore } from '../../src/store/masterData';
import { App } from '../src/app/shell';
import { must } from '../src/dom';
import { localDocs } from './localDocs';

const params = new URLSearchParams(location.search);
const docs = localDocs('vantagePreview');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A push channel: what an `onX` subscription of the bridge listens to. */
function channel<T>(): { emit(payload: T): void; on(cb: (payload: T) => void): () => void } {
  const listeners = new Set<(payload: T) => void>();
  return {
    emit: (payload) => { for (const cb of listeners) cb(payload); },
    on: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

const logEntries = channel<LogEntry>();
const gepStatus = channel<GepStatusPayload>();
const devModeAuth = channel<DevModeAuthStatusPayload>();
const syncProgress = channel<SyncProgress>();
const gameLogged = channel<GameLoggedPayload>();
const pendingChanged = channel<PendingChangedPayload>();
const liveMatch = channel<LiveMatchPayload>();
const dataChanged = channel<void>();

// --- config ------------------------------------------------------------------

const sampleSeason = generateSampleGames(220, 42);
const configDoc = docs('config.json');
const storedConfig = (configDoc.read() ?? {}) as Partial<AppConfig>;
const config: AppConfig = {
  overwatchGameId: 10844,
  runAtLogin: false,
  sensor: 'gep',
  notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' },
  // Seeded from the sample season so its accounts read as configured ones.
  accounts: Object.fromEntries([...new Set(sampleSeason.map((g) => g.account))].map((n) => [`${n}#0000`, n])),
  mapAliases: {},
  breakReminder: { ...DEFAULT_BREAK_REMINDER },
  staleness: { ...DEFAULT_STALENESS },
  readiness: { ...DEFAULT_READINESS },
  sessionSettings: { ...DEFAULT_SESSION_SETTINGS },
  grading: { ...DEFAULT_GRADING_SETTINGS },
  coaching: normalizeCoachingSettings(DEFAULT_COACHING),
  masterData: { overfastBaseUrl: 'https://overfast-api.tekrop.fr' },
  ...storedConfig,
  ui: {
    closeToTray: true, demoPreference: 'on', devMode: true, gepNotifications: true, liveKillFeed: true,
    autoSwitchToLive: false, autoSwitchToReview: false,
    // Off, like the real default: there is no main process to host the pipe.
    mcpEnabled: false,
    // Matches the mocked AppInfo.version so "What's new" reads as already seen.
    lastSeenVersion: 'preview',
    ...storedConfig.ui,
  },
};
const saveConfig = (): void => configDoc.write(config);
// ?demo=on|off|unset overrides the persisted choice — previews the first-run
// prompt (unset) and the honest empty states (off) without Electron.
const demoParam = params.get('demo');
if (demoParam === 'on' || demoParam === 'off' || demoParam === 'unset') config.ui.demoPreference = demoParam as DemoPreference;

const appUiSettings = (): AppUiSettings => ({ ...config.ui, runAtLogin: config.runAtLogin });

// --- simulated edges ---------------------------------------------------------

// Fake log feed: a canned backlog plus a slow trickle, so the Logs screen's
// tail/filter/pause behaviors are exercisable in a browser.
let logLevel: LogLevel = 'info';
const logBacklog: LogEntry[] = [
  { ts: Date.now() - 90_000, level: 'info', scope: 'main', message: 'Vantage started', fields: { version: 'preview', sensor: 'gep' } },
  { ts: Date.now() - 80_000, level: 'info', scope: 'gep', message: 'game detected', fields: { game: 10844 } },
  { ts: Date.now() - 75_000, level: 'debug', scope: 'gep', message: 'info update kill_feed' },
  { ts: Date.now() - 60_000, level: 'warn', scope: 'notion', message: 'shape validation skipped — no database selected' },
  { ts: Date.now() - 30_000, level: 'error', scope: 'renderer', message: 'example forwarded error', fields: { source: 'preview' } },
];
const appendLog = (e: LogEntry): void => {
  logBacklog.push(e);
  logEntries.emit(e);
};
let logTick = 0;
setInterval(() => {
  appendLog({
    ts: Date.now(),
    level: logLevel === 'debug' && logTick % 2 === 0 ? 'debug' : 'info',
    scope: logTick % 3 === 0 ? 'pipeline' : 'gep',
    message: `preview heartbeat #${++logTick}`,
  });
}, 4000);

// Simulated connection status (?gep=…, default connected; `cycle` rotates).
const GEP_STATES: GepHealthState[] = ['no-game', 'connected', 'live', 'stale'];
const gepParam = params.get('gep') ?? 'connected';
let gepState: GepHealthState = (GEP_STATES as string[]).includes(gepParam) ? (gepParam as GepHealthState) : 'connected';
const gepPayload = (): GepStatusPayload => ({
  state: gepState,
  sensor: 'gep',
  attachedAt: gepState === 'no-game' ? null : Date.now() - 300_000,
  lastEventAt: gepState === 'no-game' ? null : Date.now() - (gepState === 'stale' ? 90_000 : 4_000),
  eventsThisSession: gepState === 'no-game' ? 0 : 128,
  matchInProgress: gepState === 'live' || gepState === 'stale',
  gepPackageVersion: '309.0.0',
  ...(gepParam === 'down' ? { serviceStatus: 'down', serviceMessage: 'Events are disabled' } : {}),
  ...(gepParam === 'degraded' ? { serviceStatus: 'degraded' } : {}),
  ...(gepParam === 'staged' ? { updateStaged: true } : {}),
  ...(gepParam === 'outdated' ? { gepMinVersion: '315.0.2', gepOutdated: true, gepPackageVersion: '315.0.1' } : {}),
});
if (gepParam === 'cycle') {
  let i = 1;
  setInterval(() => {
    gepState = GEP_STATES[i++ % GEP_STATES.length];
    gepStatus.emit(gepPayload());
  }, 5000);
}

// Simulated dev-mode auth status (?devmode=…, default off — the hidden badge).
type DevModeAuthPreviewState = 'off' | 'pending' | 'ok' | 'failed';
const DEV_MODE_AUTH_STATES: DevModeAuthPreviewState[] = ['off', 'pending', 'ok', 'failed'];
const devModeParam = params.get('devmode') ?? 'off';
let devModeState: DevModeAuthPreviewState = (DEV_MODE_AUTH_STATES as string[]).includes(devModeParam)
  ? (devModeParam as DevModeAuthPreviewState)
  : 'off';
const devModeAuthPayload = (): DevModeAuthStatusPayload => {
  switch (devModeState) {
    case 'off': return { attempted: false, outcome: 'pending' };
    case 'pending': return { attempted: true, outcome: 'pending' };
    case 'ok': return { attempted: true, outcome: 'confirmed' };
    case 'failed':
      return { attempted: true, outcome: 'failed', detail: 'ow-electron reported failed-to-initialize for the gep package' };
  }
};
if (devModeParam === 'cycle') {
  let j = 1;
  setInterval(() => {
    devModeState = DEV_MODE_AUTH_STATES[j++ % DEV_MODE_AUTH_STATES.length];
    devModeAuth.emit(devModeAuthPayload());
  }, 5000);
}

// A canned Notion workspace: token state and the picked database persist, the
// database/page pickers list fixed entries, and sync/import run against it.
const CANNED_DATABASES: NotionDatabaseSummary[] = [
  { id: 'db-gametracker', title: 'Gametracker', url: 'https://notion.so/db-gametracker' },
  { id: 'db-old-season', title: 'Gametracker (Season 1 — archived)', url: 'https://notion.so/db-old-season' },
];
const CANNED_PAGES: NotionPageSummary[] = [
  { id: 'page-overwatch', title: 'Overwatch', url: 'https://notion.so/page-overwatch' },
  { id: 'page-gaming', title: 'Gaming', url: 'https://notion.so/page-gaming' },
];
const notionDoc = docs('notion.json');
const notionState: { tokenSet: boolean; databaseId?: string } = {
  tokenSet: false,
  ...(notionDoc.read() as { tokenSet?: boolean; databaseId?: string } | undefined),
};
const saveNotion = (): void => notionDoc.write(notionState);
const selectedDatabase = (): NotionDatabaseSummary | undefined => CANNED_DATABASES.find((d) => d.id === notionState.databaseId);
function notionStatus(): NotionStatus {
  const db = selectedDatabase();
  // No export ledger here, so every competitive game reads as still unsynced.
  const competitiveGames = provider.games().filter((g) => isCompetitive(g.gameType)).length;
  return {
    tokenSet: notionState.tokenSet,
    databaseConfigured: Boolean(db),
    connected: notionState.tokenSet && Boolean(db),
    gametrackerUrl: db?.url,
    unsyncedGames: competitiveGames,
    competitiveGames,
    databaseSource: db ? 'selected' : 'none',
    databaseId: db?.id,
    databaseTitle: db?.title,
    shapeValid: db ? true : undefined,
    lastSyncedAt: db ? Date.now() - 3_600_000 : undefined,
    lastSyncResult: db ? { at: Date.now() - 3_600_000, ok: 12, updated: 2, failed: 1, firstError: 'Notion rate limit — try again shortly' } : undefined,
    importedMatches: history.importedCount('notion'),
    schemaProvision: db ? { created: ['SR Delta', 'Comms', 'Tilt'] } : undefined,
  };
}
const notion: DataProviderDeps['notion'] = {
  export: async (games) => {
    if (!selectedDatabase()) return { ok: 0, failed: 0, unavailable: true };
    // Per-game progress, so the sync card's live counter is exercisable.
    for (let done = 1; done <= games.length; done += 8) {
      syncProgress.emit({ done: Math.min(done, games.length), total: games.length });
      await sleep(60);
    }
    return { ok: games.length, failed: 0, skipped: 0 };
  },
  // Four "rows" from the workspace, through the provider's real import path.
  import: async () => {
    if (!selectedDatabase()) return { games: [], failed: 0, duplicates: 0, unavailable: true };
    const games = generateSampleGames(4, 7).map((g, i) => ({ ...g, matchId: `notion-${i}`, pageId: `page-${i}` }));
    return { games, failed: 0, duplicates: 0 };
  },
  status: () => notionStatus(),
  setToken: () => {
    notionState.tokenSet = true;
    saveNotion();
    return notionStatus();
  },
  clearToken: () => {
    notionState.tokenSet = false;
    delete notionState.databaseId;
    saveNotion();
    return notionStatus();
  },
  listDatabases: async () => ({ databases: CANNED_DATABASES }),
  listPages: async () => ({ pages: CANNED_PAGES }),
  selectDatabase: async (databaseId) => {
    notionState.databaseId = databaseId;
    saveNotion();
    return notionStatus();
  },
  createDatabase: async () => {
    await sleep(400);
    notionState.databaseId = 'db-gametracker';
    saveNotion();
    return notionStatus();
  },
  clearExports: () => {},
  cleanupDuplicates: async () =>
    selectedDatabase() ? { archived: 2, kept: 1, failed: 0 } : { archived: 0, kept: 0, failed: 0, unavailable: true },
};

// The data folder: nothing to move in a browser, so a "pick" relabels the
// location. Every third pick finds existing Vantage data (the adopt flow);
// ?firstRunData=1 shows the first-run folder prompt.
const DEFAULT_DATA_FOLDER = '(browser preview — in-memory)';
const dataFolder = {
  folder: DEFAULT_DATA_FOLDER,
  needsFirstRunChoice: params.get('firstRunData') === '1',
  picks: 0,
};
const moveTo = (folder: string): DataLocationResult => {
  dataFolder.folder = folder;
  dataFolder.needsFirstRunChoice = false;
  return { ok: true, location: { folder, isDefault: folder === DEFAULT_DATA_FOLDER }, changed: true };
};
const nextPickedFolder = (): string => `C:\\Users\\preview\\OneDrive\\Vantage-data-${++dataFolder.picks}`;

// --- the real data layer -----------------------------------------------------

const history = new MemoryHistoryStore(docs('history.json'));
const friends = new FriendStore(docs);
const pipeline = createMatchPipeline({
  history,
  aggregator: { handle: () => null },
  getConfig: () => config,
  notify: (title, body) => console.info('[preview] notify', title, body),
  log: (...args) => console.debug('[preview] pipeline', ...args),
  onGameLogged: (payload) => gameLogged.emit(payload),
  onPendingChanged: (payload) => pendingChanged.emit(payload ?? {}),
  friendKeys: () => friends.keys(),
});

const provider = createDataProvider({
  history,
  manual: new ManualStore(docs),
  rankAnchors: new RankAnchorStore(docs),
  placements: new PlacementStore(docs),
  checkIns: new CheckInStore(docs),
  friends,
  masterDataStore: new MasterDataStore(docs),
  // A synthetic catalog (one new hero, one new map) exercises the Update preview.
  fetchMasterDataUpdate: async (): Promise<FetchedCatalog> => {
    await sleep(300);
    const eff = provider.effectiveMasterData();
    return {
      heroes: [...eff.heroes, { name: 'Preview Hero', role: 'damage' }],
      maps: [
        ...eff.maps.map((m) => ({ name: m.name, mode: m.mode, isActive: true })),
        { name: 'Preview Arena', mode: 'Control', isActive: true },
      ],
    };
  },
  notion,
  getConfig: () => config,
  persistAccounts: (accounts) => {
    config.accounts = accounts;
    saveConfig();
  },
  // "Choosing a file" imports a small generated backup through the real path.
  importFile: {
    pick: async () => buildImportEnvelope({
      games: generateSampleGames(5, 99).map((g) => ({ ...g, matchId: `file-${g.matchId}` })),
      accounts: [],
      rankAnchors: {},
      targets: [],
    }),
  },
  persistConfig: (patch) => {
    Object.assign(config, patch);
    saveConfig();
  },
  recordGame: (game) => pipeline.recordGame(game),
  resolvePending: (matchId, result) => pipeline.resolvePending(matchId, result),
  dismissPending: (matchId) => pipeline.dismissPending(matchId),
  notify: (title, body) => console.info('[preview] notify', title, body),
  announceChange: () => dataChanged.emit(),
  sampleGames: () => sampleSeason,
  logger: {
    entries: () => [...logBacklog],
    getLevel: () => logLevel,
    setLevel: (level) => { logLevel = level; },
    error: (scope, message, fields) => appendLog({ ts: Date.now(), level: 'error', scope, message, ...(fields ? { fields } : {}) }),
  },
  getSecrets: () => [],
  gepStatus: gepPayload,
  devModeAuthStatus: devModeAuthPayload,
  appSettings: {
    get: appUiSettings,
    apply: (patch) => {
      const { runAtLogin, ...ui } = patch;
      if (runAtLogin !== undefined) config.runAtLogin = runAtLogin;
      config.ui = { ...config.ui, ...ui };
      if (patch.uiZoom !== undefined) {
        config.ui.uiZoom = clampZoom(patch.uiZoom);
        // No webContents.setZoomFactor in a browser — CSS zoom is the closest stand-in.
        document.documentElement.style.setProperty('zoom', String(config.ui.uiZoom));
      }
      saveConfig();
      return appUiSettings();
    },
  },
  setDevKey: (key) => ({ hasKey: key.trim().length > 0 }),
  appInfo: () => ({
    version: 'preview', supportEmail: 'timo.seikel@gmail.com',
    electron: 'preview', chromium: 'preview', node: 'preview', v8: 'preview',
    platform: 'browser', osRelease: 'preview', packaged: false, devMode: false,
    // Tied to ?devmode=… so the Settings "Dev Mode" section's reveal is previewable.
    devModeAttempted: devModeState !== 'off',
    gepPackageVersion: 'preview',
    mcpBridgePath: '/dev/dist/mcp/stdio.js',
  }),
  openExternal: async (url) => console.info('[preview] openExternal', url),
  // No save dialog in a browser: report where it "would" have been written.
  saveTextFile: async (defaultName, contents) => {
    console.info('[preview] saveTextFile', defaultName, `${contents.length} chars`);
    return `C:\\Users\\preview\\Documents\\${defaultName}`;
  },
  applyGepUpdate: () => {},
  dataLocation: {
    get: () => ({
      folder: dataFolder.folder,
      isDefault: dataFolder.folder === DEFAULT_DATA_FOLDER,
      ...(dataFolder.needsFirstRunChoice ? { needsFirstRunChoice: true } : {}),
    }),
    choose: async () => {
      const target = nextPickedFolder();
      if (dataFolder.picks % 3 === 0) {
        return { ok: true, location: { folder: target, isDefault: false }, changed: false, requiresAdopt: true };
      }
      return moveTo(target);
    },
    set: async (input) => moveTo(input.folder),
    chooseFirstRun: async () => moveTo(nextPickedFolder()),
    reveal: () => console.info('[preview] revealDataFolder', dataFolder.folder),
  },
});

// --- the bridge ----------------------------------------------------------------

/**
 * Every contract method through the provider's handler table — with the
 * structured clone IPC applies on both sides, so the renderer can never hold a
 * live reference into the stores.
 */
const handlers = dashboardHandlers(provider) as unknown as Record<string, (...args: unknown[]) => unknown>;
const invokers = Object.fromEntries(
  Object.entries(handlers).map(([method, handle]) => [
    method,
    async (...args: unknown[]) => structuredClone(await handle(...structuredClone(args))),
  ]),
) as unknown as DashboardInvokers;

/**
 * `?players=N` pads the Players list with synthetic rows: the sample roster
 * pool is ~20 names, too few to reach the row cap, its caption or the paging.
 */
function padPlayers(list: PlayerList): PlayerList {
  const pad = Number(params.get('players'));
  if (!Number.isFinite(pad) || pad <= list.totalInScope) return list;
  const rows = [...list.rows];
  for (let i = list.totalInScope; i < pad && rows.length < list.cap; i++) {
    rows.push({
      key: `synth${i}`, name: `Synthetic${i}#${1000 + i}`,
      games: (i % 17) + 1, lastSeen: Date.now() - i * 60_000,
      sameTeam: { wins: i % 5, losses: i % 3 }, enemyTeam: { wins: i % 4, losses: i % 6 },
      ambiguous: i % 23 === 0,
    });
  }
  return { ...list, rows, matched: pad, totalInScope: pad };
}

const bridge: OwStatsApi = {
  ...invokers,
  playerList: async (query) => padPlayers(await invokers.playerList(query)),
  onLogEntry: logEntries.on,
  onGepStatus: gepStatus.on,
  onDevModeAuthStatus: devModeAuth.on,
  onSyncProgress: syncProgress.on,
  onGameLogged: gameLogged.on,
  onPendingChanged: pendingChanged.on,
  onLiveMatch: liveMatch.on,
  onDataChanged: dataChanged.on,
  window: {
    minimize: () => console.info('[preview] minimize'),
    toggleMaximize: () => console.info('[preview] toggle-maximize'),
    close: () => console.info('[preview] close'),
  },
};

window.owstats = bridge;
new App(must('#app'));

// --- live-match simulation ----------------------------------------------------

/**
 * The live board is fed by GEP, which the harness has no access to — so this
 * synthesizes a plausible match from the sample history's own players, so the
 * scoreboard, the per-team totals and the with/vs records render against real
 * history. Drive it from the console:
 *   previewLive.start() / stop()     — a synthetic match that ticks
 *   previewLive.finish(role?)        — it ends with a result (recorded, source 'gep')
 *   previewLive.finishWithoutResult(role?) — it ends without one (held for Review)
 * Both finishes go through the real match pipeline.
 */
let liveTimer: ReturnType<typeof setInterval> | undefined;
let liveStartedAt = Date.now();

function buildLiveMatch(tick: number): LiveMatchPayload {
  const known = [...new Set(
    provider.games().flatMap((g) => (g.roster ?? []).filter((p) => !p.isLocal && p.battleTag).map((p) => p.battleTag!)),
  )].slice(0, 9);
  const heroes = ['Ana', 'Genji', 'Reinhardt', 'Lúcio', 'Tracer', 'Sigma', 'Kiriko', 'Sojourn', 'Orisa'];
  const roster = [
    {
      name: 'You#1234', isLocal: true, hero: 'Ana', role: 'support' as const, team: 0,
      eliminations: 3 + tick, deaths: 2, assists: 9 + tick, damage: 2100 + tick * 90,
      healing: 6400 + tick * 220, mitigation: 0,
    },
    ...known.map((name, i) => ({
      name, isLocal: false, hero: heroes[i % heroes.length],
      role: roleOfHero(heroes[i % heroes.length]), team: i < 4 ? 0 : 1,
      eliminations: (i * 2 + tick) % 14, deaths: (i + tick) % 9, assists: (i * 3) % 11,
      damage: 1500 + i * 400 + tick * 60, healing: i % 3 === 0 ? 3000 + tick * 100 : 0,
      mitigation: i % 4 === 0 ? 2000 + tick * 80 : 0,
    })),
  ];
  // Summed the way the real monitor sums the live roster.
  const side = (t: number): { damage: number; healing: number; deaths: number } => roster
    .filter((r) => r.team === t)
    .reduce((a, r) => ({
      damage: a.damage + (r.damage ?? 0),
      healing: a.healing + (r.healing ?? 0),
      deaths: a.deaths + (r.deaths ?? 0),
    }), { damage: 0, healing: 0, deaths: 0 });
  return {
    live: true,
    // Fixed for the whole match, like the real monitor's `startedAt`.
    startedAt: liveStartedAt,
    // A short hero select, then the first round running.
    clock: tick < 5
      ? { phase: 'hero-select', bankedMs: 0 }
      : { phase: 'round', bankedMs: 0, runningSince: liveStartedAt + 5_000 },
    map: 'Ilios',
    totals: { yours: side(0), theirs: side(1), known: true, deathsKnown: true },
    gameType: 'competitive',
    roster: orderScoreboard(roster),
    // Withheld at the source when the setting is off, as the real monitor does.
    feed: config.ui.liveKillFeed ? ([
      { at: Date.now(), attacker: 'Kirito', victim: 'Takigano', attackerHero: 'Pharah',
        attackerFriendly: true, deployable: { hero: 'Illari', label: 'Healing Pylon' } },
      { at: Date.now() - 2000, attacker: 'Kiriko', victim: 'Karambo', attackerHero: 'Kiriko',
        victimHero: 'Reinhardt', attackerFriendly: true, revive: true },
    ] as LiveMatchPayload['feed']).concat(Array.from({ length: Math.min(4, tick + 1) }, (_, i) => ({
      at: Date.now() - i * 4000,
      attacker: i % 2 ? 'You#1234' : known[0] ?? 'Enemy#1',
      victim: i % 2 ? known[4] ?? 'Enemy#2' : 'You#1234',
      attackerHero: i % 2 ? 'Ana' : 'Genji',
      victimHero: i % 2 ? 'Sigma' : 'Ana',
      attackerFriendly: i % 2 === 1,
    }))) : [],
    teamsKnown: true,
  };
}

/** The capture GEP would hand the pipeline at match end, on the first configured account. */
function capturedMatch(prefix: string, role: Role, outcome?: string): MatchRecord {
  return {
    matchId: `${prefix}-${Date.now()}`,
    battleTag: Object.keys(config.accounts)[0],
    mapName: 'Ilios',
    gameType: 'competitive',
    queueType: role === 'openQ' ? 'open' : 'role',
    heroRole: role,
    heroes: ['Genji'],
    endedAt: Date.now(),
    ...(outcome ? { outcome } : {}),
  };
}

const previewLive = {
  start: (): void => {
    let tick = 0;
    liveStartedAt = Date.now();
    liveMatch.emit(buildLiveMatch(tick));
    clearInterval(liveTimer);
    liveTimer = setInterval(() => liveMatch.emit(buildLiveMatch(++tick)), 1000);
  },
  stop: (): void => {
    clearInterval(liveTimer);
    liveTimer = undefined;
    liveMatch.emit({
      live: false, endedAt: Date.now(), roster: [],
      totals: {
        yours: { damage: 0, healing: 0, deaths: 0 }, theirs: { damage: 0, healing: 0, deaths: 0 },
        known: false, deathsKnown: false,
      },
      feed: [], teamsKnown: false,
    });
  },
  finish: (role: Role = 'damage'): string => {
    previewLive.stop();
    const record = capturedMatch('preview-gep', role, 'victory');
    pipeline.addMatch(record);
    return record.matchId;
  },
  finishWithoutResult: (role: Role = 'damage'): string => {
    previewLive.stop();
    const record = capturedMatch('preview-held', role);
    pipeline.addMatch(record);
    return record.matchId;
  },
};
(window as unknown as { previewLive: typeof previewLive }).previewLive = previewLive;

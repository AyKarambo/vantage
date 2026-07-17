import { app, shell, dialog } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadConfig, saveLocalConfig, saveLocalUiConfig, saveLocalAccounts, getNotionToken, userConfigPath,
  setDevKey as saveDevKey, hasDevKey, type AppConfig,
} from './config';
import { NotionRuntime } from './notionRuntime';
import { OutboxStore } from '../store/outbox';
import { HistoryStore, DB_FILE } from '../store/history';
import { migrateJsonHistory } from '../store/historyMigration';
import { resolveDataDir } from '../store/historyLocation';
import { migrateDataFolder, type DataMigrationStores } from '../store/dataMigration';
import { ManualStore } from '../store/manualLog';
import { RankAnchorStore } from '../store/rankAnchors';
import { MasterDataStore } from '../store/masterData';
import { fetchOverfast } from './masterDataUpdate';
import { fetchServiceStatus } from './statusFeed';
import { createGepServicePoller } from './gepServicePoller';
import { decideGepNotification, nextNotifyBaseline, type ServiceStatus } from '../core/gepService';
import { DEFAULT_MASTER_DATA, mergeMasterData } from '../core/masterData';
import { GepService, type GepStatus } from './gep';
import { MatchAggregator } from '../core/matchAggregator';
import type { GepMessage } from '../core/model';
import { generateSampleGames } from '../core/sampleData';
import { computeDevMode } from '../core/devMode';
import { resolveMapId } from '../core/resolvers/mapId';
import { UNKNOWN_ACCOUNT, recoverableAccount } from '../core/accountsManage';
import { safeReadiness } from '../core/readiness';
import { isCompetitive } from '../core/matchFilter';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../core/targets';
import type { NetErrorKind } from '../core/netError';
import { CounterwatchReader } from './counterwatch';
import { DashboardWindow } from './dashboard';
import { createMatchPipeline } from './matchPipeline';
import { createDataProvider } from './dataProvider';
import { createLogger, type Logger } from './logger';
import { createGepStatusMonitor } from './gepStatusMonitor';
import type { LogEntry } from '../core/logging';
import { EVENT_CHANNELS, type DataLocation, type DataLocationResult, type GameLoggedPayload, type GepStatusPayload } from '../shared/contract';
import { TrayController, type TrayHandlers } from './tray';
import { setAutoLaunch } from './autolaunch';
import { runSimulation } from './simulate';
import { GepRecorder, readRecording, replayRecording } from './recorder';

/**
 * THE composition root of the main process: all wiring lives here; modules
 * receive dependencies, they never construct them. Owns the single-instance
 * lock, constructs every concrete service, feeds the factories (match pipeline,
 * data provider), picks the sensor, and starts the dev simulate/replay paths.
 */

/**
 * Network/API failure kinds (`core/netError.ts`) that must NOT ambush the user
 * with a native OS toast: these mean the transport never got a real answer
 * (offline, timed out, or the remote service itself being down) — not an app
 * fault, and in particular not something someone who simply launched offline
 * should see fired at them ~2s after opening the app (the reported bug,
 * AC-5). `auth`/`notFound`/an unclassified kind still toast: those are real,
 * actionable outcomes (a denied/missing configuration, or something this
 * runtime couldn't classify) worth surfacing immediately, not a transport
 * hiccup that resolves itself once the connection comes back.
 */
const SILENT_NET_ERROR_KINDS: ReadonlySet<NetErrorKind> = new Set(['offline', 'timeout', 'server']);

/**
 * Whether an `onError` failure of this classified kind should surface as a
 * native OS toast (policy decision kept here, at the composition root — see
 * the module doc above). Exported so the rule itself is unit-testable
 * without booting Electron.
 */
export function shouldToastNetError(kind: NetErrorKind | undefined): boolean {
  return !kind || !SILENT_NET_ERROR_KINDS.has(kind);
}

// Single instance: a second launch just focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.timoseikel.vantage');
  app.on('window-all-closed', () => {}); // tray app — keep running with no windows
  app.whenReady().then(main).catch((err: unknown) => console.error('startup failed', err));
}

function main(): void {
  let config = loadConfig();

  // The release log exists before everything else so every subsystem can be
  // wired to it. The dashboard push hook is filled in once the window exists.
  let pushEntry: (e: LogEntry) => void = () => {};
  const log = createLogger({
    dir: path.join(app.getPath('userData'), 'logs'),
    getSecrets: () => [getNotionToken() ?? ''].filter(Boolean),
    onEntry: (e) => pushEntry(e),
    mirrorToConsole: !app.isPackaged,
  });
  log.info('main', 'Vantage started', { version: app.getVersion(), sensor: config.sensor });
  // Monitor (not handler): logs fatal errors without changing crash semantics.
  process.on('uncaughtExceptionMonitor', (err) => {
    log.error('main', 'uncaughtException', { error: String(err?.stack ?? err) });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('main', 'unhandledRejection', {
      error: String(reason instanceof Error ? reason.stack ?? reason.message : reason),
    });
  });

  const defaultDataDir = path.join(app.getPath('userData'), 'data');

  // The data folder is user-configurable (default <userData>/data) so it can
  // sit in a cloud-synced folder for backup. `dataDir` is mutable: a Settings
  // change or a first-run choice repoints it (and every store below) without
  // restarting the process. If a configured folder can't be opened, fail loud
  // rather than silently creating a second, empty database.
  let dataDir = resolveDataDir(config.dataFolder, defaultDataDir);

  // Backfill for installs that used the legacy `historyDbFolder` ("move
  // history DB" feature): that setting only ever relocated history.db, so its
  // manual.json/outbox.json/rankAnchors.json/history.json still
  // sit in the default userData/data dir. Once `dataFolder`/`historyDbFolder`
  // resolves every store (including the side-stores) to that legacy folder,
  // those files would silently look empty/missing there. One-time, idempotent,
  // per-file: move whatever's missing at `dataDir` but present at
  // `defaultDataDir` over, before any store constructs and reads/creates them.
  if (dataDir !== defaultDataDir) backfillLegacySideStores(defaultDataDir, dataDir, log);

  const outbox = new OutboxStore(dataDir);

  let history: HistoryStore;
  try {
    history = new HistoryStore(dataDir);
  } catch (err) {
    log.error('store', 'failed to open history database', { dir: dataDir, error: String(err) });
    if (dataDir !== defaultDataDir) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Vantage — history database unavailable',
        message: 'Your Vantage match-history folder is unavailable.',
        detail: `Could not open the database in:\n${dataDir}\n\nIf this is a synced folder (OneDrive/Dropbox), reconnect it and restart Vantage. Vantage won't start, to avoid creating a second empty database and appearing to lose your history.`,
      });
      app.quit();
      return;
    }
    throw err;
  }
  // One-time import of a pre-SQLite history.json — kept frozen as a backup. The
  // legacy file always lived in the default data dir, wherever the DB is now.
  migrateJsonHistory(history, path.join(dataDir, 'history.json'));
  // One-time, idempotent backfill of existing rows now that the resolvers exist:
  //  - re-resolve numeric GEP map ids to names (e.g. "1207" → "Nepal", "4140" →
  //    "Neon Junction") and fold the legacy "Neon Junktion" spelling; and
  //  - re-attribute legacy `account: 'Unknown'` rows whose captured local roster
  //    BattleTag now maps to a configured account (Feedback F1) — only pre-#129
  //    rows that still carry a local roster tag; the rest stay Unknown.
  // A re-run rewrites nothing.
  const backfilled = history.reresolve((g) => ({
    map: resolveMapId(g.map),
    account: g.account === UNKNOWN_ACCOUNT ? recoverableAccount(g.roster, config.accounts) : undefined,
  }));
  if (backfilled) log.info('store', 'backfilled map names / recovered Unknown rows', { rows: backfilled });

  // First-run detection is config-driven, not file-existence: HistoryStore's
  // constructor above already created history.db in dataDir, so a "does
  // history.db exist" check would always be true and the prompt would never
  // fire. `dataFolder`/legacy `historyDbFolder` is only ever persisted once the
  // user has made (or accepted) a choice, so its absence plus an empty store is
  // the correct, self-clearing signal (Decision C.5). Mutable: the first-run
  // picker clears it explicitly once a choice is persisted, even when the
  // choice is "keep the default" — so it never re-triggers.
  let firstRunNeedsDataChoice =
    config.dataFolder === undefined && config.historyDbFolder === undefined && history.count() === 0;

  const manual = new ManualStore(dataDir);
  // One-time, idempotent migration (Decision B.3): the pre-batch importer used
  // to seed a *visible* "Improvement Target" authored target so Notion-imported
  // grades had somewhere to render. That's gone (B2 keeps it hidden bookkeeping
  // only) — remove the stale seeded target by id. Matching by id (not name)
  // means a user-authored target that merely shares the name survives, along
  // with its grades; `removeTarget` is a no-op once the seeded target is gone.
  manual.removeTarget(NOTION_IMPROVEMENT_TARGET_ID);
  const rankAnchors = new RankAnchorStore(dataDir);
  const masterDataStore = new MasterDataStore(dataDir);
  // Effective (defaults ⊕ overrides) map views for the Notion Maps seed (all maps)
  // and the sample generator's competitive pool (active only).
  const allMapNames = (): string[] =>
    mergeMasterData(DEFAULT_MASTER_DATA, masterDataStore.all()).maps.map((m) => m.name);
  const activeMapNames = (): string[] =>
    mergeMasterData(DEFAULT_MASTER_DATA, masterDataStore.all()).maps.filter((m) => m.isActive).map((m) => m.name);
  const aggregator = new MatchAggregator();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  // The migration executor repoints every store at once.
  const migrationStores = (): DataMigrationStores => ({
    history,
    manualLog: manual,
    outbox,
    rankAnchors,
    masterData: masterDataStore,
  });

  /** True iff `dir` already holds a Vantage history database. */
  function hasExistingData(dir: string): boolean {
    try {
      return fs.existsSync(path.join(dir, DB_FILE));
    } catch {
      return false;
    }
  }

  /** Run (or plan) a data-folder change and, on success, repoint `dataDir`. */
  function applyDataFolder(folder: string, adopt: boolean): DataLocationResult {
    const target = path.resolve(folder);
    const result = migrateDataFolder({
      fromDir: dataDir,
      toDir: target,
      stores: migrationStores(),
      adopt,
      persistFolder: (dir) => saveLocalConfig({ dataFolder: dir }),
    });
    if (!result.ok) return { ok: false, error: result.error ?? 'Data folder change failed.' };
    config = loadConfig();
    dataDir = target;
    firstRunNeedsDataChoice = false;
    log.info('store', result.adopted ? 'data folder adopted' : 'data folder migrated', { dir: dataDir });
    return {
      ok: true,
      changed: true,
      location: currentDataLocation(),
      ...(result.leftovers ? { leftovers: result.leftovers } : {}),
    };
  }

  /** First-run "keep the default folder" choice: nothing to move, but the
   *  choice must still be persisted explicitly so the first-run flag
   *  self-clears (Decision C.5) and never re-prompts on a later launch. */
  function keepDefaultDataFolder(): DataLocationResult {
    saveLocalConfig({ dataFolder: dataDir });
    config = loadConfig();
    firstRunNeedsDataChoice = false;
    return { ok: true, changed: false, location: currentDataLocation() };
  }

  function currentDataLocation(): DataLocation {
    return { folder: dataDir, isDefault: dataDir === defaultDataDir };
  }

  /** Native folder picker shared by the Settings "Change…" flow and first run. */
  async function pickDataFolder(): Promise<string | undefined> {
    const res = await dialog.showOpenDialog({
      title: 'Choose the Vantage data folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return undefined;
    return res.filePaths[0];
  }

  /**
   * Native file picker for the Settings → Data "Import from file" action:
   * returns the parsed JSON of the chosen file, or `undefined` when cancelled.
   * Read/parse failures throw — the provider turns them into an error result.
   */
  async function pickImportFile(): Promise<unknown | undefined> {
    const res = await dialog.showOpenDialog({
      title: 'Choose a Vantage import file',
      properties: ['openFile'],
      filters: [{ name: 'Vantage import', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths.length) return undefined;
    return JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  }

  /**
   * Native save dialog for "Report a bug" → export debug log: writes `contents`
   * verbatim to wherever the user picks and nowhere else. Cancelling returns
   * `undefined` and writes nothing — there is no automatic upload path
   * (guardrail 5, local-first).
   */
  async function saveTextFile(defaultName: string, contents: string): Promise<string | undefined> {
    const res = await dialog.showSaveDialog({
      title: 'Save debug log',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Text log', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return undefined;
    await fs.promises.writeFile(res.filePath, contents, 'utf8');
    return res.filePath;
  }

  let pushSyncProgress: (done: number, total: number) => void = () => {};
  // Filled in once the dashboard window exists (mirrors pushEntry/pushSyncProgress).
  let pushGameLogged: (payload: GameLoggedPayload) => void = () => {};
  const notion = new NotionRuntime({
    outbox,
    config: () => config,
    reloadConfig: () => (config = loadConfig()),
    // Unfiltered history — NotionRuntime.status() counts the competitive games
    // that still need syncing (never-exported / changed-since-export) itself.
    historyGames: () => history.all(),
    importedMatches: () => history.importedCount('notion'),
    onTokenState: (tokenSet) => tray.setState({ tokenSet }),
    onError: (title, body, kind) => {
      log.error('notion', `${title}: ${body}`);
      // A transport failure (offline/timed out/remote down) is not an app
      // fault — toasting it would ambush someone who simply launched offline
      // (the reported AC-5 bug). Every other case, including an unclassified
      // error, still toasts, exactly as before this fix.
      if (shouldToastNetError(kind)) tray.notifyError(title, body);
    },
    onSyncProgress: (done, total) => pushSyncProgress(done, total),
    // Read live on every export: the user's own authored targets, active AND
    // archived — same "visible in-app" semantics `buildTargets` uses for the
    // dashboard's Targets library (everything except the hidden Notion
    // bookkeeping id). Archived targets still count because they keep their
    // accrued grades and still render (behind Restore) — only the bookkeeping
    // id is never a real, user-facing target.
    authoredTargetIds: () =>
      new Set(manual.targets().filter((t) => t.id !== NOTION_IMPROVEMENT_TARGET_ID).map((t) => t.id)),
    // The same visible authored targets WITH their rules, so measured (⚡) targets
    // can be auto-graded from each match's stats and folded into the exported
    // Improvement Target aggregate — matching the in-app numbers.
    authoredTargets: () =>
      manual.targets().filter((t) => t.id !== NOTION_IMPROVEMENT_TARGET_ID),
    // The live partial-credit margin, so a measured grade folded into the export
    // matches the in-app one even after the user tunes the margin.
    authoredPartialMargin: () => config.grading.partialMargin,
    // Seed a freshly auto-created Maps DB with ALL effective maps (active + inactive)
    // so historical matches on any map still relate to a page (spec AC 32).
    mapNames: allMapNames,
  });

  // Fires when the pending ("needs result") set changes, so an open Review
  // screen re-fetches (placeholder until the window exists, like pushGameLogged).
  let pushPendingChanged: () => void = () => {};
  const pipeline = createMatchPipeline({
    history,
    aggregator,
    getConfig: () => config,
    notify: (title, body) => tray.notify(title, body),
    log: log.adapter('pipeline'),
    // Tell the renderer which account a newly recorded competitive match landed on
    // — drives the live dashboard refresh and the F4 account auto-switch.
    onGameLogged: (payload) => pushGameLogged(payload),
    onPendingChanged: () => pushPendingChanged(),
  });

  // Truthful connection indicator: folds GEP signals into the four-state
  // health model and fans changes out to the window, tray, and log.
  let publishStatus: (p: GepStatusPayload) => void = () => {};
  const statusMonitor = createGepStatusMonitor({
    sensor: config.sensor === 'gep' ? 'gep' : 'counterwatch',
    log: (scope, message, fields) => log.info(scope, message, fields),
    publish: (p) => publishStatus(p),
  });

  const dataProvider = createDataProvider({
    history,
    manual,
    rankAnchors,
    masterDataStore,
    fetchMasterDataUpdate: () => fetchOverfast(config.masterData.overfastBaseUrl),
    notion,
    getConfig: () => config,
    persistAccounts: (accounts) => {
      saveLocalAccounts(accounts);
      config = loadConfig();
    },
    importFile: { pick: pickImportFile },
    persistBreakReminder: (breakReminder) => saveLocalConfig({ breakReminder }),
    persistStaleness: (staleness) => saveLocalConfig({ staleness }),
    persistReadiness: (readiness) => saveLocalConfig({ readiness }),
    persistSessionSettings: (sessionSettings) => saveLocalConfig({ sessionSettings }),
    persistGrading: (grading) => saveLocalConfig({ grading }),
    recordGame: (game) => pipeline.recordGame(game),
    resolvePending: (matchId, result) => pipeline.resolvePending(matchId, result),
    dismissPending: (matchId) => pipeline.dismissPending(matchId),
    notify: (title, body) => tray.notify(title, body),
    // Demo season draws only from the active competitive pool (spec AC 24).
    sampleGames: () => generateSampleGames(180, 42, activeMapNames()),
    logger: log,
    // Same source fed to the logger's own redaction — a registered Notion
    // token is stripped from an exported log bundle too.
    getSecrets: () => [getNotionToken() ?? ''].filter(Boolean),
    gepStatus: () => statusMonitor.current(),
    appSettings: {
      get: () => ({
        closeToTray: config.ui.closeToTray,
        // Display the persisted intent, not the OS read-back. On an unpackaged /
        // dev Windows build, getLoginItemSettings().openAtLogin does not reliably
        // reflect a value just written by setLoginItemSettings, which made the
        // toggle look "dead" (it re-painted with the stale old value).
        runAtLogin: config.runAtLogin,
        demoPreference: config.ui.demoPreference,
        devMode: config.ui.devMode,
        gepNotifications: config.ui.gepNotifications,
        lastSeenVersion: config.ui.lastSeenVersion,
      }),
      apply: (patch) => {
        if (patch.closeToTray !== undefined) {
          saveLocalUiConfig({ closeToTray: patch.closeToTray });
          config = loadConfig();
        }
        if (patch.runAtLogin !== undefined) {
          setAutoLaunch(patch.runAtLogin);
          saveLocalConfig({ runAtLogin: patch.runAtLogin });
          config = loadConfig();
          tray.setState({ autoLaunch: patch.runAtLogin });
        }
        if (patch.demoPreference !== undefined) {
          saveLocalUiConfig({ demoPreference: patch.demoPreference });
          config = loadConfig();
        }
        // Dev Mode is a next-launch preference the launcher (scripts/ow-dev.mjs)
        // reads; persisting it here is enough — no live process change.
        if (patch.devMode !== undefined) {
          saveLocalUiConfig({ devMode: patch.devMode });
          config = loadConfig();
        }
        if (patch.gepNotifications !== undefined) {
          saveLocalUiConfig({ gepNotifications: patch.gepNotifications });
          config = loadConfig();
        }
        if (patch.lastSeenVersion !== undefined) {
          saveLocalUiConfig({ lastSeenVersion: patch.lastSeenVersion });
          config = loadConfig();
        }
        return {
          closeToTray: config.ui.closeToTray,
          runAtLogin: config.runAtLogin,
          demoPreference: config.ui.demoPreference,
          devMode: config.ui.devMode,
          gepNotifications: config.ui.gepNotifications,
          lastSeenVersion: config.ui.lastSeenVersion,
        };
      },
    },
    appInfo: () => ({
      version: app.getVersion(),
      supportEmail: 'timo.seikel@gmail.com',
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      osRelease: os.release(),
      packaged: app.isPackaged,
      // Truthful dev-mode read: unpackaged AND dev credentials in the env at
      // start (injected by scripts/ow-dev.mjs) — see core/devMode.
      devMode: computeDevMode({ packaged: app.isPackaged, env: process.env }),
      // The loaded GEP package version (from the live status snapshot); '' until
      // the package reports ready. Changes when Overwolf ships a fix.
      gepPackageVersion: statusMonitor.current().gepPackageVersion ?? '',
    }),
    // Store the Overwolf dev key where the launcher reads it (~/.ow-cli/dev-key),
    // never in app config. Takes effect next launch (Dev Mode auth is start-time).
    setDevKey: (key: string) => {
      saveDevKey(key);
      return { hasKey: hasDevKey() };
    },
    openExternal: (url) => shell.openExternal(url),
    saveTextFile,
    // Apply a staged GEP package fix by restarting the app — Overwolf installs
    // downloaded packages on launch. Only ever called from the user's explicit
    // "restart to apply" click (never automatic).
    applyGepUpdate: () => { app.relaunch(); app.exit(0); },
    dataLocation: {
      get: () => ({ ...currentDataLocation(), ...(firstRunNeedsDataChoice ? { needsFirstRunChoice: true } : {}) }),
      choose: async (): Promise<DataLocationResult> => {
        const chosen = await pickDataFolder();
        if (!chosen) return { ok: true, location: currentDataLocation(), changed: false };
        const target = path.resolve(chosen);
        if (target === dataDir) return { ok: true, location: currentDataLocation(), changed: false };
        if (hasExistingData(target)) {
          // Surface the PICKED folder, not the still-current one — the renderer's
          // confirm-adopt flow (settings.ts / dataLocationPrompt.ts) targets
          // whatever `location.folder` says, so returning the current folder here
          // made "adopt" a silent no-op that re-adopted the folder already in use.
          return { ok: true, location: { folder: target, isDefault: target === defaultDataDir }, changed: false, requiresAdopt: true };
        }
        return applyDataFolder(target, false);
      },
      set: async (input) => applyDataFolder(input.folder, input.adopt ?? false),
      chooseFirstRun: async (): Promise<DataLocationResult> => {
        const chosen = await pickDataFolder();
        if (!chosen) return keepDefaultDataFolder();
        const target = path.resolve(chosen);
        if (target === dataDir) return keepDefaultDataFolder();
        return applyDataFolder(target, hasExistingData(target));
      },
    },
  });

  const handlers: TrayHandlers = {
    onOpenDashboard: () => dashboard.open(),
    onToggleAutoLaunch: (enabled) => {
      setAutoLaunch(enabled);
      saveLocalConfig({ runAtLogin: enabled });
      tray.setState({ autoLaunch: enabled });
    },
    onImportToken: (token) => {
      notion.setToken(token);
    },
    onReloadConfig: () => {
      config = loadConfig();
      notion.rebuild();
      tray.notify('Config reloaded', 'Accounts and map aliases were re-read.');
    },
    onOpenGametracker: () => {
      if (config.notion.gametrackerUrl) void shell.openExternal(config.notion.gametrackerUrl);
    },
    onOpenConfig: () => tray.openConfigFile(userConfigPath(), configTemplate(config)),
    onOpenSupport: () => {
      void shell.openExternal('mailto:timo.seikel@gmail.com');
    },
    onQuit: () => {
      tray.destroy();
      app.quit();
    },
  };

  const tray = new TrayController(iconPath, handlers);
  const dashboard = new DashboardWindow(dataProvider, iconPath, {
    closeToTray: () => config.ui.closeToTray,
    savedBounds: () => config.ui.windowBounds,
    saveBounds: (windowBounds) => {
      saveLocalUiConfig({ windowBounds });
      config = loadConfig();
    },
  });
  pushEntry = (e) => dashboard.push(EVENT_CHANNELS.onLogEntry, e);
  let prevService: ServiceStatus | null = null;
  publishStatus = (p) => {
    dashboard.push(EVENT_CHANNELS.onGepStatus, p);
    tray.setHealth(p.state);
    // Notify on a service down/recovery transition (banner always shows; only the
    // toast is gated by the user's setting). prevService is tracked regardless, so
    // re-enabling mid-outage doesn't fire on a stale diff.
    const nextService: ServiceStatus | null = p.serviceStatus
      ? { level: p.serviceStatus, ...(p.serviceMessage ? { message: p.serviceMessage } : {}) }
      : null;
    if (config.ui.gepNotifications) {
      const note = decideGepNotification(prevService, nextService);
      if (note) tray.notify(note.title, note.body);
    }
    // Carry the last authoritative reading forward so a transient 'unknown' can't
    // mask a real down/recovery transition (nor re-fire on re-enable).
    prevService = nextNotifyBaseline(prevService, nextService);
  };
  pushSyncProgress = (done, total) => dashboard.push(EVENT_CHANNELS.onSyncProgress, { done, total });
  pushGameLogged = (payload) => dashboard.push(EVENT_CHANNELS.onGameLogged, payload);
  pushPendingChanged = () => dashboard.push(EVENT_CHANNELS.onPendingChanged, undefined);
  statusMonitor.start();

  // Overwolf "front app" behaviour: relaunching the app (e.g. clicking its dock
  // icon while it's already running) must bring the window to the front.
  app.on('second-instance', () => dashboard.open());

  if (config.sensor === 'gep') {
    const gep = new GepService(config.overwatchGameId);
    gep.on('message', pipeline.feed);
    gep.on('message', (msg: GepMessage) => statusMonitor.message(msg));
    gep.on('status', (s: GepStatus) => {
      tray.setState({ status: statusText(s, history.count(), config.ui.demoPreference === 'on') });
      statusMonitor.setLastError(s.lastError);
      statusMonitor.setAttached(s.gameRunning && s.enabled);
      statusMonitor.setGepPackageVersion(s.gepVersion);
      statusMonitor.setUpdateStaged(Boolean(s.updateStaged));
    });
    gep.on('log', log.adapter('gep'));

    // Poll Overwolf's public GEP service-status feed so an Overwatch-patch outage
    // (and its recovery) is surfaced authoritatively — not guessed from local
    // signals. Sends only the game id; makes no outage claim when unreachable.
    createGepServicePoller({
      fetchStatus: () => fetchServiceStatus(config.overwatchGameId),
      onStatus: (s) => statusMonitor.setServiceStatus(s),
      log: (scope, message, fields) => log.info(scope, message, fields),
    }).start();

    // Testing only: capture the live GEP stream to userData/recordings/*.jsonl so
    // a real session can be replayed later (OW_SYNC_REPLAY) without the game.
    if (process.env.OW_SYNC_RECORD === '1') {
      const recorder = new GepRecorder(path.join(app.getPath('userData'), 'recordings'));
      gep.on('message', (msg: GepMessage) => recorder.message(msg));
      gep.on('status', (s: GepStatus) => recorder.lifecycle(s.gameRunning ? 'game-running' : 'game-idle'));
      log.info('recorder', 'recording GEP session', { path: recorder.path });
    }
  } else {
    const cw = new CounterwatchReader();
    cw.on('match', (record) => pipeline.addMatch(record));
    cw.on('log', log.adapter('cw'));
    cw.start();
  }

  tray.init({
    status: tray0Status(history.count(), config.ui.demoPreference === 'on'),
    autoLaunch: config.runAtLogin,
    tokenSet: Boolean(getNotionToken()),
  });
  notion.rebuild();

  // Readiness launch nudge (opt-in, off by default): one tray toast when the
  // player is grinding into the hole. A post-hoc read of stored history only —
  // never touches the game (guardrail 1).
  if (config.readiness.enabled && config.readiness.launchToast) {
    // Competitive-only, matching the dashboard's readiness feed (dashboardData.ts:51)
    // — previously this read the RAW history and could disagree with the dashboard
    // verdict for quickplay-heavy histories. Active targets feed the dampener.
    const readiness = safeReadiness(
      history.all().filter((g) => isCompetitive(g.gameType)),
      Date.now(),
      { targets: manual.targets(), rankAnchors: rankAnchors.map() },
    );
    if (readiness.band === 'in-the-hole') {
      tray.notify(
        'Readiness: time to rest',
        readiness.recommendationText || 'You may be grinding into the hole — a rest day should help your form rebound.',
      );
    }
  }

  // Open the dashboard on a manual launch; when auto-launched at login (--hidden),
  // stay in the tray so we never steal focus from a running game.
  if (!process.argv.includes('--hidden')) dashboard.open();

  if (process.argv.includes('--simulate') || process.env.OW_SYNC_SIMULATE === '1') {
    const battleTag = Object.keys(config.accounts)[0] ?? 'Karambo#0000';
    setTimeout(() => {
      void runSimulation(pipeline.feed, (m) => log.info('sim', m), { battleTag, map: "King's Row" });
    }, 1500);
  }

  // Testing only: replay a captured recording through the live pipeline.
  const replayFile = process.env.OW_SYNC_REPLAY;
  if (replayFile) {
    setTimeout(() => {
      try {
        const entries = readRecording(replayFile);
        void replayRecording(entries, pipeline.feed, { realtime: true, log: (m) => log.info('replay', m) });
      } catch (err) {
        log.error('replay', 'failed to read recording', { file: replayFile, error: String(err) });
      }
    }, 1500);
  }
}

/**
 * Legacy-`historyDbFolder` backfill (finding: side-stores silently orphaned).
 * That old setting only ever relocated `history.db`; every other data file
 * (`manual.json`, `outbox.json`, `rankAnchors.json`, and the frozen
 * `history.json` backup) still lives in `defaultDir`. Now that
 * `dataFolder`/`historyDbFolder` resolves every store to `targetDir`, those
 * files must move over too — but only per-file, only when the file is
 * genuinely missing at `targetDir` (never overwrite something already there),
 * and only when it's actually present at `defaultDir` (nothing to do
 * otherwise). Runs before any store constructs, so every store sees its file
 * already in place. Best-effort and non-fatal: a failed move is logged, not
 * thrown — Vantage should still start rather than block on backfill trouble.
 */
function backfillLegacySideStores(defaultDir: string, targetDir: string, log: Pick<Logger, 'info' | 'error'>): void {
  const fileNames = ['manual.json', 'outbox.json', 'rankAnchors.json', 'history.json'];
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    log.error('store', 'legacy side-store backfill: could not create data dir', { targetDir, error: String(err) });
    return;
  }
  for (const name of fileNames) {
    const from = path.join(defaultDir, name);
    const to = path.join(targetDir, name);
    try {
      if (fs.existsSync(to) || !fs.existsSync(from)) continue;
      fs.renameSync(from, to);
      log.info('store', 'legacy side-store backfilled', { file: name, from, to });
    } catch (err) {
      log.error('store', 'legacy side-store backfill failed', { file: name, from, to, error: String(err) });
    }
  }
}

function statusText(s: GepStatus, count: number, demoOn: boolean): string {
  if (s.lastError) return `Issue: ${s.lastError.slice(0, 60)}`;
  if (s.gameRunning && s.enabled) return 'Overwatch detected — tracking';
  return tray0Status(count, demoOn);
}

function tray0Status(count: number, demoOn: boolean): string {
  if (count) return `${count} games tracked`;
  return demoOn ? 'No games yet — showing demo data' : 'No games yet — track a match to begin';
}

function configTemplate(config: AppConfig): string {
  return JSON.stringify(
    { runAtLogin: config.runAtLogin, accounts: config.accounts, mapAliases: config.mapAliases },
    null,
    2,
  );
}

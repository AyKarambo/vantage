import { app, shell, dialog } from 'electron';
import * as path from 'path';
import {
  loadConfig, saveLocalConfig, saveLocalUiConfig, saveLocalAccounts, getNotionToken, userConfigPath, type AppConfig,
} from './config';
import { NotionRuntime } from './notionRuntime';
import { OutboxStore } from '../store/outbox';
import { HistoryStore } from '../store/history';
import { migrateJsonHistory } from '../store/historyMigration';
import { resolveHistoryDir } from '../store/historyLocation';
import { ManualStore } from '../store/manualLog';
import { RankAnchorStore } from '../store/rankAnchors';
import { GepService, type GepStatus } from './gep';
import { ScreenshotService } from './screenshots';
import { MatchAggregator } from '../core/matchAggregator';
import type { GepMessage } from '../core/model';
import { generateSampleGames } from '../core/sampleData';
import { safeReadiness } from '../core/readiness';
import { CounterwatchReader } from './counterwatch';
import { DashboardWindow } from './dashboard';
import { createMatchPipeline } from './matchPipeline';
import { createDataProvider } from './dataProvider';
import { createLogger } from './logger';
import { createGepStatusMonitor } from './gepStatusMonitor';
import type { LogEntry } from '../core/logging';
import { EVENT_CHANNELS, type GepStatusPayload } from '../shared/contract';
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

  const dataDir = path.join(app.getPath('userData'), 'data');
  const outbox = new OutboxStore(dataDir);

  // History lives in a user-configurable folder (default <userData>/data) so it
  // can sit in a cloud-synced folder for backup. If a configured folder can't be
  // opened, fail loud rather than silently creating a second, empty database.
  let historyDir = resolveHistoryDir(config.historyDbFolder, dataDir);
  let history: HistoryStore;
  try {
    history = new HistoryStore(historyDir);
  } catch (err) {
    log.error('store', 'failed to open history database', { dir: historyDir, error: String(err) });
    if (historyDir !== dataDir) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Vantage — history database unavailable',
        message: 'Your Vantage match-history folder is unavailable.',
        detail: `Could not open the database in:\n${historyDir}\n\nIf this is a synced folder (OneDrive/Dropbox), reconnect it and restart Vantage. Vantage won't start, to avoid creating a second empty database and appearing to lose your history.`,
      });
      app.quit();
      return;
    }
    throw err;
  }
  // One-time import of a pre-SQLite history.json — kept frozen as a backup. The
  // legacy file always lived in the default data dir, wherever the DB is now.
  migrateJsonHistory(history, path.join(dataDir, 'history.json'));

  const manual = new ManualStore(dataDir);
  const rankAnchors = new RankAnchorStore(dataDir);
  const aggregator = new MatchAggregator();
  const screenshots = new ScreenshotService(path.join(dataDir, 'screenshots'), log.adapter('shots'));
  screenshots.registerProtocol();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  let pushSyncProgress: (done: number, total: number) => void = () => {};
  const notion = new NotionRuntime({
    outbox,
    config: () => config,
    reloadConfig: () => (config = loadConfig()),
    trackedGames: () => history.count(),
    importedMatches: () => history.importedCount(),
    onTokenState: (tokenSet) => tray.setState({ tokenSet }),
    onError: (title, body) => {
      log.error('notion', `${title}: ${body}`);
      tray.notifyError(title, body);
    },
    onSyncProgress: (done, total) => pushSyncProgress(done, total),
  });

  const pipeline = createMatchPipeline({
    history,
    aggregator,
    screenshots,
    getConfig: () => config,
    notify: (title, body) => tray.notify(title, body),
    log: log.adapter('pipeline'),
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
    notion,
    getConfig: () => config,
    persistAccounts: (accounts) => {
      saveLocalAccounts(accounts);
      config = loadConfig();
    },
    persistBreakReminder: (breakReminder) => saveLocalConfig({ breakReminder }),
    persistReadiness: (readiness) => saveLocalConfig({ readiness }),
    recordGame: (game) => pipeline.recordGame(game),
    notify: (title, body) => tray.notify(title, body),
    sampleGames: generateSampleGames,
    logger: log,
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
        return {
          closeToTray: config.ui.closeToTray,
          runAtLogin: config.runAtLogin,
          demoPreference: config.ui.demoPreference,
        };
      },
    },
    appInfo: () => ({ version: app.getVersion(), supportEmail: 'timo.seikel@gmail.com' }),
    database: {
      location: () => ({ folder: historyDir, isDefault: historyDir === dataDir }),
      choose: async () => {
        const res = await dialog.showOpenDialog({
          title: 'Choose the Vantage database folder',
          properties: ['openDirectory', 'createDirectory'],
        });
        const current = { folder: historyDir, isDefault: historyDir === dataDir };
        if (res.canceled || !res.filePaths.length) return { ok: true as const, location: current, changed: false };
        const chosen = res.filePaths[0];
        try {
          history.relocate(chosen);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('store', 'history database relocate failed', { dir: chosen, error: message });
          return { ok: false as const, error: message };
        }
        saveLocalConfig({ historyDbFolder: chosen });
        config = loadConfig();
        historyDir = resolveHistoryDir(config.historyDbFolder, dataDir);
        log.info('store', 'history database relocated', { dir: historyDir });
        return { ok: true as const, location: { folder: historyDir, isDefault: historyDir === dataDir }, changed: true };
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
  publishStatus = (p) => {
    dashboard.push(EVENT_CHANNELS.onGepStatus, p);
    tray.setHealth(p.state);
  };
  pushSyncProgress = (done, total) => dashboard.push(EVENT_CHANNELS.onSyncProgress, { done, total });
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
    });
    gep.on('log', log.adapter('gep'));

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
    const readiness = safeReadiness(history.all());
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

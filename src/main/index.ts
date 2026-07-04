import { app, shell } from 'electron';
import * as path from 'path';
import {
  loadConfig, saveLocalConfig, getNotionToken, userConfigPath, type AppConfig,
} from './config';
import { NotionRuntime } from './notionRuntime';
import { OutboxStore } from '../store/outbox';
import { HistoryStore } from '../store/history';
import { ManualStore } from '../store/manualLog';
import { GepService, type GepStatus } from './gep';
import { ScreenshotService } from './screenshots';
import { MatchAggregator } from '../core/matchAggregator';
import type { GepMessage } from '../core/model';
import { generateSampleGames } from '../core/sampleData';
import { CounterwatchReader } from './counterwatch';
import { DashboardWindow } from './dashboard';
import { createMatchPipeline } from './matchPipeline';
import { createDataProvider } from './dataProvider';
import { TrayController, type TrayHandlers } from './tray';
import { isAutoLaunchEnabled, setAutoLaunch } from './autolaunch';
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

  const dataDir = path.join(app.getPath('userData'), 'data');
  const outbox = new OutboxStore(dataDir);
  const history = new HistoryStore(dataDir);
  const manual = new ManualStore(dataDir);
  const aggregator = new MatchAggregator();
  const screenshots = new ScreenshotService(
    path.join(dataDir, 'screenshots'),
    (...args: unknown[]) => console.log('[shots]', ...args),
  );
  screenshots.registerProtocol();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  const notion = new NotionRuntime({
    outbox,
    config: () => config,
    reloadConfig: () => (config = loadConfig()),
    trackedGames: () => history.count(),
    onTokenState: (tokenSet) => tray.setState({ tokenSet }),
    onError: (title, body) => tray.notifyError(title, body),
  });

  const pipeline = createMatchPipeline({
    history,
    aggregator,
    screenshots,
    getConfig: () => config,
    notify: (title, body) => tray.notify(title, body),
    log: (...args: unknown[]) => console.log(...args),
  });

  const dataProvider = createDataProvider({
    history,
    manual,
    notion,
    getConfig: () => config,
    persistBreakReminder: (breakReminder) => saveLocalConfig({ breakReminder }),
    recordGame: (game) => pipeline.recordGame(game),
    notify: (title, body) => tray.notify(title, body),
    sampleGames: generateSampleGames,
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
  const dashboard = new DashboardWindow(dataProvider, iconPath);

  // Overwolf "front app" behaviour: relaunching the app (e.g. clicking its dock
  // icon while it's already running) must bring the window to the front.
  app.on('second-instance', () => dashboard.open());

  if (config.sensor === 'gep') {
    const gep = new GepService(config.overwatchGameId);
    gep.on('message', pipeline.feed);
    gep.on('status', (s: GepStatus) => tray.setState({ status: statusText(s, history.count()) }));
    gep.on('log', (...args: unknown[]) => console.log('[gep]', ...args));

    // Testing only: capture the live GEP stream to userData/recordings/*.jsonl so
    // a real session can be replayed later (OW_SYNC_REPLAY) without the game.
    if (process.env.OW_SYNC_RECORD === '1') {
      const recorder = new GepRecorder(path.join(app.getPath('userData'), 'recordings'));
      gep.on('message', (msg: GepMessage) => recorder.message(msg));
      gep.on('status', (s: GepStatus) => recorder.lifecycle(s.gameRunning ? 'game-running' : 'game-idle'));
      console.log('[recorder] recording GEP session →', recorder.path);
    }
  } else {
    const cw = new CounterwatchReader();
    cw.on('match', (record) => pipeline.addMatch(record));
    cw.on('log', (...args: unknown[]) => console.log('[cw]', ...args));
    cw.start();
  }

  tray.init({
    status: tray0Status(history.count()),
    autoLaunch: isAutoLaunchEnabled(),
    tokenSet: Boolean(getNotionToken()),
  });
  notion.rebuild();
  // Open the dashboard on a manual launch; when auto-launched at login (--hidden),
  // stay in the tray so we never steal focus from a running game.
  if (!process.argv.includes('--hidden')) dashboard.open();

  if (process.argv.includes('--simulate') || process.env.OW_SYNC_SIMULATE === '1') {
    const battleTag = Object.keys(config.accounts)[0] ?? 'Karambo#0000';
    setTimeout(() => {
      void runSimulation(pipeline.feed, (m) => console.log('[sim]', m), { battleTag, map: "King's Row" });
    }, 1500);
  }

  // Testing only: replay a captured recording through the live pipeline.
  const replayFile = process.env.OW_SYNC_REPLAY;
  if (replayFile) {
    setTimeout(() => {
      try {
        const entries = readRecording(replayFile);
        void replayRecording(entries, pipeline.feed, { realtime: true, log: (m) => console.log('[replay]', m) });
      } catch (err) {
        console.error('[replay] failed to read recording', replayFile, err);
      }
    }, 1500);
  }
}

function statusText(s: GepStatus, count: number): string {
  if (s.lastError) return `Issue: ${s.lastError.slice(0, 60)}`;
  if (s.gameRunning && s.enabled) return 'Overwatch detected — tracking';
  return tray0Status(count);
}

function tray0Status(count: number): string {
  return count ? `${count} games tracked` : 'No games yet — showing demo data';
}

function configTemplate(config: AppConfig): string {
  return JSON.stringify(
    { runAtLogin: config.runAtLogin, accounts: config.accounts, mapAliases: config.mapAliases },
    null,
    2,
  );
}

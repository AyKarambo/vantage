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
import type { GepMessage, MatchRecord } from '../core/model';
import { matchToGame } from '../core/gameRecord';
import { streak, type GameRecord } from '../core/analytics';
import {
  nextBreakReminder, normalizeBreakReminder, INITIAL_BREAK_REMINDER_STATE,
  type BreakReminderState,
} from '../core/breakReminder';
import { generateSampleGames } from '../core/sampleData';
import { CounterwatchReader } from './counterwatch';
import { DashboardWindow, type DataProvider } from './dashboard';
import { TrayController, type TrayHandlers } from './tray';
import { isAutoLaunchEnabled, setAutoLaunch } from './autolaunch';
import { runSimulation } from './simulate';
import { GepRecorder, readRecording, replayRecording } from './recorder';

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

  let reminderState: BreakReminderState = INITIAL_BREAK_REMINDER_STATE;

  const notion = new NotionRuntime({
    outbox,
    config: () => config,
    reloadConfig: () => (config = loadConfig()),
    trackedGames: () => history.count(),
    onTokenState: (tokenSet) => tray.setState({ tokenSet }),
    onError: (title, body) => tray.notifyError(title, body),
  });

  /**
   * Persist a finished game and, on success, evaluate the break reminder against
   * the unfiltered history — a manually logged loss counts the same as a live one.
   * Reminder state is in-memory only: a restart re-arms it (accepted trade-off).
   * Returns whether the game was newly added (false = duplicate matchId).
   */
  function recordGame(game: GameRecord): boolean {
    if (!history.add(game)) return false;
    const s = streak(history.all());
    const { fire, state } = nextBreakReminder(s, config.breakReminder, reminderState);
    reminderState = state;
    if (fire) {
      tray.notify('Time for a break?', `That's ${s.count} losses in a row — step away for a few minutes.`);
    }
    return true;
  }

  const dataProvider: DataProvider = {
    games: () => (history.count() ? history.all() : generateSampleGames()),
    isSample: () => history.count() === 0,
    exportToNotion: (games) => notion.export(games),
    notionStatus: () => notion.status(),
    setNotionToken: (token) => notion.setToken(token),
    clearNotionToken: () => notion.clearToken(),
    manualTargets: () => manual.targets(),
    saveTarget: (input) => {
      manual.addTarget({
        id: `t-${Date.now()}`, createdAt: Date.now(), isActive: true, scope: 'season', ...input,
      });
    },
    saveReview: (input) => {
      history.setReview(input.matchId, { at: Date.now(), grades: input.grades, flags: input.flags });
    },
    importReviews: (inputs) =>
      history.setReviews(inputs.map((i) => ({
        matchId: i.matchId,
        review: { at: Date.now(), grades: i.grades, flags: i.flags },
      }))),
    updateTarget: (input) => {
      manual.updateTarget(input.id, { name: input.name, mode: input.mode, rule: input.rule });
    },
    setTargetActive: (id, active) => manual.setActive(id, active),
    setTargetArchived: (id, archived) => manual.setArchived(id, archived),
    deleteTarget: (id) => manual.removeTarget(id),
    logMatch: (input) => {
      const matchId = `manual-${Date.now()}`;
      recordGame({
        matchId,
        timestamp: Date.now(),
        account: Object.values(config.accounts)[0] ?? 'You',
        role: input.role,
        map: input.map,
        result: input.result,
        gameType: input.gameType,
        heroes: input.hero ? [input.hero] : [],
        mental: input.mental,
      });
      tray.notify('Match logged', `${input.result} · ${input.map}`);
      return { matchId };
    },
    getBreakReminder: () => config.breakReminder,
    setBreakReminder: (input) => {
      config.breakReminder = normalizeBreakReminder(input);
      saveLocalConfig({ breakReminder: config.breakReminder });
      return config.breakReminder;
    },
    listNotionDatabases: () => notion.listDatabases(),
    listNotionPages: () => notion.listPages(),
    selectNotionDatabase: (databaseId) => notion.selectDatabase(databaseId),
    createNotionDatabase: (parentPageId) => notion.createDatabase(parentPageId),
  };

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

  /** Persist a finished match into the analyzable history. */
  function addMatch(record: MatchRecord): void {
    const game = matchToGame(record, config.accounts);
    if (!game || !recordGame(game)) return;
    // Best-effort end-of-match capture (~2s later, while the summary screen is
    // up). Every failure inside is a logged no-op; a manual log never gets here.
    screenshots.capture(game.matchId, (paths) => {
      if (history.addScreenshots(game.matchId, paths)) {
        console.log('[shots]', paths.length, 'screenshot(s) attached to', game.matchId);
      }
    });
  }

  // One entry point for a normalized GEP message — shared by the live feed and
  // dev simulation so both exercise the same pipeline.
  const feed = (msg: GepMessage): void => {
    const record = aggregator.handle(msg);
    if (record) addMatch(record);
  };

  if (config.sensor === 'gep') {
    const gep = new GepService(config.overwatchGameId);
    gep.on('message', feed);
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
    cw.on('match', (record) => addMatch(record));
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
      void runSimulation(feed, (m) => console.log('[sim]', m), { battleTag, map: "King's Row" });
    }, 1500);
  }

  // Testing only: replay a captured recording through the live pipeline.
  const replayFile = process.env.OW_SYNC_REPLAY;
  if (replayFile) {
    setTimeout(() => {
      try {
        const entries = readRecording(replayFile);
        void replayRecording(entries, feed, { realtime: true, log: (m) => console.log('[replay]', m) });
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

import { app, shell } from 'electron';
import * as path from 'path';
import { Client } from '@notionhq/client';
import {
  loadConfig,
  saveLocalConfig,
  getNotionToken,
  setNotionToken,
  userConfigPath,
  type AppConfig,
} from './config';
import { NotionWriter } from '../notion/notionWriter';
import { MapsCache } from '../notion/mapsCache';
import { OutboxStore } from '../store/outbox';
import { SyncService } from './sync';
import { GepService, type GepStatus } from './gep';
import { MatchAggregator } from '../core/matchAggregator';
import { TrayController, type TrayHandlers } from './tray';
import { isAutoLaunchEnabled, setAutoLaunch } from './autolaunch';

// Single instance: a second launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.timoseikel.owgametrackersync');
  // Headless: there are no windows, so don't quit when "all windows" close.
  app.on('window-all-closed', () => {});
  app.whenReady().then(main).catch((err: unknown) => console.error('startup failed', err));
}

function main(): void {
  let config = loadConfig();

  const outbox = new OutboxStore(path.join(app.getPath('userData'), 'data'));
  const aggregator = new MatchAggregator();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  const handlers: TrayHandlers = {
    onTogglePause: (paused) => {
      sync.paused = paused;
      tray.setState({ paused, status: paused ? 'Paused' : statusText(gep.getStatus()) });
    },
    onToggleAutoLaunch: (enabled) => {
      setAutoLaunch(enabled);
      saveLocalConfig({ runAtLogin: enabled });
      tray.setState({ autoLaunch: enabled });
    },
    onImportToken: (token) => {
      setNotionToken(token);
      rebuildNotion();
    },
    onReloadConfig: () => {
      config = loadConfig();
      sync.updateConfig(config);
      rebuildNotion();
      tray.notify('Config reloaded', 'Accounts, map aliases and filter were re-read.');
    },
    onOpenGametracker: () => {
      if (config.notion.gametrackerUrl) void shell.openExternal(config.notion.gametrackerUrl);
    },
    onOpenConfig: () => {
      tray.openConfigFile(userConfigPath(), configTemplate(config));
    },
    onQuit: () => {
      sync.stop();
      tray.destroy();
      app.quit();
    },
  };

  const tray = new TrayController(iconPath, handlers);
  const sync = new SyncService(config, outbox, tray);

  function rebuildNotion(): void {
    const token = getNotionToken();
    if (!token) {
      tray.setState({ tokenSet: false });
      return;
    }
    const client = new Client({ auth: token });
    const writer = new NotionWriter(client, config.notion.gametrackerDatabaseId);
    const maps = new MapsCache(client, config.notion.mapsDatabaseId, config.mapAliases);
    sync.setNotion(writer, maps);
    tray.setState({ tokenSet: true });
    maps.load().catch((err) => tray.notifyError('Maps load failed', String(err)));
  }

  const gep = new GepService(config.overwatchGameId);
  gep.on('message', (msg) => {
    const record = aggregator.handle(msg);
    if (record) void sync.handleRecord(record);
  });
  gep.on('status', (status: GepStatus) => tray.setState({ status: statusText(status) }));
  gep.on('log', (...args: unknown[]) => console.log('[gep]', ...args));

  tray.init({
    status: 'Waiting for Overwatch…',
    paused: false,
    autoLaunch: isAutoLaunchEnabled(),
    tokenSet: Boolean(getNotionToken()),
  });

  rebuildNotion();
  sync.startRetryLoop();
}

function statusText(s: GepStatus): string {
  if (s.lastError) return `Issue: ${s.lastError.slice(0, 60)}`;
  if (s.gameRunning && s.enabled) return 'Overwatch detected — logging';
  return 'Waiting for Overwatch…';
}

function configTemplate(config: AppConfig): string {
  return JSON.stringify(
    {
      logFilter: config.logFilter,
      runAtLogin: config.runAtLogin,
      accounts: config.accounts,
      mapAliases: config.mapAliases,
    },
    null,
    2,
  );
}

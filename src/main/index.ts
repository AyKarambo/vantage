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
import type { GepMessage } from '../core/model';
import { CounterwatchReader } from './counterwatch';
import { TrayController, type TrayHandlers } from './tray';
import { isAutoLaunchEnabled, setAutoLaunch } from './autolaunch';
import { runSimulation } from './simulate';

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
  let liveStatus = 'Starting…';

  const outbox = new OutboxStore(path.join(app.getPath('userData'), 'data'));
  const aggregator = new MatchAggregator();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  const handlers: TrayHandlers = {
    onTogglePause: (paused) => {
      sync.paused = paused;
      tray.setState({ paused, status: paused ? 'Paused' : liveStatus });
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

  // Single entry point for a normalized GEP message — shared by the live feed
  // and dev simulation so both exercise the exact same pipeline.
  const feed = (msg: GepMessage): void => {
    const record = aggregator.handle(msg);
    if (record) void sync.handleRecord(record);
  };

  // Sensor: Counterwatch (read its local DB) by default, or GEP if explicitly chosen.
  // Sensor: Counterwatch (read its local DB) by default, or GEP if explicitly chosen.
  if (config.sensor === 'gep') {
    const gep = new GepService(config.overwatchGameId);
    gep.on('message', feed);
    gep.on('status', (status: GepStatus) => {
      liveStatus = statusText(status);
      tray.setState({ status: liveStatus });
    });
    gep.on('log', (...args: unknown[]) => console.log('[gep]', ...args));
    liveStatus = 'Waiting for Overwatch…';
  } else {
    const cw = new CounterwatchReader();
    cw.on('match', (record) => void sync.handleRecord(record));
    cw.on('log', (...args: unknown[]) => console.log('[cw]', ...args));
    cw.start();
    liveStatus = 'Watching Counterwatch matches';
  }

  tray.init({
    status: liveStatus,
    paused: false,
    autoLaunch: isAutoLaunchEnabled(),
    tokenSet: Boolean(getNotionToken()),
  });

  rebuildNotion();
  sync.startRetryLoop();

  if (process.argv.includes('--simulate') || process.env.OW_SYNC_SIMULATE === '1') {
    const battleTag = Object.keys(config.accounts)[0] ?? 'Karambo#0000';
    tray.setState({ status: 'DEV simulation running…' });
    setTimeout(() => {
      void runSimulation(feed, (m) => console.log('[sim]', m), { battleTag, map: "King's Row" });
    }, 2000);
  }
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

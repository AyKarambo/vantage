import { app, shell } from 'electron';
import * as path from 'path';
import { Client } from '@notionhq/client';
import {
  loadConfig, saveLocalConfig, getNotionToken, setNotionToken, userConfigPath, type AppConfig,
} from './config';
import { NotionWriter } from '../notion/notionWriter';
import { MapsCache } from '../notion/mapsCache';
import { NotionExporter } from '../notion/notionExporter';
import { OutboxStore } from '../store/outbox';
import { HistoryStore } from '../store/history';
import { GepService, type GepStatus } from './gep';
import { MatchAggregator } from '../core/matchAggregator';
import type { GepMessage, MatchRecord } from '../core/model';
import { resolveAccount } from '../core/resolvers/account';
import { resolveRole } from '../core/resolvers/role';
import { resolveResult } from '../core/resolvers/result';
import type { GameRecord } from '../core/analytics';
import { generateSampleGames } from '../core/sampleData';
import { CounterwatchReader } from './counterwatch';
import { DashboardWindow, type DataProvider } from './dashboard';
import { TrayController, type TrayHandlers } from './tray';
import { isAutoLaunchEnabled, setAutoLaunch } from './autolaunch';
import { runSimulation } from './simulate';

// Single instance: a second launch just focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.timoseikel.owgametrackersync');
  app.on('window-all-closed', () => {}); // tray app — keep running with no windows
  app.whenReady().then(main).catch((err: unknown) => console.error('startup failed', err));
}

function main(): void {
  let config = loadConfig();

  const dataDir = path.join(app.getPath('userData'), 'data');
  const outbox = new OutboxStore(dataDir);
  const history = new HistoryStore(dataDir);
  const aggregator = new MatchAggregator();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');

  let exporter: NotionExporter | undefined;

  const dataProvider: DataProvider = {
    games: () => (history.count() ? history.all() : generateSampleGames()),
    isSample: () => history.count() === 0,
    exportToNotion: async (games) =>
      exporter ? exporter.export(games) : { ok: 0, failed: 0, unavailable: true },
  };

  const handlers: TrayHandlers = {
    onOpenDashboard: () => dashboard.open(),
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
      rebuildNotion();
      tray.notify('Config reloaded', 'Accounts and map aliases were re-read.');
    },
    onOpenGametracker: () => {
      if (config.notion.gametrackerUrl) void shell.openExternal(config.notion.gametrackerUrl);
    },
    onOpenConfig: () => tray.openConfigFile(userConfigPath(), configTemplate(config)),
    onQuit: () => {
      tray.destroy();
      app.quit();
    },
  };

  const tray = new TrayController(iconPath, handlers);
  const dashboard = new DashboardWindow(dataProvider, iconPath);

  function rebuildNotion(): void {
    const token = getNotionToken();
    if (!token) {
      exporter = undefined;
      tray.setState({ tokenSet: false });
      return;
    }
    const client = new Client({ auth: token });
    const writer = new NotionWriter(client, config.notion.gametrackerDatabaseId);
    const maps = new MapsCache(client, config.notion.mapsDatabaseId, config.mapAliases);
    exporter = new NotionExporter(writer, maps, outbox);
    tray.setState({ tokenSet: true });
    maps.load().catch((err) => tray.notifyError('Maps load failed', String(err)));
  }

  /** Persist a finished match into the analyzable history. */
  function addMatch(record: MatchRecord): void {
    const game = matchToGame(record, config);
    if (game) history.add(game);
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
  rebuildNotion();
  dashboard.open();

  if (process.argv.includes('--simulate') || process.env.OW_SYNC_SIMULATE === '1') {
    const battleTag = Object.keys(config.accounts)[0] ?? 'Karambo#0000';
    setTimeout(() => {
      void runSimulation(feed, (m) => console.log('[sim]', m), { battleTag, map: "King's Row" });
    }, 1500);
  }
}

/** Convert a raw capture record into an analyzable, resolved game. */
function matchToGame(record: MatchRecord, config: AppConfig): GameRecord | null {
  const result = resolveResult(record.outcome);
  if (!result) return null; // no win/loss → not useful for stats
  const role = resolveRole(record.queueType, record.heroRole) ?? 'openQ';
  const perHero = record.perHero?.length
    ? record.perHero
    : record.heroes.length === 1 && record.eliminations != null
      ? [{
          hero: record.heroes[0], role,
          eliminations: record.eliminations ?? 0, deaths: record.deaths ?? 0, assists: record.assists ?? 0,
          damage: record.damage ?? 0, healing: record.healing ?? 0, mitigation: record.mitigation ?? 0,
        }]
      : undefined;
  return {
    matchId: record.matchId,
    timestamp: record.endedAt ?? Date.now(),
    account: resolveAccount(record.battleTag, config.accounts) ?? record.battleTag ?? 'Unknown',
    role,
    map: record.mapName ?? 'Unknown',
    result,
    gameType: record.gameType ?? 'Unknown',
    durationMinutes: record.durationMinutes,
    heroes: record.heroes,
    perHero,
  };
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

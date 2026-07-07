import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from '../../core/breakReminder';
import { DEFAULT_STALENESS, type StalenessSettings } from '../../core/staleness';
import { DEFAULT_READINESS, type ReadinessSettings } from '../../core/readiness';
import type { DemoPreference } from '../../core/demoPreference';

/**
 * The AppConfig shape and its layered persistence: bundled appsettings.json
 * defaults merged under the user's machine-local overrides. Main-process only
 * (Electron userData paths); the Notion token lives in ./notionToken, both
 * re-exported through ./index.
 */

export interface NotionConfig {
  gametrackerDatabaseId: string;
  mapsDatabaseId: string;
  gametrackerUrl: string;
  /** When the last successful sync finished (epoch ms). */
  lastSyncedAt?: number;
}

export type Sensor = 'counterwatch' | 'gep';

/** Editable-master-data settings: the (configurable) online source for the Update fetch. */
export interface MasterDataConfig {
  /** Base URL of the OverFast-compatible API used by the "Update" action. */
  overfastBaseUrl: string;
}

/** The dashboard window's last-seen placement, restored on launch. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** App-behavior settings owned by the Settings screen. */
export interface UiConfig {
  /** ✕ keeps the app in the tray (true, today's behavior) or quits (false). */
  closeToTray: boolean;
  /** First-run demo-data choice. 'unset' until the user is asked on first run. */
  demoPreference: DemoPreference;
  windowBounds?: WindowBounds;
}

export interface AppConfig {
  overwatchGameId: number;
  runAtLogin: boolean;
  /** Where match data comes from. 'counterwatch' reads Counterwatch's local DB. */
  sensor: Sensor;
  notion: NotionConfig;
  /** BattleTag → Notion Account select value. */
  accounts: Record<string, string>;
  /** GEP map name → Notion Maps page Name. */
  mapAliases: Record<string, string>;
  /** "Time for a break?" tray notification after N consecutive losses. */
  breakReminder: BreakReminderSettings;
  /** Active-target staleness thresholds (days / matches) for the rotation cue. */
  staleness: StalenessSettings;
  /** Readiness / training-load coach settings (feature toggle + opt-in launch toast). */
  readiness: ReadinessSettings;
  /** Editable-master-data source config (the Update action's endpoint). */
  masterData: MasterDataConfig;
  /**
   * Folder holding all Vantage data files (SQLite match history, manual log,
   * outbox ledger, rank anchors, screenshots). Absent ⇒ the default
   * `<userData>/data`. Point it at a cloud-synced folder (OneDrive/Dropbox) for
   * off-machine backup. Single-machine use only — simultaneous multi-machine
   * access to the synced files can corrupt SQLite.
   *
   * Renamed from `historyDbFolder` (which only ever moved the DB). A config
   * still carrying the legacy key is honored on read via {@link loadConfig}
   * and rewritten under `dataFolder` on next persist.
   */
  dataFolder?: string;
  /** @deprecated legacy alias for {@link dataFolder}; read-only back-compat. */
  historyDbFolder?: string;
  ui: UiConfig;
}

const DEFAULTS: AppConfig = {
  overwatchGameId: 10844, // kGepSupportedGameIds.Overwatch (Overwatch 2)
  runAtLogin: false,
  sensor: 'counterwatch',
  notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' },
  accounts: {},
  mapAliases: {},
  breakReminder: { ...DEFAULT_BREAK_REMINDER },
  staleness: { ...DEFAULT_STALENESS },
  readiness: { ...DEFAULT_READINESS },
  masterData: { overfastBaseUrl: 'https://overfast-api.tekrop.fr' },
  ui: { closeToTray: true, demoPreference: 'unset' },
};

/** Per-user, machine-local files (survive app updates, never committed). */
export function userConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.local.json');
}

/** Bundled, version-controlled defaults shipped next to the app. */
function appSettingsPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'appsettings.json'),
    path.join(process.cwd(), 'appsettings.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function readJson<T>(file: string): Partial<T> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<T>;
  } catch {
    return {};
  }
}

/** Merge bundled defaults ← appsettings.json ← user local overrides. */
export function loadConfig(): AppConfig {
  const bundled = readJson<AppConfig>(appSettingsPath());
  const local = readJson<AppConfig>(userConfigPath());
  const merged: AppConfig = {
    ...DEFAULTS,
    ...stripHelp(bundled),
    ...stripHelp(local),
    notion: { ...DEFAULTS.notion, ...(bundled.notion ?? {}), ...(local.notion ?? {}) },
    accounts: { ...(bundled.accounts ?? {}), ...(local.accounts ?? {}) },
    mapAliases: { ...(bundled.mapAliases ?? {}), ...(local.mapAliases ?? {}) },
    breakReminder: { ...DEFAULTS.breakReminder, ...(bundled.breakReminder ?? {}), ...(local.breakReminder ?? {}) },
    staleness: { ...DEFAULTS.staleness, ...(bundled.staleness ?? {}), ...(local.staleness ?? {}) },
    readiness: { ...DEFAULTS.readiness, ...(bundled.readiness ?? {}), ...(local.readiness ?? {}) },
    masterData: { ...DEFAULTS.masterData, ...(bundled.masterData ?? {}), ...(local.masterData ?? {}) },
    ui: { ...DEFAULTS.ui, ...(bundled.ui ?? {}), ...(local.ui ?? {}) },
  };
  // `dataFolder` (new key) falls back to the legacy `historyDbFolder` (old key)
  // when absent, so a config written before the rename is still honored.
  // Persisting always writes `dataFolder` going forward (see saveLocalConfig
  // callers), so this fallback only ever fires for untouched legacy configs.
  if (merged.dataFolder === undefined && merged.historyDbFolder !== undefined) {
    merged.dataFolder = merged.historyDbFolder;
  }
  // Env overrides (handy for one-off testing without editing files).
  if (process.env.OW_SYNC_SENSOR) merged.sensor = process.env.OW_SYNC_SENSOR as Sensor;
  return merged;
}

/** Persist a partial override into the user's local config file. */
export function saveLocalConfig(patch: Partial<AppConfig>): void {
  const current = readJson<AppConfig>(userConfigPath());
  const merged = { ...current, ...patch };
  fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/**
 * Deep-merge a partial `notion` patch into the local config file. Plain
 * `saveLocalConfig` shallow-merges top-level keys, which would clobber
 * sibling `notion` fields (e.g. saving `gametrackerDatabaseId` would wipe out
 * an already-stored `mapsDatabaseId`) — this merges one level deeper instead.
 */
export function saveLocalNotionConfig(patch: Partial<NotionConfig>): void {
  const current = readJson<AppConfig>(userConfigPath());
  const merged: Partial<AppConfig> = {
    ...current,
    notion: { ...DEFAULTS.notion, ...(current.notion ?? {}), ...patch },
  };
  fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/**
 * Persist the full `accounts` map (battleTag → label) into the user's local
 * config file. Replaces the map wholesale — the in-app account manager owns the
 * complete list, so create/edit/delete each write the resolved map.
 */
export function saveLocalAccounts(accounts: Record<string, string>): void {
  const current = readJson<AppConfig>(userConfigPath());
  const merged: Partial<AppConfig> = { ...current, accounts };
  fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/** Persist the readiness feature settings into the user's local config file. */
export function saveLocalReadiness(settings: ReadinessSettings): void {
  const current = readJson<AppConfig>(userConfigPath());
  const merged: Partial<AppConfig> = { ...current, readiness: settings };
  fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/** Deep-merge a partial `ui` patch (same clobber-avoidance as the notion helper). */
export function saveLocalUiConfig(patch: Partial<UiConfig>): void {
  const current = readJson<AppConfig>(userConfigPath());
  const merged: Partial<AppConfig> = {
    ...current,
    ui: { ...DEFAULTS.ui, ...(current.ui ?? {}), ...patch },
  };
  fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/**
 * Where the effective `gametrackerDatabaseId` came from: explicitly selected
 * by the user (stored in the local override file), falling back to a
 * hand-edited `appsettings.json` value, or configured nowhere at all.
 */
export function notionDatabaseSource(): 'selected' | 'appsettings' | 'none' {
  const local = readJson<AppConfig>(userConfigPath());
  if (local.notion?.gametrackerDatabaseId) return 'selected';
  const merged = loadConfig();
  if (merged.notion.gametrackerDatabaseId) return 'appsettings';
  return 'none';
}

/** Drop the `_*Help` annotation keys used in appsettings.json. */
function stripHelp<T extends Record<string, unknown>>(obj: T): T {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) clone[k] = v;
  return clone as T;
}

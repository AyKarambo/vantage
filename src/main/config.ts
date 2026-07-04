import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { LogFilter } from '../core/model';
import { DEFAULT_BREAK_REMINDER, type BreakReminderSettings } from '../core/breakReminder';

export interface NotionConfig {
  gametrackerDatabaseId: string;
  mapsDatabaseId: string;
  gametrackerUrl: string;
}

export type Sensor = 'counterwatch' | 'gep';

export interface AppConfig {
  overwatchGameId: number;
  logFilter: LogFilter;
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
}

const DEFAULTS: AppConfig = {
  overwatchGameId: 10844, // kGepSupportedGameIds.Overwatch (Overwatch 2)
  logFilter: 'Competitive',
  runAtLogin: false,
  sensor: 'counterwatch',
  notion: { gametrackerDatabaseId: '', mapsDatabaseId: '', gametrackerUrl: '' },
  accounts: {},
  mapAliases: {},
  breakReminder: { ...DEFAULT_BREAK_REMINDER },
};

/** Per-user, machine-local files (survive app updates, never committed). */
export function userConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.local.json');
}
function tokenPath(): string {
  return path.join(app.getPath('userData'), 'notion-token.bin');
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
  };
  // Env overrides (handy for one-off testing without editing files).
  if (process.env.OW_SYNC_FILTER) merged.logFilter = process.env.OW_SYNC_FILTER as LogFilter;
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

// --- Notion token (encrypted at rest) ----------------------------------------

export function getNotionToken(): string | undefined {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  try {
    const buf = fs.readFileSync(tokenPath());
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

export function setNotionToken(token: string): void {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8');
  fs.writeFileSync(tokenPath(), data);
}

export function clearNotionToken(): void {
  try {
    fs.rmSync(tokenPath(), { force: true });
  } catch {
    /* already gone */
  }
}

/** Drop the `_*Help` annotation keys used in appsettings.json. */
function stripHelp<T extends Record<string, unknown>>(obj: T): T {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) clone[k] = v;
  return clone as T;
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The bundled appsettings.json ships as a merge layer under the user's local
 * config, so any account it defines re-appears on every load and can never be
 * removed from the account manager. It must therefore ship NO placeholder
 * account — otherwise users get an undeletable "YourName" phantom.
 */
describe('bundled appsettings.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'appsettings.json'), 'utf8'));

  it('ships no default accounts (a bundled account is undeletable from the UI)', () => {
    expect(cfg.accounts).toEqual({});
  });

  it('leaves the Notion database ids empty (configured per user)', () => {
    expect(cfg.notion.gametrackerDatabaseId).toBe('');
  });

  it('no longer ships the dead logFilter capture-filter key', () => {
    expect(cfg.logFilter).toBeUndefined();
  });
});

/**
 * `loadConfig` merges bundled appsettings.json under the user's local
 * config.local.json. These tests point both files at a temp userData dir
 * (via a mocked `electron.app`) so `dataFolder`/legacy `historyDbFolder`
 * resolution and the removed `logFilter` key can be exercised without
 * touching the real user config.
 */
describe('loadConfig — dataFolder rename + logFilter removal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-appconfig-'));
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        getPath: () => tmpDir,
        getAppPath: () => process.cwd(),
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('electron');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function userConfigFile(): string {
    return path.join(tmpDir, 'config.local.json');
  }

  it('round-trips dataFolder written under the new key', async () => {
    fs.writeFileSync(userConfigFile(), JSON.stringify({ dataFolder: 'D:/sync/vantage-data' }), 'utf8');
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().dataFolder).toBe('D:/sync/vantage-data');
  });

  it('adopts a legacy historyDbFolder-only config as dataFolder', async () => {
    fs.writeFileSync(userConfigFile(), JSON.stringify({ historyDbFolder: 'D:/old/history' }), 'utf8');
    const { loadConfig } = await import('../src/main/config/appConfig');
    const cfg = loadConfig();
    expect(cfg.dataFolder).toBe('D:/old/history');
    expect(cfg.historyDbFolder).toBe('D:/old/history');
  });

  it('prefers dataFolder over a stale historyDbFolder when both are present', async () => {
    fs.writeFileSync(
      userConfigFile(),
      JSON.stringify({ dataFolder: 'D:/new/data', historyDbFolder: 'D:/old/history' }),
      'utf8',
    );
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().dataFolder).toBe('D:/new/data');
  });

  it('loads a config still carrying the removed logFilter key without error, and does not act on it', async () => {
    fs.writeFileSync(
      userConfigFile(),
      JSON.stringify({ logFilter: 'Everything', dataFolder: 'D:/sync/vantage-data' }),
      'utf8',
    );
    const { loadConfig } = await import('../src/main/config/appConfig');
    // Loads without throwing. `logFilter` is no longer part of the AppConfig
    // type — it may still ride along as a stray untyped key on the merged
    // object (stripHelp only drops `_`-prefixed help keys), but nothing in
    // AppConfig reads or acts on it: dataFolder resolves normally alongside it.
    const cfg = loadConfig();
    expect(cfg.dataFolder).toBe('D:/sync/vantage-data');
  });

  it('defaults GEP notifications on (no local override)', async () => {
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().ui.gepNotifications).toBe(true);
  });

  it('round-trips a ui.gepNotifications=false local override', async () => {
    fs.writeFileSync(userConfigFile(), JSON.stringify({ ui: { gepNotifications: false } }), 'utf8');
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().ui.gepNotifications).toBe(false);
  });

  it('no longer honors the OW_SYNC_FILTER env override', async () => {
    const prev = process.env.OW_SYNC_FILTER;
    process.env.OW_SYNC_FILTER = 'Everything';
    try {
      const { loadConfig } = await import('../src/main/config/appConfig');
      // The env override branch is deleted; loading still succeeds and other
      // settings (e.g. sensor, still env-overridable) are unaffected by it.
      expect(() => loadConfig()).not.toThrow();
      expect(loadConfig().sensor).toBe('gep'); // from the bundled appsettings.json
    } finally {
      if (prev === undefined) delete process.env.OW_SYNC_FILTER;
      else process.env.OW_SYNC_FILTER = prev;
    }
  });
});

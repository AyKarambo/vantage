import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The MCP endpoint is opt-in (spec #174, AC 16). "Default off" is a security
 * property, not a preference default: the named pipe it opens is reachable by
 * any process running as this user, so a config that has never mentioned
 * `mcpEnabled` must resolve to `false` — never to a truthy fallback, and never
 * flipped on by a partial `ui` block written for some other setting.
 */
describe('mcpEnabled setting', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-mcp-setting-'));
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

  it('defaults to false when no config has ever set it', async () => {
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().ui.mcpEnabled).toBe(false);
  });

  it('stays false when the user config writes an unrelated ui setting', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.local.json'),
      JSON.stringify({ ui: { closeToTray: false } }),
    );
    const { loadConfig } = await import('../src/main/config/appConfig');
    const ui = loadConfig().ui;
    expect(ui.closeToTray).toBe(false);
    expect(ui.mcpEnabled).toBe(false);
  });

  it('round-trips an explicit opt-in', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.local.json'),
      JSON.stringify({ ui: { mcpEnabled: true } }),
    );
    const { loadConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().ui.mcpEnabled).toBe(true);
  });

  it('persists a toggle through saveLocalUiConfig', async () => {
    const { loadConfig, saveLocalUiConfig } = await import('../src/main/config/appConfig');
    expect(loadConfig().ui.mcpEnabled).toBe(false);
    saveLocalUiConfig({ mcpEnabled: true });
    expect(loadConfig().ui.mcpEnabled).toBe(true);
    saveLocalUiConfig({ mcpEnabled: false });
    expect(loadConfig().ui.mcpEnabled).toBe(false);
  });
});

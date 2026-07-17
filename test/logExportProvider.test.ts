import { describe, it, expect, vi } from 'vitest';
import { createDataProvider, type DataProviderDeps } from '../src/main/dataProvider';
import type { AppInfo } from '../src/shared/contract';
import type { LogEntry } from '../src/core/logging';

/**
 * `exportLogBundle` DI tests, mirroring `gradingProvider.test.ts` /
 * `importFileProvider.test.ts`'s fake-deps pattern — no Electron involved.
 *
 * The safety-property fixture below is built the same way
 * `logRedaction.test.ts` builds its roster fixture: one `roster_N` JSON
 * payload per player, in the exact shape `main/gep.ts`'s `dispatch()` logs it
 * (see that module's doc), so the test proves the actual export path — not
 * just `redactForExport` in isolation.
 */

const ROSTER_TAGS = [
  'Karambo#1234', 'Ashbrnger#22224', 'Widow99#3005', 'MercyMain#4471',
  'Genjii#5590', 'Lucio22#6103', 'ZenMaster#7788', 'Reinhardt#8899',
  'Tracer01#9012', 'Kiriko7#14501', 'Sombra#2764', 'Baptiste#3391',
];

// Rotates through the real GEP roster key aliases `matchAggregator/gepValues.ts`'s
// parseRoster() reads.
const NAME_KEY_ROTATION = ['battle_tag', 'battlenet_tag', 'player_name', 'name'];

function rosterPayload(i: number): Record<string, unknown> {
  const key = NAME_KEY_ROTATION[i % NAME_KEY_ROTATION.length];
  return {
    [key]: ROSTER_TAGS[i],
    hero_name: ['TRACER', 'MERCY', 'WIDOWMAKER', 'REINHARDT'][i % 4],
    hero_role: ['damage', 'support', 'tank'][i % 3],
    team: i < 6 ? 0 : 1,
    is_local: i === 0,
    kills: 10 + i,
  };
}

/** A 12-player roster dispatch ring exactly as `gep.ts`'s dispatch() would log it. */
function rosterEntries(): LogEntry[] {
  return Array.from({ length: 12 }, (_, i) => ({
    ts: Date.UTC(2026, 6, 17, 12, 0, i),
    level: 'info' as const,
    scope: 'gep',
    message: `gep info: roster.roster_${i} = ${JSON.stringify(rosterPayload(i))}`,
  }));
}

function fakeAppInfo(): AppInfo {
  return {
    version: '1.2.3',
    supportEmail: 'timo.seikel@gmail.com',
    electron: 'e', chromium: 'c', node: 'n', v8: 'v8',
    platform: 'win32', osRelease: 'os', packaged: false, devMode: false, gepPackageVersion: 'g',
  };
}

function harness(opts: {
  entries?: LogEntry[];
  getSecrets?: () => string[];
  saveTextFile?: (defaultName: string, contents: string) => Promise<string | undefined>;
} = {}) {
  const saveTextFile = opts.saveTextFile ?? vi.fn(async () => 'C:\\chosen\\vantage-log.txt');
  const deps = {
    logger: { entries: () => opts.entries ?? rosterEntries() },
    getSecrets: opts.getSecrets ?? (() => []),
    appInfo: fakeAppInfo,
    saveTextFile,
  } as unknown as DataProviderDeps;
  return { provider: createDataProvider(deps), saveTextFile };
}

describe('exportLogBundle — safety property (roster_N GEP dispatch fixture)', () => {
  it('writes a bundle containing no BattleTag/username/token from a realistic 12-player ring', async () => {
    let captured = '';
    const saveTextFile = vi.fn(async (_name: string, contents: string) => {
      captured = contents;
      return 'C:\\out\\vantage-log-1.2.3.txt';
    });
    const { provider } = harness({ saveTextFile });

    const res = await provider.exportLogBundle();

    expect(res).toEqual({ path: 'C:\\out\\vantage-log-1.2.3.txt' });
    expect(captured).not.toMatch(/#\d{4,}/);
    for (const tag of ROSTER_TAGS) {
      expect(captured).not.toContain(tag);
      expect(captured).not.toContain(tag.split('#')[0]);
    }
    // Non-PII fields survive — the export stays useful for debugging.
    expect(captured).toContain('hero_name');
    expect(captured).toContain('TRACER');
    expect(captured).toContain('is_local');
    // The header names the scrub honestly (best-effort, review before sharing).
    expect(captured.toLowerCase()).toContain('removed before export');
    expect(captured.toLowerCase()).toContain('review');
  });

  it('strips the registered Notion token too', async () => {
    let captured = '';
    const secret = 'secret_myNotionToken12345';
    const saveTextFile = vi.fn(async (_name: string, contents: string) => {
      captured = contents;
      return '/tmp/log.txt';
    });
    const entries: LogEntry[] = [
      { ts: Date.now(), level: 'info', scope: 'notion', message: `sync using ${secret} ok` },
    ];
    const { provider } = harness({ entries, getSecrets: () => [secret], saveTextFile });

    await provider.exportLogBundle();

    expect(captured).not.toContain(secret);
    expect(captured).toContain('***');
  });
});

describe('exportLogBundle — save-dialog outcomes', () => {
  it('the user cancelling resolves { cancelled: true } (no separate write path to skip)', async () => {
    const saveTextFile = vi.fn(async () => undefined);
    const { provider } = harness({ saveTextFile });

    const res = await provider.exportLogBundle();

    expect(res).toEqual({ cancelled: true });
    expect(saveTextFile).toHaveBeenCalledTimes(1);
  });

  it('a successful save returns the chosen path', async () => {
    const saveTextFile = vi.fn(async () => '/home/user/Documents/vantage-log.txt');
    const { provider } = harness({ saveTextFile });

    const res = await provider.exportLogBundle();

    expect(res).toEqual({ path: '/home/user/Documents/vantage-log.txt' });
  });

  it('suggests a default filename derived from the app version', async () => {
    const saveTextFile = vi.fn(async () => '/x/log.txt');
    const { provider } = harness({ saveTextFile });

    await provider.exportLogBundle();

    expect(saveTextFile).toHaveBeenCalledWith('vantage-log-1.2.3.txt', expect.any(String));
  });
});

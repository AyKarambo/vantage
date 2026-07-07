import { describe, it, expect } from 'vitest';
import type { AppInfo } from '../src/shared/contract';
import { buildAboutRows, formatDiagnostics } from '../src/core/about';

const INFO: AppInfo = {
  version: '0.1.0',
  supportEmail: 'a@b.com',
  electron: '39.6.1',
  chromium: '130.0.6723.44',
  node: '20.18.0',
  v8: '13.0.245.25',
  platform: 'win32',
  osRelease: '10.0.26200',
  packaged: true,
};

describe('buildAboutRows', () => {
  it('lists version first and covers every build field in order', () => {
    const rows = buildAboutRows(INFO);
    expect(rows[0]).toEqual({ label: 'Version', value: '0.1.0' });
    expect(rows.map((r) => r.label)).toEqual([
      'Version', 'Build', 'Electron', 'Chromium', 'Node', 'V8', 'Platform', 'OS',
    ]);
    expect(rows.find((r) => r.label === 'Electron')?.value).toBe('39.6.1');
    expect(rows.find((r) => r.label === 'OS')?.value).toBe('10.0.26200');
  });

  it('maps packaged → Installed and dev → Dev build', () => {
    expect(buildAboutRows(INFO).find((r) => r.label === 'Build')?.value).toBe('Installed');
    expect(buildAboutRows({ ...INFO, packaged: false }).find((r) => r.label === 'Build')?.value).toBe('Dev build');
  });
});

describe('formatDiagnostics', () => {
  it('is deterministic', () => {
    expect(formatDiagnostics(INFO)).toBe(formatDiagnostics(INFO));
  });

  it('leads with the product/version header and contains every build fact', () => {
    const text = formatDiagnostics(INFO);
    expect(text.split('\n')[0]).toBe('Vantage 0.1.0');
    for (const v of ['39.6.1', '130.0.6723.44', '20.18.0', '13.0.245.25', 'win32', '10.0.26200', 'Installed']) {
      expect(text).toContain(v);
    }
  });
});

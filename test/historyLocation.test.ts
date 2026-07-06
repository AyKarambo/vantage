import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveDataDir, resolveHistoryDir } from '../src/store/historyLocation';

describe('resolveDataDir', () => {
  const def = path.resolve('data', 'default');

  it('falls back to the default when no folder is configured', () => {
    expect(resolveDataDir(undefined, def)).toBe(def);
    expect(resolveDataDir('', def)).toBe(def);
    expect(resolveDataDir('   ', def)).toBe(def);
  });

  it('uses the configured folder, resolved to an absolute path and trimmed', () => {
    const custom = path.resolve('some', 'sync', 'folder');
    expect(resolveDataDir(custom, def)).toBe(custom);
    expect(resolveDataDir(`  ${custom}  `, def)).toBe(custom);
  });

  it('keeps a resolveHistoryDir alias for back-compat callers', () => {
    expect(resolveHistoryDir).toBe(resolveDataDir);
    const custom = path.resolve('some', 'sync', 'folder');
    expect(resolveHistoryDir(custom, def)).toBe(custom);
  });
});

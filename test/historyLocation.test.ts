import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveHistoryDir } from '../src/store/historyLocation';

describe('resolveHistoryDir', () => {
  const def = path.resolve('data', 'default');

  it('falls back to the default when no folder is configured', () => {
    expect(resolveHistoryDir(undefined, def)).toBe(def);
    expect(resolveHistoryDir('', def)).toBe(def);
    expect(resolveHistoryDir('   ', def)).toBe(def);
  });

  it('uses the configured folder, resolved to an absolute path and trimmed', () => {
    const custom = path.resolve('some', 'sync', 'folder');
    expect(resolveHistoryDir(custom, def)).toBe(custom);
    expect(resolveHistoryDir(`  ${custom}  `, def)).toBe(custom);
  });
});

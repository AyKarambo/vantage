import * as path from 'path';

/**
 * Resolve the effective directory for the history database. A configured folder
 * (trimmed, resolved to an absolute path) wins; a blank/whitespace value falls
 * back to the default `<userData>/data`. Pure and Electron-free so the composition
 * root's location logic is unit-testable.
 */
export function resolveHistoryDir(configuredFolder: string | undefined, defaultDir: string): string {
  const trimmed = configuredFolder?.trim();
  return trimmed ? path.resolve(trimmed) : defaultDir;
}

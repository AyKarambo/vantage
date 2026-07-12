import * as path from 'path';

/**
 * Resolve the effective Vantage data directory (history database plus every
 * other store — manual targets, the Notion outbox ledger, rank anchors).
 * A configured folder (trimmed, resolved to an absolute path)
 * wins; a blank/whitespace value falls back to the default `<userData>/data`.
 * Pure and Electron-free so the composition root's location logic is
 * unit-testable.
 */
export function resolveDataDir(configuredFolder: string | undefined, defaultDir: string): string {
  const trimmed = configuredFolder?.trim();
  return trimmed ? path.resolve(trimmed) : defaultDir;
}

/**
 * @deprecated Back-compat alias for {@link resolveDataDir} — the folder now
 * holds every data file, not just the history database. Kept until Wave 2
 * migrates `src/main/index.ts` off the old name.
 */
export const resolveHistoryDir = resolveDataDir;

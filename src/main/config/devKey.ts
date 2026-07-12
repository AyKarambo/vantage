import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The Overwolf dev key at rest for ow-electron Dev Mode. Stored as **plaintext**
 * at `~/.ow-cli/dev-key` — the exact location `scripts/ow-dev.mjs` reads and
 * owepm needs at process start, before Electron/`safeStorage` exists. A
 * deliberate departure from the app's usual `userData` writes (the launcher, not
 * the app, consumes this): machine-local, never committed (guardrail #2), never
 * placed in `config.local.json`.
 *
 * Electron-free (fs/os/path only) so it unit-tests directly; the `home` override
 * is the testability seam — production callers omit it and get `os.homedir()`.
 */

/** The dev-key file path (`~/.ow-cli/dev-key`); override `home` in tests. */
export function devKeyPath(home: string = os.homedir()): string {
  return path.join(home, '.ow-cli', 'dev-key');
}

/** True when a non-empty dev key is stored. */
export function hasDevKey(home?: string): boolean {
  try {
    return fs.readFileSync(devKeyPath(home), 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Write the (trimmed) dev key to `~/.ow-cli/dev-key`, creating the directory if
 * needed. An empty/whitespace key clears the file instead.
 */
export function setDevKey(key: string, home?: string): void {
  const token = key.trim();
  if (!token) {
    clearDevKey(home);
    return;
  }
  const file = devKeyPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, 'utf8');
}

/** Delete the stored dev-key file (idempotent). */
export function clearDevKey(home?: string): void {
  try {
    fs.rmSync(devKeyPath(home), { force: true });
  } catch {
    /* already gone */
  }
}

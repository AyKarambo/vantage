import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Notion integration token at rest — encrypted via Electron safeStorage
 * when available, isolated here so the encryption concern stays out of plain
 * config I/O. Machine-local only: the token never enters git or leaves the
 * device (guardrails #2/#5).
 */

function tokenPath(): string {
  return path.join(app.getPath('userData'), 'notion-token.bin');
}

// --- Notion token (encrypted at rest) ----------------------------------------

/** Read the saved token (NOTION_TOKEN env wins, for dev); undefined when absent. */
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

/** Save the token, encrypted when the OS keychain backing is available. */
export function setNotionToken(token: string): void {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8');
  fs.writeFileSync(tokenPath(), data);
}

/** Delete the saved token file (idempotent). */
export function clearNotionToken(): void {
  try {
    fs.rmSync(tokenPath(), { force: true });
  } catch {
    /* already gone */
  }
}

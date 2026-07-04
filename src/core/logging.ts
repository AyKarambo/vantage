/**
 * The pure log model behind the always-on release log: levels, the entry
 * shape, the stable line format, secret redaction, and the bounded ring the
 * in-app viewer reads. Pure and Electron-free like the rest of `core/` — the
 * main process owns the file I/O in `main/logger.ts`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** True when `level` is at or above the configured minimum. */
export function levelAdmits(min: LogLevel, level: LogLevel): boolean {
  return RANK[level] >= RANK[min];
}

export interface LogEntry {
  ts: number;
  level: LogLevel;
  /** Subsystem tag: 'gep' | 'pipeline' | 'notion' | 'status' | 'main' | 'renderer' | … */
  scope: string;
  message: string;
  fields?: Record<string, string | number | boolean>;
}

/** How many entries the in-memory ring (the viewer's source) retains. */
export const LOG_RING_CAP = 1000;

/** Append to a bounded ring, evicting oldest-first past the cap. */
export function pushRing<T>(ring: T[], item: T, cap: number = LOG_RING_CAP): void {
  ring.push(item);
  if (ring.length > cap) ring.splice(0, ring.length - cap);
}

/**
 * One entry → one stable, grep-friendly line:
 * `2026-07-04T18:22:01.123Z info  gep attached game=10844`
 * (ISO timestamp, level padded to 5, scope, message, `key=value` fields).
 * Newlines never survive into the file — multi-line values are escaped.
 */
export function formatLogLine(e: LogEntry): string {
  const ts = new Date(e.ts).toISOString();
  const level = e.level.padEnd(5);
  const fields = e.fields
    ? ' ' + Object.entries(e.fields).map(([k, v]) => `${k}=${escapeNewlines(String(v))}`).join(' ')
    : '';
  return `${ts} ${level} ${e.scope} ${escapeNewlines(e.message)}${fields}`;
}

function escapeNewlines(s: string): string {
  return s.replace(/\r?\n/g, '\\n');
}

/**
 * Known credential shapes that must never appear even when no live secret is
 * registered (Notion internal-integration tokens).
 */
const TOKEN_PATTERNS: readonly RegExp[] = [/secret_[A-Za-z0-9]+/g, /ntn_[A-Za-z0-9]+/g];

const REDACTED = '***';

/**
 * Strip every registered secret (and anything credential-shaped) from a
 * string. Secrets shorter than 4 chars are ignored — replacing them would
 * mangle ordinary text without protecting anything real.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/** Redact an entry's message and field values; the shape is preserved. */
export function redactEntry(e: LogEntry, secrets: readonly string[] = []): LogEntry {
  const fields = e.fields
    ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [
        k,
        typeof v === 'string' ? redactSecrets(v, secrets) : v,
      ]))
    : undefined;
  return { ...e, message: redactSecrets(e.message, secrets), ...(fields ? { fields } : {}) };
}

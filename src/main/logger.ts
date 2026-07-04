/**
 * The always-on release logger: size-capped rotating files under
 * `userData/logs/`, an in-memory ring for the in-app viewer, and an onEntry
 * hook the composition root wires to the dashboard push channel. Formatting,
 * redaction and level rules live in `core/logging` (pure, tested); this module
 * only moves bytes.
 *
 * Failure-proof by contract: any file-system error flips the logger into a
 * degraded mode where disk writes stop but the ring and push keep working —
 * logging must never crash or block the app.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  formatLogLine, levelAdmits, pushRing, redactEntry,
  type LogEntry, type LogLevel,
} from '../core/logging';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 5;
export const LOG_FILE = 'vantage.log';

/** The slice of `fs` the logger uses, injectable so tests run on a fake. */
export interface LoggerFs {
  mkdir(dir: string): void;
  /** Append one line (async ok); report failures through onError, don't throw across ticks. */
  appendLine(file: string, line: string, onError: (err: unknown) => void): void;
  /** Byte size of a file; 0 when it does not exist. */
  fileSize(file: string): number;
  rename(from: string, to: string): void;
  /** Remove a file; missing files are not an error. */
  remove(file: string): void;
}

const realFs: LoggerFs = {
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  appendLine: (file, line, onError) =>
    fs.appendFile(file, line + '\n', (err) => { if (err) onError(err); }),
  fileSize: (file) => {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  },
  rename: (from, to) => fs.renameSync(from, to),
  remove: (file) => fs.rmSync(file, { force: true }),
};

export interface LoggerOptions {
  /** Directory the log files live in (created if missing). */
  dir: string;
  maxFileBytes?: number;
  maxFiles?: number;
  /** Minimum level written; session-scoped (never persisted). */
  level?: LogLevel;
  /** Live secrets (e.g. the Notion token) — redacted from every entry. */
  getSecrets?: () => string[];
  /** Fires for every accepted (redacted) entry — the dashboard push hook. */
  onEntry?: (e: LogEntry) => void;
  /** Echo lines to the console (dev runs). */
  mirrorToConsole?: boolean;
  fsImpl?: LoggerFs;
}

export class Logger {
  private readonly dir: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly fsImpl: LoggerFs;
  private readonly opts: LoggerOptions;
  private readonly ring: LogEntry[] = [];
  private level: LogLevel;
  private degraded = false;
  /** Tracked in memory so the hot path never stats the file. */
  private approxBytes = 0;

  constructor(opts: LoggerOptions) {
    this.opts = opts;
    this.dir = opts.dir;
    this.maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES;
    this.maxFiles = opts.maxFiles ?? MAX_FILES;
    this.level = opts.level ?? 'info';
    this.fsImpl = opts.fsImpl ?? realFs;
    try {
      this.fsImpl.mkdir(this.dir);
      this.approxBytes = this.fsImpl.fileSize(this.currentFile());
    } catch {
      this.degraded = true;
    }
  }

  log(level: LogLevel, scope: string, message: string, fields?: LogEntry['fields']): void {
    if (!levelAdmits(this.level, level)) return;
    const entry = redactEntry(
      { ts: Date.now(), level, scope, message, ...(fields ? { fields } : {}) },
      this.secrets(),
    );
    pushRing(this.ring, entry);
    try {
      this.opts.onEntry?.(entry);
    } catch {
      /* a broken push listener must not take logging down */
    }
    const line = formatLogLine(entry);
    if (this.opts.mirrorToConsole) console.log(line);
    this.write(line);
  }

  debug(scope: string, message: string, fields?: LogEntry['fields']): void { this.log('debug', scope, message, fields); }
  info(scope: string, message: string, fields?: LogEntry['fields']): void { this.log('info', scope, message, fields); }
  warn(scope: string, message: string, fields?: LogEntry['fields']): void { this.log('warn', scope, message, fields); }
  error(scope: string, message: string, fields?: LogEntry['fields']): void { this.log('error', scope, message, fields); }

  /** A `(...args) => void` adapter for deps that expect a console.log-shaped sink. */
  adapter(scope: string, level: LogLevel = 'info'): (...args: unknown[]) => void {
    return (...args) => this.log(level, scope, args.map(stringify).join(' '));
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  /** Snapshot of the in-memory ring, oldest first — the viewer's data source. */
  entries(): LogEntry[] {
    return [...this.ring];
  }

  private secrets(): string[] {
    try {
      return this.opts.getSecrets?.() ?? [];
    } catch {
      return [];
    }
  }

  private currentFile(): string {
    return path.join(this.dir, LOG_FILE);
  }

  private numberedFile(n: number): string {
    return path.join(this.dir, `vantage.${n}.log`);
  }

  private write(line: string): void {
    if (this.degraded) return;
    try {
      this.rotateIfNeeded();
      this.fsImpl.appendLine(this.currentFile(), line, () => (this.degraded = true));
      this.approxBytes += Buffer.byteLength(line) + 1;
    } catch {
      this.degraded = true;
    }
  }

  /** Cascade: delete the oldest, shift the rest up, move current to `.1`. */
  private rotateIfNeeded(): void {
    if (this.approxBytes < this.maxFileBytes) return;
    this.fsImpl.remove(this.numberedFile(this.maxFiles - 1));
    for (let i = this.maxFiles - 2; i >= 1; i--) {
      if (this.fsImpl.fileSize(this.numberedFile(i)) > 0) {
        this.fsImpl.rename(this.numberedFile(i), this.numberedFile(i + 1));
      }
    }
    if (this.fsImpl.fileSize(this.currentFile()) > 0) {
      this.fsImpl.rename(this.currentFile(), this.numberedFile(1));
    }
    this.approxBytes = 0;
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  return new Logger(opts);
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

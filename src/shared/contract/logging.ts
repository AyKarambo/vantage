/**
 * Logging payloads crossing the bridge: the viewer reads the main process's
 * entry ring and level, and the renderer forwards its own uncaught errors so
 * release-build problems land in the same log file.
 */
export type { LogEntry, LogLevel } from '../../core/logging';

/** An uncaught renderer error, forwarded to the main-process log. */
export interface RendererErrorInput {
  message: string;
  stack?: string;
  /** Where it happened (file:line or 'unhandledrejection'). */
  source?: string;
}

/**
 * Outcome of `exportLogBundle`: the path the user saved to, their cancel, or a
 * failure to write.
 *
 * The `error` case is not decoration. The user is told the log was saved so they
 * can attach it to a bug report — if the write actually failed (read-only target,
 * disk full, file open elsewhere) and nothing said so, they'd go hunting for a
 * file that was never written, while in the middle of reporting a bug.
 */
export type LogExportResult = { path: string } | { cancelled: true } | { error: string };

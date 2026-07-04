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

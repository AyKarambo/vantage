/** Renderer entry point — mount the app shell and let the store drive it. */
import { App } from './app/shell';
import { bridge } from './bridge';
import { must } from './dom';

// Uncaught renderer errors land in the main-process release log, so field
// problems in a packaged build are diagnosable from the in-app Logs screen.
window.addEventListener('error', (e) => {
  try {
    void bridge.logRendererError({
      message: String(e.message ?? e.error ?? 'unknown error'),
      source: e.filename ? `${e.filename}:${e.lineno}` : undefined,
      stack: e.error instanceof Error ? e.error.stack : undefined,
    });
  } catch {
    /* the bridge itself is broken — nothing left to report to */
  }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    void bridge.logRendererError({
      message: String(e.reason instanceof Error ? e.reason.message : e.reason),
      source: 'unhandledrejection',
      stack: e.reason instanceof Error ? e.reason.stack : undefined,
    });
  } catch {
    /* ignore */
  }
});

new App(must('#app'));

import type { WebContents } from 'electron';

/**
 * Locks a webContents to the bundle it loaded: denies popups / new windows and
 * blocks any navigation away from the app.
 *
 * Vantage's dashboard only ever loads its own local bundle and never navigates
 * in-window — external links are opened via `shell.openExternal` in the
 * composition root — so this is pure defense-in-depth behind Guardrail 1
 * (account safety). `loadFile`/`loadURL`/reload are *programmatic* navigations
 * and do NOT emit `will-navigate`/`will-redirect`, so the app's own load is
 * unaffected; only in-page navigations (link clicks, `window.location` changes,
 * form posts) and server-side redirects are prevented.
 *
 * The Electron import is type-only, so this module pulls no runtime Electron
 * code and stays trivially fakeable in unit tests.
 */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' as const }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
}

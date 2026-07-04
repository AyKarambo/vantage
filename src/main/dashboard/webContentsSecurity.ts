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

/**
 * True only for the app's own renderer bundle page — a local `file:` URL whose
 * path is the dashboard's `renderer/index.html` (works in dev and packed/asar).
 * Anything else (a remote origin, another local file, a stray subframe) is
 * rejected.
 */
export function isTrustedSenderUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && /\/renderer\/index\.html$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Validates the *sender* of an incoming IPC message: it must originate from the
 * app's own renderer frame (Electron security checklist #17 — defense-in-depth
 * behind the narrow preload). Any web frame — including subframes or child
 * windows — can address `ipcMain`, so main re-checks rather than trusting that
 * only our bridge can call. Structural event type → no Electron import at
 * runtime, unit-testable with a plain object.
 */
export function isTrustedIpcEvent(event: { senderFrame: { url: string } | null }): boolean {
  return event.senderFrame != null && isTrustedSenderUrl(event.senderFrame.url);
}

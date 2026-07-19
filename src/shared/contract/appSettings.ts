/**
 * App-behavior settings and metadata the Settings screen reads/writes.
 * Window bounds stay main-process-only (they never cross the bridge).
 */
import type { DemoPreference } from '../../core/demoPreference';

export interface AppUiSettings {
  /** ✕ keeps the app running in the tray (true) or quits it (false). */
  closeToTray: boolean;
  /** Launch the app when Windows starts (tray-first, window hidden). */
  runAtLogin: boolean;
  /** First-run demo-data choice ('unset' until the user is asked). */
  demoPreference: DemoPreference;
  /**
   * Whether Dev Mode is enabled for the *next* launch: the `scripts/ow-dev.mjs`
   * launcher only injects Overwolf dev credentials when this is not false.
   * Applying a change needs a restart (Dev Mode auth is start-time). Meaningful
   * only for unpackaged/dev runs; ignored by a packaged build.
   */
  devMode: boolean;
  /** OS notifications when GEP events go down / come back (default on). */
  gepNotifications: boolean;
  /**
   * Whether the local MCP endpoint listens, letting an MCP client (an LLM
   * coach) read your stats and write the manual layer. Default **off** — it is
   * reachable by any process running as this user, so enabling it is a
   * deliberate act. Takes effect immediately (no restart).
   */
  mcpEnabled: boolean;
  /**
   * The app version the user was last shown a "What's new" highlight for.
   * Absent (never set) means "we've never shown this user anything" — a fresh
   * install, which gets the intro tour instead of release notes, not a
   * fabricated baseline like `'0.0.0'`. Written by the "What's new" flow
   * after it displays; read at startup to decide whether to show it again.
   * Not a user preference — no Settings UI toggle for it.
   */
  lastSeenVersion?: string;
}

export interface AppInfo {
  version: string;
  supportEmail: string;
  /** Electron / ow-electron runtime version (process.versions.electron). */
  electron: string;
  /** Chromium version behind the renderer (process.versions.chrome). */
  chromium: string;
  /** Node.js version in the main process (process.versions.node). */
  node: string;
  /** V8 engine version (process.versions.v8). */
  v8: string;
  /** OS platform id (process.platform, e.g. 'win32'). */
  platform: string;
  /** OS release string (os.release()). */
  osRelease: string;
  /** True for an installed/packaged build, false in dev and the browser preview. */
  packaged: boolean;
  /**
   * True only once ow-electron has actually CONFIRMED the injected dev
   * credentials authenticated — not merely that a dev-mode launch was
   * attempted. Drives the sidebar's green "Dev mode" state; never true for a
   * packaged build (see core/devMode.ts + devModeAuthMonitor.ts). This
   * resolves asynchronously after launch, so a one-shot fetch of it can
   * legitimately read `false` even on a run that later succeeds — anything
   * needing to react to that resolution should subscribe to the live
   * `onDevModeAuthStatus` channel instead of polling this snapshot.
   */
  devMode: boolean;
  /**
   * Whether a dev-mode launch was *attempted* this run (Settings toggle on,
   * or forced via `--force`) — independent of whether it actually resolved
   * successfully. Unlike `devMode` this is a synchronous, launch-time fact
   * (see core/devMode.ts's `computeDevModeAttempted`), so a one-shot fetch of
   * it is always accurate, never stale. Settings uses this (not `devMode`) to
   * decide whether to auto-reveal the Dev Mode section, since a *failed*
   * attempt is exactly when you'd want easy access to the toggle.
   */
  devModeAttempted: boolean;
  /** Loaded Overwolf GEP package version (e.g. '309.0.0'); '' until it reports ready. Changes when Overwolf ships a fix. */
  gepPackageVersion: string;
}

/** Where Vantage's data folder (DB + manual data) currently lives (Settings screen). */
export interface DataLocation {
  /** Absolute folder the data files live in. */
  folder: string;
  /** True when it's the default `<userData>/data` location (no user override). */
  isDefault: boolean;
  /** True when first-run has never asked the user to choose (and the store is empty). */
  needsFirstRunChoice?: boolean;
}

/** Outcome of a data-folder change — cancelled/applied, adopt-required, or rejected. */
export type DataLocationResult =
  | {
      ok: true;
      location: DataLocation;
      changed: boolean;
      /** The target folder already holds Vantage data; caller must confirm adopt (no migration). */
      requiresAdopt?: boolean;
      /** Count of original files that couldn't be deleted from the old folder after migration. */
      leftovers?: number;
    }
  | { ok: false; error: string };

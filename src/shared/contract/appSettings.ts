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
   * True when the app is actually running in ow-electron Dev Mode — unpackaged
   * AND launched with Overwolf dev credentials in the environment. Drives the
   * "Dev Mode" indicator; never true for a packaged build (see core/devMode).
   */
  devMode: boolean;
}

/** Where Vantage's data folder (DB + manual data + screenshots) currently lives (Settings screen). */
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

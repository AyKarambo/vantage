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
}

export interface AppInfo {
  version: string;
  supportEmail: string;
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

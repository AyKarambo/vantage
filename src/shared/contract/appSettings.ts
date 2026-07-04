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

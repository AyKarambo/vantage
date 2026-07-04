/**
 * App-behavior settings and metadata the Settings screen reads/writes.
 * Window bounds stay main-process-only (they never cross the bridge).
 */

export interface AppUiSettings {
  /** ✕ keeps the app running in the tray (true) or quits it (false). */
  closeToTray: boolean;
  /** Launch the app when Windows starts (tray-first, window hidden). */
  runAtLogin: boolean;
}

export interface AppInfo {
  version: string;
  supportEmail: string;
}

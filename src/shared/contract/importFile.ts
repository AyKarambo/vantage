/**
 * Result payloads for the local "Import from file" action (Settings → Data).
 * Electron-free so main, preload and the renderer bundle can all share it.
 */

/** Outcome of importing a Vantage import file. */
export interface ImportFileResult {
  /** New games added to history. */
  imported: number;
  /** Games skipped because their matchId was already stored (idempotent re-import). */
  skipped: number;
  /** Rows in the file that failed validation and were not imported. */
  invalid: number;
  /** Account labels newly registered in config from the import. */
  accountsAdded: number;
  /** True when a rank anchor was set/updated from the file's `anchor`. */
  anchorSet: boolean;
  /** Set when the user cancelled the file picker — nothing was read or written. */
  cancelled?: boolean;
  /** Set when the file could not be used at all (unreadable / not a valid envelope) — nothing was written. */
  error?: string;
}

/**
 * Notion-export DTOs of the IPC contract: connection status, database/page
 * pickers and export results. Electron-free so main, preload and the renderer
 * bundle can all share it.
 */

/** Result of a Notion export attempt. */
export interface ExportResult {
  ok: number;
  failed: number;
  skipped?: number;
  unavailable?: boolean;
  /** Set when the export short-circuited, e.g. a database shape mismatch. */
  error?: string;
}

/** A database the Notion integration can see, from the picker's list. */
export interface NotionDatabaseSummary {
  id: string;
  title: string;
  url?: string;
}

/** A page the Notion integration can see — a candidate parent for auto-create. */
export interface NotionPageSummary {
  id: string;
  title: string;
  url?: string;
}

/** Notion connection state, for the Notion sync screen. */
export interface NotionStatus {
  /** An integration token is saved (encrypted at rest). */
  tokenSet: boolean;
  /** A target Gametracker database id is configured. */
  databaseConfigured: boolean;
  /** Ready to sync: token + database + a live client. */
  connected: boolean;
  /** Deep link to the Notion database, if known. */
  gametrackerUrl?: string;
  /** How many tracked games are available to push. */
  trackedGames: number;
  /** Where the configured database id came from. */
  databaseSource: 'selected' | 'appsettings' | 'none';
  /** The configured database id, for exact matching in the picker. */
  databaseId?: string;
  /** The database's title in Notion, resolved once validated. */
  databaseTitle?: string;
  /** Whether the configured database's shape matches the Gametracker schema; undefined = not yet checked. */
  shapeValid?: boolean;
  /** Missing/mismatched property names, when `shapeValid` is false. */
  shapeIssues?: string[];
  /** When the last successful sync finished (epoch ms). */
  lastSyncedAt?: number;
}

/** Live per-game progress while a sync runs (pushed over the bridge). */
export interface SyncProgress {
  done: number;
  total: number;
}

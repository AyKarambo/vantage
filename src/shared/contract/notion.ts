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
  /** Existing Notion pages updated in place (changed-since-last-export). */
  updated?: number;
  /** Pages recreated because the previously-linked Notion page was gone (deleted/archived). */
  recreated?: number;
  unavailable?: boolean;
  /** Set when the export short-circuited, e.g. a database shape mismatch. */
  error?: string;
}

/** Result of a Notion import (pull) attempt. */
export interface ImportResult {
  /** New matches added to local history. */
  imported: number;
  /** Rows skipped because their Match ID already existed locally. */
  skipped: number;
  /** Rows that could not be mapped (per-row failure isolation). */
  failed: number;
  /**
   * Existing local matches that picked up a bookkeeping grade/mental fields
   * merged in from a matching Notion row (`mergeImported`'s merged count).
   * Local review/mental data always wins — this only counts fill-ins onto
   * matches that had none.
   */
  merged?: number;
  /** True when no token/database is configured (nothing was attempted). */
  unavailable?: boolean;
  /** Set when the whole import short-circuited (e.g. auth/query error). */
  error?: string;
  /** New accounts surfaced from the imported rows' Account column (name-only entries). */
  accountsAdded?: number;
}

/**
 * Per-column schema-discovery status for the five optional subjective
 * Gametracker columns (Comms, Improvement Target, Leaver, Tilt, Toxic Mates).
 * 'available' means present with the right type (writable) — it does NOT mean
 * a value has been written for any given match; per-match "no value" is a
 * sync-time skip reason, not a schema-level status.
 */
export type SubjectiveColumnStatus = 'available' | 'wrong-type' | 'near-miss' | 'missing';

/** Diagnostic for one subjective column, from live Gametracker schema discovery. */
export interface SubjectiveColumnDiag {
  /** Canonical column name, e.g. 'Comms'. */
  column: string;
  status: SubjectiveColumnStatus;
  /** The live property's actual type, when `status` is 'wrong-type'. */
  actualType?: string;
  /** The live property's actual name, when `status` is 'near-miss'. */
  actualName?: string;
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
  /** How many local matches came from a Notion import (deletable for a clean re-import). */
  importedMatches: number;
  /** Per-column schema diagnostics for the optional subjective columns, once validated. */
  subjectiveColumns?: SubjectiveColumnDiag[];
}

/** Live per-game progress while a sync runs (pushed over the bridge). */
export interface SyncProgress {
  done: number;
  total: number;
}

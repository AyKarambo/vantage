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
  /**
   * A friendly, actionable failure reason — never a raw `String(err)`. Set
   * either when the whole export short-circuited before running (e.g. a
   * cached database shape mismatch), or, when one or more per-game exports
   * failed, the FIRST such failure's classified reason (`core/netError.ts`)
   * so a total outage (e.g. offline) isn't reported as silent zeros with no
   * explanation. `ok`/`failed`/etc. above still reflect the real counts
   * either way — this only explains why, once.
   */
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
  /**
   * Redundant Notion rows detected during import — rows that resolved to the
   * same match id as another row (the shape existing duplicates have: a hand
   * row plus a re-created copy). Only the canonical row was imported/ledgered;
   * the rest are left untouched in Notion until the user runs the explicit
   * "Clean up duplicates" action, which archives them.
   */
  duplicates?: number;
}

/**
 * Result of the opt-in "Clean up duplicates" action: re-scans the configured
 * Gametracker database, groups rows by effective match id, and for every
 * group with more than one row keeps a single canonical row while archiving
 * the rest to Notion trash (restorable, never a hard delete). Never run
 * implicitly by import or export — only from this explicit, confirmed action.
 */
export interface CleanupDuplicatesResult {
  /** Redundant rows successfully moved to Notion trash (`in_trash: true`). */
  archived: number;
  /** Duplicate groups found; each group's canonical row was kept (and re-pointed the ledger at it). */
  kept: number;
  /** Per-row archive failures — isolated, never abort the rest of the scan. */
  failed: number;
  /** True when there's no client/database configured — nothing was attempted. */
  unavailable?: boolean;
  /** Set when the whole scan (not a single row) failed. */
  error?: string;
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

/**
 * Outcome of the auto-provisioning pass that runs on validate: the Vantage-owned
 * columns that were missing from the configured database and got created in place
 * (additively, never retyping user columns), plus any error if the schema update
 * couldn't be applied (e.g. a token without permission to edit the schema). Absent
 * on a steady-state schema (nothing to create). Wrong-type/near-miss columns are
 * NOT reported here — they're left untouched and surfaced via `shapeIssues` /
 * `subjectiveColumns`.
 */
export interface SchemaProvisionStatus {
  /** Column names Vantage added to the database on this validate cycle. */
  created: string[];
  /** Set when provisioning failed; the sync still runs for the columns that exist. */
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
  /**
   * How many competitive games still need a Notion sync — never-exported OR
   * changed-since-export against the configured database, ignoring dashboard
   * filters (spec E3). `0` means "up to date" when `competitiveGames > 0`, and
   * "no competitive games yet" when `competitiveGames === 0`.
   */
  unsyncedGames: number;
  /**
   * Total competitive games in the (unfiltered) local history. Lets the UI tell
   * "no competitive games yet" (this is `0`) from "up to date" (`unsyncedGames`
   * is `0` but this is `> 0`).
   */
  competitiveGames: number;
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
  /**
   * Set when the last attempt to validate the configured database's shape
   * failed with a classified network/API error (offline, timed out, access
   * denied, not found, or the service being down — see `core/netError.ts`)
   * rather than an actual schema problem. A friendly, actionable message
   * (never a raw `String(err)`). When this is set, `shapeValid`/`shapeIssues`
   * are left undefined — the shape verdict is genuinely unknown, since the
   * request never got a real answer, and must not be reported as a
   * fabricated "Missing: <raw error>" shape mismatch.
   */
  transportError?: string;
  /** When the last successful sync finished (epoch ms). */
  lastSyncedAt?: number;
  /** How many local matches came from a Notion import (deletable for a clean re-import). */
  importedMatches: number;
  /** Per-column schema diagnostics for the optional subjective columns, once validated. */
  subjectiveColumns?: SubjectiveColumnDiag[];
  /**
   * Outcome of the schema auto-provisioning pass (columns Vantage added to keep the
   * database in step with its expected shape, or a provisioning error). Absent when
   * nothing was created and nothing failed.
   */
  schemaProvision?: SchemaProvisionStatus;
}

/** Live per-game progress while a sync runs (pushed over the bridge). */
export interface SyncProgress {
  done: number;
  total: number;
}

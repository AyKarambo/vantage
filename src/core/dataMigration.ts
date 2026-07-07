/**
 * The filenames a Vantage data folder can hold, exactly as they land on disk.
 * `history.db` is the SQLite store; the rest are JSON side-stores plus the
 * screenshots directory and a frozen legacy backup. Centralized here so the
 * planner and its executor (`src/store/dataMigration.ts`) agree on names.
 */
export const HISTORY_DB_FILE = 'history.db';
export const MANUAL_LOG_FILE = 'manual.json';
export const OUTBOX_FILE = 'outbox.json';
export const RANK_ANCHORS_FILE = 'rankAnchors.json';
export const MASTER_DATA_FILE = 'masterData.json';
export const SCREENSHOTS_DIR = 'screenshots';
export const LEGACY_HISTORY_JSON_FILE = 'history.json';

/** A single data artifact this migration knows how to move. */
export type DataArtifactKind = 'file' | 'dir';

/**
 * Presence flags for each movable data artifact, as observed by the caller
 * (the executor stats the source folder; this module never touches fs itself
 * so it stays Electron-free and unit-testable with plain booleans).
 */
export interface DataArtifactPresence {
  /** `history.db` — required for a folder to count as "has Vantage data" at all. */
  historyDb: boolean;
  /** `manual.json` (its `manual.tmp.json` sibling is transient and never copied). */
  manualLog: boolean;
  /** `outbox.json`. */
  outbox: boolean;
  /** `rankAnchors.json`. */
  rankAnchors: boolean;
  /** `masterData.json` — editable heroes/maps/seasons override deltas. */
  masterData: boolean;
  /** `screenshots/` directory. */
  screenshots: boolean;
  /** Frozen legacy `history.json` backup, present only on installs migrated from pre-SQLite. */
  legacyHistoryJson: boolean;
}

/** One planned copy operation: a source/destination pair plus how to move it. */
export interface DataMigrationOp {
  /** Filename or directory name relative to `fromDir`/`toDir`. */
  name: string;
  /** Absolute source path. */
  from: string;
  /** Absolute destination path. */
  to: string;
  /** Whether this artifact is a plain file or a directory (recursive copy). */
  kind: DataArtifactKind;
  /** Every artifact here was present in `files`; nothing optional-but-missing is ever listed. */
  optional: boolean;
}

/** An ordered migration plan: the operations to perform, in the order they must run. */
export interface DataMigrationPlan {
  ops: DataMigrationOp[];
}

/**
 * Build the ordered list of copy operations to migrate a Vantage data folder.
 * Only artifacts present in `files` are listed — missing optional files are
 * silently skipped, not treated as errors (spec C2). `history.db` is always
 * first (the executor needs the DB handle closed/reopened before touching the
 * JSON side-stores or the screenshots directory), followed by the JSON
 * side-stores, then the legacy backup, then the screenshots directory last
 * (directories are the slowest/most failure-prone copy, so surfacing a JSON
 * or DB copy failure first gives the clearest error).
 *
 * Pure and Electron-free: it never touches the filesystem. The executor
 * (`src/store/dataMigration.ts`) stats `fromDir`, builds `files`, calls this,
 * then performs + verifies each op.
 */
export function planDataMigration(
  files: DataArtifactPresence,
  fromDir: string,
  toDir: string
): DataMigrationPlan {
  const ops: DataMigrationOp[] = [];

  const addFile = (name: string, present: boolean, optional: boolean) => {
    if (!present) return;
    ops.push({ name, from: joinPath(fromDir, name), to: joinPath(toDir, name), kind: 'file', optional });
  };
  const addDir = (name: string, present: boolean, optional: boolean) => {
    if (!present) return;
    ops.push({ name, from: joinPath(fromDir, name), to: joinPath(toDir, name), kind: 'dir', optional });
  };

  addFile(HISTORY_DB_FILE, files.historyDb, false);
  addFile(MANUAL_LOG_FILE, files.manualLog, true);
  addFile(OUTBOX_FILE, files.outbox, true);
  addFile(RANK_ANCHORS_FILE, files.rankAnchors, true);
  addFile(MASTER_DATA_FILE, files.masterData, true);
  addFile(LEGACY_HISTORY_JSON_FILE, files.legacyHistoryJson, true);
  addDir(SCREENSHOTS_DIR, files.screenshots, true);

  return { ops };
}

/**
 * Whether a directory already holds Vantage data. Per Decision C.2, this is
 * true iff `history.db` is present — every other artifact is optional and
 * their absence doesn't disqualify a folder as "already has Vantage data".
 * Pure: the caller stats the directory and passes the presence flags this
 * needs (only `historyDb` matters here), so this module never touches fs.
 */
export function isVantageDataDir(files: Pick<DataArtifactPresence, 'historyDb'>): boolean {
  return files.historyDb;
}

/**
 * Join a directory and a bare filename into a path, without importing Node's
 * `path` module (core stays Electron/Node-builtin-free — see `CLAUDE.md`
 * Guardrail 3). `dir` may use either `/` or `\` separators (both appear in
 * caller-supplied absolute paths across platforms); `name` here is always a
 * plain artifact basename (no separators of its own), so this doesn't need to
 * handle arbitrary multi-segment joins — just "strip one trailing separator,
 * then add exactly one".
 */
function joinPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${sep}${name}`;
}

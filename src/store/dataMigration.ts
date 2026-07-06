import * as fs from 'fs';
import * as path from 'path';
import {
  planDataMigration,
  isVantageDataDir,
  HISTORY_DB_FILE,
  type DataArtifactPresence,
  type DataMigrationOp,
} from '../core/dataMigration';

/**
 * Anything that can be told to reopen itself at a new directory (`HistoryStore`
 * today; the JSON side-stores and `ScreenshotService` share the same shape).
 * Kept structural so this module doesn't need to import every concrete store
 * class.
 *
 * `deferDelete` is optional (most stores' `relocate` never deletes anything —
 * the JSON side-stores' original file is removed by the executor itself, well
 * after commit, see `deleteWithRetry`). `HistoryStore.relocate` is the one
 * relocate that deletes its own original internally; passing
 * `{ deferDelete: true }` asks it to skip that internal delete and instead
 * return a cleanup thunk the executor runs after `persistFolder` — preserving
 * the crash guarantee "persist the pointer before deleting originals" for
 * history.db too (spec Area C).
 */
export interface Relocatable {
  relocate(newDir: string, opts?: { deferDelete?: boolean }): (() => boolean) | void;
}

/**
 * A store that can also *adopt* a folder that already holds its own data —
 * point at it as-is, no copy, no delete of either side. `HistoryStore.relocate`
 * deliberately refuses a target that already has a database (its contract is
 * "move my data there", not "start using the data that's already there"), so
 * the adopt path needs this distinct, narrower operation. A store without a
 * dedicated `adopt` falls back to `relocate` in the executor (safe for stores
 * whose relocate is a plain re-point-and-reload, e.g. the JSON side-stores).
 */
export interface AdoptableStore extends Relocatable {
  adopt(dir: string): void;
}

function canAdopt(store: Relocatable): store is AdoptableStore {
  return typeof (store as Partial<AdoptableStore>).adopt === 'function';
}

/** Repoint a store at `dir`, preferring its dedicated `adopt` (no copy/delete)
 *  when the store implements one, else its plain `relocate`. */
function adoptOrRelocate(store: Relocatable, dir: string): void {
  if (canAdopt(store)) store.adopt(dir);
  else store.relocate(dir);
}

/** The live store handles the executor repoints after a successful copy phase.
 *  Only `history` is required today — the JSON side-stores/screenshots are
 *  optional so this compiles and works before they gain `relocate` (Wave 1
 *  sequencing: this task lands before `W1-C2`). */
export interface DataMigrationStores {
  history: Relocatable;
  manualLog?: Relocatable;
  outbox?: Relocatable;
  rankAnchors?: Relocatable;
  screenshots?: Relocatable;
}

/** What the executor needs from the caller to plan + run a migration. */
export interface DataMigrationRequest {
  /** Current data directory (source). */
  fromDir: string;
  /** Target data directory (destination). */
  toDir: string;
  /** Live store handles to repoint after a successful copy phase. */
  stores: DataMigrationStores;
  /** True when the caller has explicitly confirmed adopting a target folder
   *  that already holds Vantage data (Settings "adopt" / first-run auto-adopt).
   *  When false (default) and the target already has data, the migration is
   *  refused rather than risking an overwrite. */
  adopt?: boolean;
  /** Persist the new folder choice (e.g. `config.dataFolder = toDir`). Called
   *  once, after copy+verify succeeds and before originals are deleted, so a
   *  crash mid-delete still leaves the pointer at the now-authoritative folder. */
  persistFolder: (dir: string) => void;
}

/** Outcome of a migration attempt. */
export interface DataMigrationResult {
  ok: boolean;
  /** True when this was an adopt (repoint only, no copy/delete). */
  adopted?: boolean;
  /** Human-readable reason when `ok` is false. */
  error?: string;
  /** Count of source files that could not be removed after a successful
   *  commit (data is safe at `toDir`; these are harmless stale copies the
   *  user may want to clean up manually). */
  leftovers?: number;
}

const DELETE_RETRIES = 3;
const DELETE_RETRY_DELAY_MS = 50;

/**
 * Copy-verify-commit-delete executor for relocating all Vantage data files to a
 * new folder (spec Area C). Electron-free and dir-injected so it's unit-testable
 * with plain temp directories, like every other `src/store/` module.
 *
 * Guarantees (spec C2):
 * - Refuses to touch a target that already holds Vantage data unless the caller
 *   passed `adopt: true` — adoption repoints the stores with no copy and no
 *   delete of either side (Decision C.6).
 * - Otherwise: stats `fromDir`, builds the plan via `planDataMigration`, copies
 *   + verifies every present artifact into `toDir`. `history.db` is relocated
 *   via `stores.history.relocate` (it already implements its own
 *   copy-then-open-copy-with-rollback and refuses a target that already has a
 *   database); every other artifact is copied and size-verified directly here.
 *   Only once *all* copies verify does it commit: persist the folder, repoint
 *   the remaining live stores, then delete the originals (bounded retry — a
 *   just-closed handle may still be momentarily locked on Windows).
 * - Any failure before commit leaves `fromDir` fully intact and removes any
 *   partial copies already written to `toDir` — never a half-migrated state.
 * - Undeletable originals after a successful commit are surfaced as
 *   `{ ok: true, leftovers: N }`, not silently dropped or turned into a failure
 *   (the data is safe; the leftover is informational).
 */
export function migrateDataFolder(req: DataMigrationRequest): DataMigrationResult {
  const { fromDir, toDir } = req;
  const adopt = req.adopt ?? false;

  const targetHasData = isVantageDataDir(statPresence(toDir));
  if (targetHasData && !adopt) {
    return {
      ok: false,
      error: `The folder "${toDir}" already contains Vantage data. Choose "adopt" to switch to it, or pick an empty folder.`,
    };
  }

  if (adopt) {
    // Adoption never copies or deletes either side — just repoint + persist.
    try {
      relocateAll(req.stores, toDir, { adopt: true });
    } catch (err) {
      return { ok: false, error: message(err) };
    }
    req.persistFolder(toDir);
    return { ok: true, adopted: true };
  }

  let writable: string | undefined;
  try {
    fs.mkdirSync(toDir, { recursive: true });
    writable = probeWritable(toDir);
  } catch (err) {
    return { ok: false, error: `Can't create or write to "${toDir}": ${message(err)}` };
  }
  if (writable) return { ok: false, error: writable };

  const plan = planDataMigration(statPresence(fromDir), fromDir, toDir);
  // The DB is relocated through HistoryStore.relocate (below), not a raw file
  // copy here, so it never gets a redundant/conflicting second copy.
  const fileOps = plan.ops.filter((op) => op.name !== HISTORY_DB_FILE);

  const copied: DataMigrationOp[] = [];
  try {
    for (const op of fileOps) {
      copyOp(op);
      verifyOp(op);
      copied.push(op);
    }
  } catch (err) {
    // Roll back: remove whatever partial copies made it into toDir, leave
    // fromDir completely untouched.
    for (const op of copied) removeBestEffort(op.to, op.kind);
    return { ok: false, error: message(err) };
  }

  // All copies verified — commit: repoint stores (history.db moves via its
  // own relocate, with its original delete DEFERRED — see below), persist the
  // pointer, THEN delete every original (history.db included). Ordering
  // matters both for the crash guarantee (a crash between repoint and persist
  // must never have already destroyed the only copy of `fromDir`'s data) and
  // on Windows specifically (SQLite/JSON handles must be closed against
  // fromDir before we can remove those files).
  let deleteHistoryOriginal: (() => boolean) | undefined;
  try {
    deleteHistoryOriginal = relocateAll(req.stores, toDir);
  } catch (err) {
    // Repointing failed after a successful copy phase — clean up the copies
    // and leave the original store handles (and fromDir) exactly as they were.
    for (const op of copied) removeBestEffort(op.to, op.kind);
    return { ok: false, error: message(err) };
  }
  req.persistFolder(toDir);

  // Only now — after the new folder is the durably-persisted pointer — do we
  // delete originals. history.db's delete was deferred by `relocateAll` into
  // this thunk so it also happens post-commit, matching the JSON side-stores;
  // it gets the same bounded retry (a just-closed SQLite handle can stay
  // locked on Windows for a few milliseconds) and leftovers accounting.
  let leftovers = 0;
  if (deleteHistoryOriginal && !retryThunk(deleteHistoryOriginal)) leftovers++;
  for (const op of fileOps) {
    if (!deleteWithRetry(op.from, op.kind)) leftovers++;
  }

  return leftovers > 0 ? { ok: true, leftovers } : { ok: true };
}

// --- internals ----------------------------------------------------------

/**
 * Repoint every store at `toDir`. In the plain (non-adopt) path, `history`'s
 * relocate is asked to defer its own original's delete (Decision C.6 crash
 * guarantee — see {@link migrateDataFolder}'s commit comment); the returned
 * cleanup thunk is handed back to the caller to run only after the new folder
 * has been persisted. Adoption never deletes anything on either side, so no
 * thunk is needed (or returned) on that path.
 */
function relocateAll(stores: DataMigrationStores, toDir: string, opts: { adopt: boolean } = { adopt: false }): (() => boolean) | undefined {
  if (opts.adopt) {
    adoptOrRelocate(stores.history, toDir);
    if (stores.manualLog) adoptOrRelocate(stores.manualLog, toDir);
    if (stores.outbox) adoptOrRelocate(stores.outbox, toDir);
    if (stores.rankAnchors) adoptOrRelocate(stores.rankAnchors, toDir);
    if (stores.screenshots) adoptOrRelocate(stores.screenshots, toDir);
    return undefined;
  }
  const deleteHistoryOriginal = stores.history.relocate(toDir, { deferDelete: true }) ?? undefined;
  if (stores.manualLog) stores.manualLog.relocate(toDir);
  if (stores.outbox) stores.outbox.relocate(toDir);
  if (stores.rankAnchors) stores.rankAnchors.relocate(toDir);
  if (stores.screenshots) stores.screenshots.relocate(toDir);
  return deleteHistoryOriginal;
}

/** Presence flags for the artifacts `planDataMigration`/`isVantageDataDir` need,
 *  derived by statting the folder. A non-existent folder has nothing present. */
function statPresence(dir: string): DataArtifactPresence {
  const has = (name: string) => {
    try {
      return fs.existsSync(path.join(dir, name));
    } catch {
      return false;
    }
  };
  return {
    historyDb: has('history.db'),
    manualLog: has('manual.json'),
    outbox: has('outbox.json'),
    rankAnchors: has('rankAnchors.json'),
    screenshots: has('screenshots'),
    legacyHistoryJson: has('history.json'),
  };
}

/** Returns an error message if `dir` isn't writable, else undefined. */
function probeWritable(dir: string): string | undefined {
  const probe = path.join(dir, `.vantage-write-test-${Date.now()}`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return undefined;
  } catch (err) {
    return `"${dir}" is not writable: ${message(err)}`;
  }
}

function copyOp(op: DataMigrationOp): void {
  fs.mkdirSync(path.dirname(op.to), { recursive: true });
  if (op.kind === 'dir') {
    fs.cpSync(op.from, op.to, { recursive: true });
  } else {
    fs.copyFileSync(op.from, op.to);
  }
}

/** Verify a copy landed: presence + (for files) a matching size. A directory
 *  copy is verified by presence only (a byte-for-byte walk is unnecessary here —
 *  `fs.cpSync` throws on any per-file failure, which the caller already catches). */
function verifyOp(op: DataMigrationOp): void {
  if (!fs.existsSync(op.to)) {
    throw new Error(`Copy of "${op.name}" did not land at "${op.to}"`);
  }
  if (op.kind === 'file') {
    const from = fs.statSync(op.from).size;
    const to = fs.statSync(op.to).size;
    if (from !== to) {
      throw new Error(`Copy of "${op.name}" is incomplete (expected ${from} bytes, got ${to})`);
    }
  }
}

function removeBestEffort(target: string, kind: DataArtifactOpKind): void {
  try {
    if (kind === 'dir') fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
  } catch {
    // Best effort during rollback — a leftover partial copy is harmless.
  }
}

/** Delete a migrated original with a short bounded retry — a handle we just
 *  closed as part of repointing (SQLite in particular) can stay locked on
 *  Windows for a few milliseconds after `close()` returns. Returns false
 *  (surfaced as a "leftover") if every attempt fails. */
function deleteWithRetry(target: string, kind: DataArtifactOpKind): boolean {
  for (let attempt = 0; attempt < DELETE_RETRIES; attempt++) {
    try {
      if (kind === 'dir') fs.rmSync(target, { recursive: true, force: true });
      else fs.rmSync(target, { force: true });
      return true;
    } catch {
      busyWaitSync(DELETE_RETRY_DELAY_MS);
    }
  }
  return !fs.existsSync(target);
}

/** Bounded retry around a deferred delete thunk (e.g. `HistoryStore.relocate`'s
 *  `deferDelete` cleanup) — same shape as {@link deleteWithRetry} for the raw
 *  file/dir originals, so history.db gets the same Windows-lock tolerance and
 *  leftovers accounting as every other artifact. */
function retryThunk(thunk: () => boolean): boolean {
  for (let attempt = 0; attempt < DELETE_RETRIES; attempt++) {
    if (thunk()) return true;
    busyWaitSync(DELETE_RETRY_DELAY_MS);
  }
  return thunk();
}

/** Synchronous short delay (no `await` — this module stays a plain sync API to
 *  match the other `src/store/` executors). Bounded to a handful of ms per
 *  retry, only ever invoked on the rare undeletable-original path. */
function busyWaitSync(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type DataArtifactOpKind = DataMigrationOp['kind'];

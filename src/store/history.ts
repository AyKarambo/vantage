import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import type { GameRecord, MatchReview } from '../core/analytics';
import type { MatchRecord } from '../core/model';
import { mergeImportedIntoLocal } from '../core/notionMerge';

/** Basename of the SQLite database inside the store's directory. */
export const DB_FILE = 'history.db';

/**
 * The columns denormalized out of {@link GameRecord} for querying, in the exact
 * order {@link rowValues} produces. `data` (the last column) holds the full
 * `JSON.stringify(GameRecord)` and is the source of truth for reconstruction —
 * the scalar columns are indexed copies for future SQL analytics.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS games (
  matchId          TEXT PRIMARY KEY,
  timestamp        INTEGER NOT NULL,
  account          TEXT,
  role             TEXT,
  map              TEXT,
  result           TEXT,
  gameType         TEXT,
  source           TEXT,
  srDelta          REAL,
  durationMinutes  REAL,
  importedAt       INTEGER,
  importSource     TEXT,
  data             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_account   ON games(account);
CREATE INDEX IF NOT EXISTS idx_games_timestamp ON games(timestamp);
CREATE INDEX IF NOT EXISTS idx_games_map        ON games(map);
CREATE INDEX IF NOT EXISTS idx_games_role       ON games(role);
`;

/**
 * Holding table for competitive matches that played but arrived without a GEP
 * `match_outcome` (win/loss/draw) — {@link matchToGame} can't resolve them, so
 * rather than drop the played match they wait here until the user sets a result
 * in Review. Deliberately SEPARATE from `games`: a pending row is a raw
 * {@link MatchRecord}, never an analyzable {@link GameRecord}, so it can never
 * leak into analytics, the rank engine, or Notion export. `data` holds the full
 * `JSON.stringify(MatchRecord)`; `endedAt` is denormalized only for ordering.
 */
const PENDING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pending_matches (
  matchId  TEXT PRIMARY KEY,
  endedAt  INTEGER,
  data     TEXT NOT NULL
);
`;

const INSERT_SQL =
  `INSERT INTO games (matchId, timestamp, account, role, map, result, gameType, source, srDelta, durationMinutes, importedAt, importSource, data)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(matchId) DO NOTHING`;

const UPDATE_SQL =
  `UPDATE games SET timestamp=?, account=?, role=?, map=?, result=?, gameType=?, source=?, srDelta=?, durationMinutes=?, importedAt=?, importSource=?, data=?
   WHERE matchId=?`;

/** The bind values for one game, matching the column order of {@link INSERT_SQL}. */
function rowValues(g: GameRecord): SQLInputValue[] {
  return [
    g.matchId,
    g.timestamp,
    g.account ?? null,
    g.role ?? null,
    g.map ?? null,
    g.result ?? null,
    g.gameType ?? null,
    g.source ?? null,
    g.srDelta ?? null,
    g.durationMinutes ?? null,
    g.importedAt ?? null,
    g.importSource ?? null,
    JSON.stringify(g),
  ];
}

/** Update binds: every column except `matchId`, then `matchId` for the WHERE. */
function updateValues(g: GameRecord): SQLInputValue[] {
  const [, ...rest] = rowValues(g);
  return [...rest, g.matchId];
}

/**
 * Durable history of every analyzed game (the dataset behind the dashboard),
 * backed by an embedded SQLite database (`node:sqlite`). Separate from the Notion
 * outbox, which only tracks export/dedupe state.
 *
 * The public interface matches the previous JSON-file store exactly, so callers in
 * `core/`, `main/` and the renderer are unaffected; SQLite gives ACID durability
 * (a torn write can no longer wipe history) and a queryable substrate for future
 * analytics. Takes a plain directory (no Electron import) so it stays unit-testable.
 * Callers that create short-lived instances must {@link close} them — an open
 * handle keeps the file locked on Windows.
 */
export class HistoryStore {
  private dir: string;
  private dbPath: string;
  private db!: DatabaseSync;
  private insertStmt!: StatementSync;
  private updateStmt!: StatementSync;
  private getStmt!: StatementSync;
  private hasStmt!: StatementSync;
  private allStmt!: StatementSync;
  private countStmt!: StatementSync;
  private importedCountStmt!: StatementSync;
  private selectImportedStmt!: StatementSync;
  private deleteImportedStmt!: StatementSync;
  private addPendingStmt!: StatementSync;
  private allPendingStmt!: StatementSync;
  private hasPendingStmt!: StatementSync;
  private getPendingStmt!: StatementSync;
  private deletePendingStmt!: StatementSync;
  private pendingCountStmt!: StatementSync;

  constructor(dir: string) {
    this.dir = dir;
    this.dbPath = path.join(dir, DB_FILE);
    this.open();
  }

  /** Snapshot of every stored game, in insertion order. */
  all(): GameRecord[] {
    return this.allStmt.all().map((row) => JSON.parse(String(row.data)) as GameRecord);
  }

  /** True if a game with this match id is already stored. */
  has(matchId: string): boolean {
    return this.hasStmt.get(matchId) !== undefined;
  }

  /** Append a game (ignored if its match id is already stored). */
  add(game: GameRecord): boolean {
    return Number(this.insertStmt.run(...rowValues(game)).changes) > 0;
  }

  /** Append many games in one transaction, skipping ids already stored. */
  addMany(games: GameRecord[]): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    this.tx(() => {
      for (const game of games) {
        if (Number(this.insertStmt.run(...rowValues(game)).changes) > 0) imported++;
        else skipped++;
      }
    });
    return { imported, skipped };
  }

  /**
   * Patch a stored game's manual-layer fields in place (result/role/map/heroes/
   * gameType for hand-logged matches; mental/srDelta/review for any). Only the
   * provided keys change; a `null` value deletes that key (e.g. clearing srDelta);
   * false if the id is unknown. The caller is responsible for not passing
   * game-derived facts for auto-tracked (GEP) records.
   */
  editManual(
    matchId: string,
    patch: Partial<Pick<GameRecord, 'result' | 'role' | 'map' | 'heroes' | 'gameType' | 'mental' | 'review'>> &
      { srDelta?: number | null; performance?: number | null },
  ): boolean {
    const game = this.getOne(matchId);
    if (!game) return false;
    const target = game as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete target[k];
      else if (v !== undefined) target[k] = v;
    }
    this.updateStmt.run(...updateValues(game));
    return true;
  }

  /** Rewrite the account label on every matching game (one transaction). Returns the count changed. */
  relabelAccount(from: string, to: string): number {
    if (from === to) return 0;
    const games = this.allStmt.all()
      .map((row) => JSON.parse(String(row.data)) as GameRecord)
      .filter((g) => g.account === from);
    if (!games.length) return 0;
    this.tx(() => {
      for (const g of games) {
        g.account = to;
        this.updateStmt.run(...updateValues(g));
      }
    });
    return games.length;
  }

  /**
   * One-time re-resolution of stored rows: apply `fn` to each game and rewrite
   * only those whose `map`/`account` actually changed — idempotent, so a second
   * run rewrites nothing. Config-free: the caller injects the resolver (which
   * knows the map catalog / accounts). Returns the count rewritten.
   */
  reresolve(fn: (g: GameRecord) => { map?: string; account?: string }): number {
    const games = this.allStmt.all().map((row) => JSON.parse(String(row.data)) as GameRecord);
    const changed: GameRecord[] = [];
    for (const g of games) {
      const patch = fn(g);
      let dirty = false;
      if (patch.map !== undefined && patch.map !== g.map) { g.map = patch.map; dirty = true; }
      if (patch.account !== undefined && patch.account !== g.account) { g.account = patch.account; dirty = true; }
      if (dirty) changed.push(g);
    }
    if (!changed.length) return 0;
    this.tx(() => {
      for (const g of changed) this.updateStmt.run(...updateValues(g));
    });
    return changed.length;
  }

  /** Total number of stored games. */
  count(): number {
    return Number(this.countStmt.get()?.c ?? 0);
  }

  // --- pending (no-outcome) holding store --------------------------------------

  /**
   * Hold a played competitive match that arrived without a resolvable GEP
   * outcome, so it can be completed by hand in Review instead of being dropped.
   * Dedupes by `matchId`; returns true only if newly held.
   */
  addPending(rec: MatchRecord): boolean {
    return Number(this.addPendingStmt.run(rec.matchId, rec.endedAt ?? null, JSON.stringify(rec)).changes) > 0;
  }

  /** Every held pending match, oldest first (by `endedAt`). */
  allPending(): MatchRecord[] {
    return this.allPendingStmt.all().map((row) => JSON.parse(String(row.data)) as MatchRecord);
  }

  /** True if a pending match with this id is currently held. */
  hasPending(matchId: string): boolean {
    return this.hasPendingStmt.get(matchId) !== undefined;
  }

  /**
   * Remove and return a held pending match (SELECT then DELETE in one
   * transaction) — the resolve path takes it out of the holding store before
   * running it back through the normal history pipeline. Undefined if unknown.
   */
  takePending(matchId: string): MatchRecord | undefined {
    let rec: MatchRecord | undefined;
    this.tx(() => {
      const row = this.getPendingStmt.get(matchId);
      if (!row) return;
      rec = JSON.parse(String(row.data)) as MatchRecord;
      this.deletePendingStmt.run(matchId);
    });
    return rec;
  }

  /** How many matches are waiting for a result (the "Needs result" badge). */
  pendingCount(): number {
    return Number(this.pendingCountStmt.get()?.c ?? 0);
  }

  /**
   * How many stored games came from the given import channel (carry `importedAt`
   * with that provenance). Legacy imports predating {@link GameRecord.importSource}
   * count as `'notion'` via `COALESCE(importSource,'notion')`.
   */
  importedCount(source: 'notion' | 'file'): number {
    return Number(this.importedCountStmt.get(source)?.c ?? 0);
  }

  /**
   * Drop every game that came from the given import channel (carries `importedAt`
   * with that provenance), leaving live-tracked, hand-logged, and other-channel
   * imports untouched — so one import can be wiped and re-run cleanly without
   * disturbing another. Legacy imports predating {@link GameRecord.importSource}
   * are treated as `'notion'`. Returns the removed games.
   */
  removeImported(source: 'notion' | 'file'): GameRecord[] {
    const removed = this.selectImportedStmt.all(source).map((row) => JSON.parse(String(row.data)) as GameRecord);
    if (removed.length) this.deleteImportedStmt.run(source);
    return removed;
  }

  /** Append end-of-match capture paths to a stored game; false if the id is unknown. */
  addScreenshots(matchId: string, screenshots: string[]): boolean {
    if (!screenshots.length) return false;
    const game = this.getOne(matchId);
    if (!game) return false;
    game.screenshots = [...(game.screenshots ?? []), ...screenshots];
    this.updateStmt.run(...updateValues(game));
    return true;
  }

  /** Attach (or replace) the manual review on a stored game; false if the id is unknown. */
  setReview(matchId: string, review: MatchReview): boolean {
    const game = this.getOne(matchId);
    if (!game) return false;
    game.review = review;
    this.updateStmt.run(...updateValues(game));
    return true;
  }

  /** Remove a game's review (the undo of a first-time save); false if there was none. */
  clearReview(matchId: string): boolean {
    const game = this.getOne(matchId);
    if (!game?.review) return false;
    delete game.review;
    this.updateStmt.run(...updateValues(game));
    return true;
  }

  /**
   * Bulk review import (one transaction) for the legacy-localStorage migration.
   * Never overwrites an existing review; unknown match ids are skipped.
   */
  setReviews(entries: Array<{ matchId: string; review: MatchReview }>): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    this.tx(() => {
      for (const { matchId, review } of entries) {
        const game = this.getOne(matchId);
        if (!game || game.review) {
          skipped++;
          continue;
        }
        game.review = review;
        this.updateStmt.run(...updateValues(game));
        imported++;
      }
    });
    return { imported, skipped };
  }

  /**
   * Bulk-merge freshly-imported Notion rows onto their already-stored local
   * counterparts (one transaction) — the re-import path, as opposed to
   * {@link addMany} which only inserts brand-new matchIds. For each entry whose
   * `matchId` is already stored, applies {@link mergeImportedIntoLocal}'s pure
   * decision (local always wins for both review and mental) via the same
   * patch semantics as {@link editManual}. Unlike `addMany`, this never stamps
   * `importedAt` — a merged row was already tracked or hand-logged, so its
   * existing provenance is left alone (`removeImported` must not delete it).
   * Unknown matchIds and entries with nothing to change are both no-ops,
   * counted as skipped.
   */
  mergeImported(entries: GameRecord[]): { merged: number; skipped: number } {
    let merged = 0;
    let skipped = 0;
    this.tx(() => {
      for (const imported of entries) {
        const local = this.getOne(imported.matchId);
        const patch = local ? mergeImportedIntoLocal(local, imported) : null;
        if (!local || !patch) {
          skipped++;
          continue;
        }
        if (patch.review !== undefined) local.review = patch.review;
        if (patch.mental !== undefined) local.mental = patch.mental;
        this.updateStmt.run(...updateValues(local));
        merged++;
      }
    });
    return { merged, skipped };
  }

  /**
   * Move the database file to a new directory and reopen it there — the backing
   * for the user-configurable location. Throws if the target already holds a
   * database (never silently overwrites another dataset).
   *
   * By default the original file is deleted (best-effort) before returning, to
   * match every existing caller/test. Pass `{ deferDelete: true }` when the
   * caller needs the crash guarantee "persist the new pointer before deleting
   * the original" (spec Area C / Decision C.6): the original is left in place
   * and a cleanup thunk is returned instead — call it only after the new
   * pointer has been durably persisted. The returned thunk itself reports
   * whether the delete actually succeeded (not swallowed silently), so the
   * caller can account for leftovers the same way it does for the JSON
   * side-stores.
   */
  relocate(newDir: string, opts: { deferDelete: true }): () => boolean;
  relocate(newDir: string, opts?: { deferDelete?: false }): void;
  relocate(newDir: string, opts?: { deferDelete?: boolean }): (() => boolean) | void {
    fs.mkdirSync(newDir, { recursive: true });
    const target = path.join(newDir, DB_FILE);
    if (path.resolve(target) === path.resolve(this.dbPath)) return opts?.deferDelete ? () => true : undefined;
    if (fs.existsSync(target)) {
      throw new Error(`A history database already exists at ${target}`);
    }
    const fromDir = this.dir;
    const fromPath = this.dbPath;
    this.db.close();
    try {
      // Copy first (also works across drives), then open the copy — so any
      // failure can roll back to the original file, which is still intact.
      fs.copyFileSync(fromPath, target);
      this.dir = newDir;
      this.dbPath = target;
      this.open();
    } catch (err) {
      // The move failed after we closed the handle: restore the store to its
      // original location and reopen it so history stays usable, then surface
      // the error. Never leave the store with a closed handle.
      this.dir = fromDir;
      this.dbPath = fromPath;
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch { /* harmless leftover */ }
      this.open();
      throw err;
    }
    const cleanup = (): boolean => {
      try {
        fs.unlinkSync(fromPath);
        return true;
      } catch {
        return !fs.existsSync(fromPath);
      }
    };
    if (opts?.deferDelete) return cleanup;
    // The new location is live; drop the original copy now (a leftover is harmless).
    cleanup();
  }

  /**
   * Point this store at a directory that already holds its own `history.db`
   * (no copy, no delete of either side) — the backing for adopting a folder
   * a user picks that already has Vantage data (spec Area C, Decision C.6).
   * Unlike {@link relocate}, this refuses a target that does NOT already have
   * a database: adoption means "start using the data that's already there",
   * not "create one".
   */
  adopt(targetDir: string): void {
    const target = path.join(targetDir, DB_FILE);
    if (path.resolve(target) === path.resolve(this.dbPath)) return;
    if (!fs.existsSync(target)) {
      throw new Error(`No history database exists at ${target} to adopt`);
    }
    this.db.close();
    this.dir = targetDir;
    this.dbPath = target;
    this.open();
  }

  /** Close the database handle. Required before deleting the file (Windows locks it open). */
  close(): void {
    this.db.close();
  }

  // --- internals --------------------------------------------------------------

  private open(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    // Rollback journal (single-file, cloud-sync friendly) + full fsync durability.
    this.db.exec('PRAGMA journal_mode = DELETE;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.db.exec(SCHEMA_SQL);
    this.db.exec(PENDING_SCHEMA_SQL);
    this.migrate();
    this.insertStmt = this.db.prepare(INSERT_SQL);
    this.updateStmt = this.db.prepare(UPDATE_SQL);
    this.getStmt = this.db.prepare('SELECT data FROM games WHERE matchId = ?');
    this.hasStmt = this.db.prepare('SELECT 1 FROM games WHERE matchId = ?');
    this.allStmt = this.db.prepare('SELECT data FROM games ORDER BY rowid');
    this.countStmt = this.db.prepare('SELECT COUNT(*) AS c FROM games');
    // Import channels share the `importedAt` flag but are scoped by `importSource`
    // so one channel's clear/count never touches another's. `COALESCE(…,'notion')`
    // maps legacy Notion imports (written before the column existed) to 'notion'.
    this.importedCountStmt = this.db.prepare(
      `SELECT COUNT(*) AS c FROM games WHERE importedAt IS NOT NULL AND COALESCE(importSource, 'notion') = ?`,
    );
    this.selectImportedStmt = this.db.prepare(
      `SELECT data FROM games WHERE importedAt IS NOT NULL AND COALESCE(importSource, 'notion') = ? ORDER BY rowid`,
    );
    this.deleteImportedStmt = this.db.prepare(
      `DELETE FROM games WHERE importedAt IS NOT NULL AND COALESCE(importSource, 'notion') = ?`,
    );
    // Pending (no-outcome) holding store — see PENDING_SCHEMA_SQL.
    this.addPendingStmt = this.db.prepare(
      `INSERT INTO pending_matches (matchId, endedAt, data) VALUES (?, ?, ?) ON CONFLICT(matchId) DO NOTHING`,
    );
    this.allPendingStmt = this.db.prepare('SELECT data FROM pending_matches ORDER BY endedAt');
    this.hasPendingStmt = this.db.prepare('SELECT 1 FROM pending_matches WHERE matchId = ?');
    this.getPendingStmt = this.db.prepare('SELECT data FROM pending_matches WHERE matchId = ?');
    this.deletePendingStmt = this.db.prepare('DELETE FROM pending_matches WHERE matchId = ?');
    this.pendingCountStmt = this.db.prepare('SELECT COUNT(*) AS c FROM pending_matches');
  }

  /**
   * Idempotent, additive schema migration for databases created before a column
   * existed. `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a
   * new nullable column must be added here for stores that predate it. Runs on
   * every open; a no-op once the column is present.
   *
   * Note: `ALTER TABLE … ADD COLUMN` appends physically, so a migrated DB has
   * `importSource` *after* `data`, whereas a fresh DB (SCHEMA_SQL) has it before
   * `data`. This divergence is safe only because every statement here binds by
   * column name — never `SELECT *`, positional reads, or column-count asserts.
   * Keep it that way, or align the two layouts before adding such a read.
   */
  private migrate(): void {
    const cols = this.db.prepare('PRAGMA table_info(games)').all().map((row) => String(row.name));
    if (!cols.includes('importSource')) {
      this.db.exec('ALTER TABLE games ADD COLUMN importSource TEXT');
    }
  }

  private getOne(matchId: string): GameRecord | undefined {
    const row = this.getStmt.get(matchId);
    return row ? (JSON.parse(String(row.data)) as GameRecord) : undefined;
  }

  private tx(body: () => void): void {
    this.db.exec('BEGIN');
    try {
      body();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

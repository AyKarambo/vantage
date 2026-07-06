import * as fs from 'fs';
import * as path from 'path';

/** Per-match Notion export state: the page to update in place, and the content
 *  signature at the time of that write (see `matchExportSignature`). */
export interface ExportRecord {
  pageId: string;
  signature: string;
  exportedAt: number;
  /**
   * The Gametracker database this record's `pageId` lives in. Absent on
   * records written before this field existed (or ones a caller chose not to
   * stamp) — treated as "matches whatever database is asked about" on read,
   * so pre-migration ledgers keep working, and stamped with the asked-about
   * database on the next write to that record (see `pageIdFor`/`recordExport`).
   */
  databaseId?: string;
}

interface OutboxState {
  /** matchId → export state. Supersedes the old `processed: string[]` dedupe list
   *  and the dead `pending`/`enqueue`/`remove` retry queue (zero callers). */
  records: Record<string, ExportRecord>;
  /** Legacy dedupe list from before the ledger existed. Read-only: still loaded
   *  for back-compat with existing `outbox.json` files, never written to. */
  processed?: string[];
}

/**
 * Tiny durable store backed by a single JSON file with atomic writes.
 *
 * Deliberately not SQLite: this app logs a handful of matches a day, so a JSON
 * file gives the same durability + dedupe without a native build step. Takes a
 * directory in the constructor (no Electron import) so it is unit-testable.
 *
 * Holds the Notion export ledger — a `matchId -> { pageId, signature }` map that
 * lets the exporter update existing pages in place instead of re-creating them,
 * and detect when nothing changed since the last successful sync.
 */
export class OutboxStore {
  private file: string;
  private tmp: string;
  private state: OutboxState;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'outbox.json');
    this.tmp = path.join(dir, 'outbox.tmp.json');
    this.state = this.load();
  }

  /**
   * The Notion page id to update in place, if this match has ever been
   * exported INTO `databaseId`. A record stamped with a *different* database
   * (the user switched Gametracker databases since) is treated as not-in-the-
   * ledger — `undefined` — so the caller creates a fresh page in the new
   * database instead of writing into the old one's page. A record with no
   * stamped `databaseId` (pre-migration) matches whatever database is asked
   * about, so existing ledgers keep working until their next write.
   * `databaseId` omitted entirely (caller doesn't track database affinity,
   * e.g. some tests) always matches, preserving prior behavior.
   */
  pageIdFor(matchId: string, databaseId?: string): string | undefined {
    const rec = this.state.records[matchId];
    if (!rec) return undefined;
    if (databaseId !== undefined && rec.databaseId !== undefined && rec.databaseId !== databaseId) return undefined;
    return rec.pageId;
  }

  /** The export signature recorded at the match's last successful write into
   *  `databaseId` — same not-in-ledger-on-database-mismatch rule as `pageIdFor`. */
  signatureFor(matchId: string, databaseId?: string): string | undefined {
    const rec = this.state.records[matchId];
    if (!rec) return undefined;
    if (databaseId !== undefined && rec.databaseId !== undefined && rec.databaseId !== databaseId) return undefined;
    return rec.signature;
  }

  /** Record a successful create/update: stores the page id to update next time and
   *  the signature written, so an unchanged match is skipped on the next sync.
   *  Stamps `databaseId` (when given) so a later database switch is detected. */
  recordExport(matchId: string, record: { pageId: string; signature: string; databaseId?: string }): void {
    this.state.records[matchId] = { ...record, exportedAt: Date.now() };
    this.save();
  }

  /** Record a page imported from Notion as a full ledger entry (not a bare
   *  processed marker) so an imported-then-edited row updates in place instead of
   *  being re-created on the next export. Stamps `databaseId` (when given) so a
   *  later database switch is detected. */
  recordImported(matchId: string, record: { pageId: string; signature: string; databaseId?: string }): void {
    this.state.records[matchId] = { ...record, exportedAt: Date.now() };
    this.save();
  }

  /**
   * Re-point an EXISTING ledger record at a different Notion page — the cleanup
   * action's counterpart to adopting a canonical row: after archiving a
   * duplicate, the ledger must follow the match to whichever page survives.
   * Preserves `signature` so an otherwise-unchanged match still reads as
   * unchanged on the next sync (AC12); refreshes `exportedAt` since a re-point
   * is itself a write. Stamps `databaseId` when given, else leaves the
   * record's existing one untouched. Strict no-op when the match has no
   * record at all: this method only *moves* an existing link, it never
   * creates one — a match with no ledger record is left for the exporter's
   * create-guard to resolve (adopt-or-create) on the next sync.
   */
  repointExport(matchId: string, record: { pageId: string; databaseId?: string }): void {
    const rec = this.state.records[matchId];
    if (!rec) return;
    this.state.records[matchId] = {
      ...rec,
      pageId: record.pageId,
      databaseId: record.databaseId ?? rec.databaseId,
      exportedAt: Date.now(),
    };
    this.save();
  }

  /** Drop a match's ledger record, e.g. after its imported row is deleted locally
   *  (`deleteImportedMatches`) so a re-import or re-export starts fresh. */
  clearExport(matchId: string): void {
    if (!(matchId in this.state.records)) return;
    delete this.state.records[matchId];
    this.save();
  }

  /** matchIds present in the legacy `processed[]` list with no ledger record yet —
   *  drives the one-time backfill that resolves each one's existing Notion page via
   *  a `Match ID` query and adopts it into the ledger. */
  legacyProcessed(): string[] {
    const legacy = this.state.processed ?? [];
    return legacy.filter((matchId) => !(matchId in this.state.records));
  }

  /**
   * Re-point this store at a new directory and reload its ledger from there —
   * the backing for the user-configurable data location (spec Area C). Unlike
   * `HistoryStore.relocate`, this is a plain JSON file: no handle to close, so
   * moving the file is the caller's job (the migration executor copies it
   * before calling this); `relocate` just repoints and re-reads.
   */
  relocate(newDir: string): void {
    fs.mkdirSync(newDir, { recursive: true });
    this.file = path.join(newDir, 'outbox.json');
    this.tmp = path.join(newDir, 'outbox.tmp.json');
    this.state = this.load();
  }

  private load(): OutboxState {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OutboxState>;
      const records =
        parsed.records && typeof parsed.records === 'object' ? parsed.records : {};
      const state: OutboxState = { records };
      if (Array.isArray(parsed.processed)) state.processed = parsed.processed;
      return state;
    } catch {
      return { records: {} };
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}

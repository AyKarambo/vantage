import * as fs from 'fs';
import * as path from 'path';
import type { MatchRecord } from '../core/model';

interface OutboxState {
  /** Matches awaiting a successful Notion write (retry queue). */
  pending: MatchRecord[];
  /** Match ids already written to Notion (dedupe), most-recent last. */
  processed: string[];
}

/**
 * Tiny durable store backed by a single JSON file with atomic writes.
 *
 * Deliberately not SQLite: this app logs a handful of matches a day, so a JSON
 * file gives the same durability + dedupe without a native build step. Takes a
 * directory in the constructor (no Electron import) so it is unit-testable.
 */
export class OutboxStore {
  private readonly file: string;
  private readonly tmp: string;
  private state: OutboxState;

  constructor(dir: string, private readonly maxProcessed = 5000) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'outbox.json');
    this.tmp = path.join(dir, 'outbox.tmp.json');
    this.state = this.load();
  }

  /** True once `matchId` has been successfully written to Notion. */
  isProcessed(matchId: string): boolean {
    return this.state.processed.includes(matchId);
  }

  /** Record a successful Notion write, trimming the dedupe list to `maxProcessed`. */
  markProcessed(matchId: string): void {
    if (this.isProcessed(matchId)) return;
    this.state.processed.push(matchId);
    if (this.state.processed.length > this.maxProcessed) {
      this.state.processed = this.state.processed.slice(-this.maxProcessed);
    }
    this.save();
  }

  /**
   * Mark many ids processed in one atomic save (e.g. after an import, so a later
   * export skips the rows that already came from Notion). Skips ids already
   * present and only writes when something actually changed.
   */
  markManyProcessed(matchIds: string[]): void {
    let added = 0;
    for (const matchId of matchIds) {
      if (this.isProcessed(matchId)) continue;
      this.state.processed.push(matchId);
      added++;
    }
    if (!added) return;
    if (this.state.processed.length > this.maxProcessed) {
      this.state.processed = this.state.processed.slice(-this.maxProcessed);
    }
    this.save();
  }

  /** Queue a match for (re)try. No-op if already queued. */
  enqueue(record: MatchRecord): void {
    if (this.state.pending.some((r) => r.matchId === record.matchId)) return;
    this.state.pending.push(record);
    this.save();
  }

  /** Drop a match from the retry queue, e.g. once it's exported. */
  remove(matchId: string): void {
    const before = this.state.pending.length;
    this.state.pending = this.state.pending.filter((r) => r.matchId !== matchId);
    if (this.state.pending.length !== before) this.save();
  }

  /** Snapshot of matches still queued for (re)try. */
  pending(): MatchRecord[] {
    return [...this.state.pending];
  }

  private load(): OutboxState {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OutboxState>;
      return {
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        processed: Array.isArray(parsed.processed) ? parsed.processed : [],
      };
    } catch {
      return { pending: [], processed: [] };
    }
  }

  private save(): void {
    fs.writeFileSync(this.tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(this.tmp, this.file);
  }
}
